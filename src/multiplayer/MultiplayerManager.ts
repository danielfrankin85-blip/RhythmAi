// ─────────────────────────────────────────────────────────────────────────────
// MultiplayerManager – WebRTC peer-to-peer multiplayer via PeerJS
// ─────────────────────────────────────────────────────────────────────────────
//
//  Provides:
//    • Room creation (host generates a 6-char code, waits for guest)
//    • Room joining (guest enters code, connects to host)
//    • Real-time score syncing during gameplay
//    • Song metadata exchange so guest knows what to load
//    • Game start / finish coordination
//
//  Uses PeerJS (free signaling server, WebRTC data channel underneath).
//  No backend required — fully peer-to-peer.
//
//  Strategy: Both sides try to connect to each other simultaneously.
//  Guest registers with predictable ID so host can also initiate.
//  Whichever direction's SDP exchange succeeds first wins.
//
// ─────────────────────────────────────────────────────────────────────────────

import Peer, { type DataConnection } from 'peerjs';
import type { Difficulty } from '../beatmap/BeatmapGenerator';

// ── Types ────────────────────────────────────────────────────────────────────

export type MultiplayerRole = 'host' | 'guest';

export type LobbyState =
  | 'idle'
  | 'creating'       // host: peer created, waiting for guest
  | 'joining'        // guest: connecting to host
  | 'waiting-song'   // guest connected, waiting for host to pick a song
  | 'waiting-guest-ready' // host sent song info, waiting for guest to load
  | 'ready'          // both players ready, waiting for host to start
  | 'countdown'      // 3-2-1 countdown before play
  | 'playing'        // game in progress
  | 'finished';      // both finished, showing results

export interface SongInfo {
  songName: string;
  difficulty: Difficulty;
  /** File size in bytes — guest can verify they loaded the right file. */
  fileSize: number;
}

export interface PlayerScore {
  score: number;
  combo: number;
  maxCombo: number;
  accuracy: number;
  judgments: { perfect: number; good: number; miss: number };
}

/** Messages sent over the data channel. */
type Message =
  | { type: 'song-info'; data: SongInfo }
  | { type: 'guest-ready' }
  | { type: 'start-game' }
  | { type: 'score-update'; data: PlayerScore }
  | { type: 'game-over'; data: PlayerScore }
  | { type: 'ping' }
  | { type: 'pong' };

export type MultiplayerEvent =
  | { kind: 'state-change'; state: LobbyState }
  | { kind: 'opponent-connected' }
  | { kind: 'opponent-disconnected' }
  | { kind: 'song-info'; data: SongInfo }
  | { kind: 'guest-ready' }
  | { kind: 'start-game' }
  | { kind: 'opponent-score'; data: PlayerScore }
  | { kind: 'opponent-finished'; data: PlayerScore }
  | { kind: 'error'; message: string };

type EventHandler = (event: MultiplayerEvent) => void;

// ── Helpers ──────────────────────────────────────────────────────────────────

const PEER_PREFIX = 'rhythmai-mp-';
const GUEST_SUFFIX = '-G';

// PeerJS signaling server configuration (explicit for reliability)
const PEER_SERVER_OPTIONS = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  path: '/',
  pingInterval: 5000, // Keep signaling WebSocket alive
};

// ICE server configuration
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

/** Log ICE + signaling state changes on the underlying RTCPeerConnection */
function monitorICE(conn: DataConnection, label: string): void {
  const tryAttach = () => {
    const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
    if (pc) {
      attachICEListeners(pc, label);
      return true;
    }
    return false;
  };
  if (!tryAttach()) {
    // peerConnection may not exist yet; retry multiple times
    const retries = [100, 300, 600, 1000, 2000];
    retries.forEach(delay => {
      setTimeout(() => {
        tryAttach(); // Silently try — may already be attached
      }, delay);
    });
  }
}

function attachICEListeners(pc: RTCPeerConnection, label: string): void {
  // Prevent attaching twice
  if ((pc as any).__mpMonitored) return;
  (pc as any).__mpMonitored = true;

  console.log('[MP]', label, 'RTCPeerConnection state → signaling:', pc.signalingState, '| ICE:', pc.iceConnectionState, '| gathering:', pc.iceGatheringState, '| connection:', pc.connectionState);

  pc.addEventListener('signalingstatechange', () => {
    console.log('[MP]', label, 'Signaling state →', pc.signalingState);
  });
  pc.addEventListener('iceconnectionstatechange', () => {
    console.log('[MP]', label, 'ICE connection state →', pc.iceConnectionState);
  });
  pc.addEventListener('icegatheringstatechange', () => {
    console.log('[MP]', label, 'ICE gathering state →', pc.iceGatheringState);
  });
  pc.addEventListener('icecandidate', (e: RTCPeerConnectionIceEvent) => {
    if (e.candidate) {
      console.log('[MP]', label, 'ICE candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address);
    } else {
      console.log('[MP]', label, 'ICE candidates complete (null sentinel)');
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    console.log('[MP]', label, 'Connection state →', pc.connectionState);
  });
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Create a PeerJS Peer with explicit server config */
function createPeer(id?: string): Peer {
  const opts: any = {
    debug: 2,
    config: ICE_CONFIG,
    ...PEER_SERVER_OPTIONS,
  };
  return id ? new Peer(id, opts) : new Peer(opts);
}

// ── Manager ──────────────────────────────────────────────────────────────────

export class MultiplayerManager {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private role: MultiplayerRole = 'host';
  private roomCode = '';
  private lobbyState: LobbyState = 'idle';
  private listeners: EventHandler[] = [];
  private scoreInterval: ReturnType<typeof setInterval> | null = null;
  private latestScore: PlayerScore | null = null;
  private opponentScore: PlayerScore | null = null;
  private hasFinished = false;
  private opponentFinished = false;
  private joinRoomResolve: (() => void) | null = null;
  private joinRoomTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Cancellation token: incremented to abort stale join attempts */
  private joinGeneration = 0;
  /** Host: timer for proactive guest connection attempts */
  private hostConnectTimer: ReturnType<typeof setInterval> | null = null;
  /** Track whether connection is fully established (handshake done) */
  private handshakeComplete = false;

  // ── Public getters ─────────────────────────────────────────────────────

  getRoomCode(): string { return this.roomCode; }
  getRole(): MultiplayerRole { return this.role; }
  getState(): LobbyState { return this.lobbyState; }
  getOpponentScore(): PlayerScore | null { return this.opponentScore; }
  isConnected(): boolean { return this.conn?.open ?? false; }

  // ── Event system ───────────────────────────────────────────────────────

  on(handler: EventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter(h => h !== handler);
    };
  }

  private emit(event: MultiplayerEvent): void {
    for (const handler of this.listeners) {
      try { handler(event); } catch (e) { console.error('MultiplayerManager event error:', e); }
    }
  }

  private setState(state: LobbyState): void {
    this.lobbyState = state;
    this.emit({ kind: 'state-change', state });
  }

  // ── Create Game (host) ─────────────────────────────────────────────────

  async createRoom(): Promise<string> {
    console.log('[MP] createRoom: Starting room creation');
    this.cleanup();
    this.role = 'host';
    this.roomCode = generateRoomCode();
    this.handshakeComplete = false;
    console.log('[MP] createRoom: Room code generated:', this.roomCode);
    this.setState('creating');

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const peerId = PEER_PREFIX + this.roomCode;
      console.log('[MP] createRoom: Creating peer with ID:', peerId);
      this.peer = createPeer(peerId);

      this.peer.on('open', () => {
        console.log('[MP] createRoom: Peer opened with ID:', peerId);
        if (settled) return;
        settled = true;
        this.setupHostListeners();
        // Start proactively trying to connect to guest's predictable ID
        this.startHostConnectPolling();
        console.log('[MP] createRoom: Host ready, resolving with code:', this.roomCode);
        resolve(this.roomCode);
      });

      this.peer.on('error', (err) => {
        console.error('[MP] createRoom: Peer error:', err.type, '-', err.message);
        if (settled) return;
        if (err.type === 'unavailable-id') {
          console.log('[MP] createRoom: Peer ID unavailable, regenerating...');
          this.roomCode = generateRoomCode();
          this.peer?.destroy();
          const newPeerId = PEER_PREFIX + this.roomCode;
          console.log('[MP] createRoom: Retrying with new peer ID:', newPeerId);
          this.peer = createPeer(newPeerId);
          this.peer.on('open', () => {
            if (settled) return;
            settled = true;
            this.setupHostListeners();
            this.startHostConnectPolling();
            resolve(this.roomCode);
          });
          this.peer.on('error', (e) => {
            console.error('[MP] createRoom: Retry peer error:', e.type, '-', e.message);
            if (settled) return;
            settled = true;
            this.emit({ kind: 'error', message: e.message });
            reject(e);
          });
        } else {
          settled = true;
          this.emit({ kind: 'error', message: err.message });
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        console.warn('[MP] createRoom: Host peer disconnected from signaling');
        if (this.role === 'host' && this.peer && !this.peer.destroyed) {
          console.log('[MP] createRoom: Attempting reconnect...');
          try { this.peer.reconnect(); } catch (e) {
            console.warn('[MP] createRoom: Reconnect failed:', (e as Error).message);
          }
        }
      });

      this.peer.on('close', () => {
        console.warn('[MP] createRoom: Host peer closed');
      });

      // Signaling server timeout
      setTimeout(() => {
        if (!settled) {
          settled = true;
          this.emit({ kind: 'error', message: 'Could not reach the multiplayer server.' });
          reject(new Error('Signaling server timeout'));
        }
      }, 15000);
    });
  }

  /**
   * Host proactively tries to connect TO the guest's predictable peer ID.
   * This is the key fix: if guest→host SDP fails, host→guest SDP may succeed.
   * PeerJS signaling can drop messages in one direction but not the other.
   */
  private startHostConnectPolling(): void {
    if (this.hostConnectTimer) return;
    const guestId = PEER_PREFIX + this.roomCode + GUEST_SUFFIX;
    let attemptNum = 0;

    console.log('[MP] HOST: Will periodically try connecting to guest at:', guestId);

    this.hostConnectTimer = setInterval(() => {
      // Stop polling once connected
      if (this.handshakeComplete || !this.peer || this.peer.destroyed) {
        this.stopHostConnectPolling();
        return;
      }
      // Don't connect if we already have an open connection being processed
      if (this.conn?.open) {
        return;
      }

      attemptNum++;
      console.log(`[MP] HOST: Proactive connect attempt #${attemptNum} to ${guestId}`);

      try {
        const conn = this.peer!.connect(guestId, { serialization: 'json' });
        monitorICE(conn, `HOST→GUEST[#${attemptNum}]`);

        // Give this connection attempt 8s to open
        const timer = setTimeout(() => {
          if (!conn.open) {
            console.log(`[MP] HOST: Proactive attempt #${attemptNum} timed out`);
            try { conn.close(); } catch { /* ignore */ }
          }
        }, 8000);

        conn.on('open', () => {
          clearTimeout(timer);
          if (this.handshakeComplete) {
            // Already connected via the other direction
            conn.close();
            return;
          }
          console.log(`[MP] HOST: ✓ Proactive connection to guest OPENED (attempt #${attemptNum})`);
          // Replace any pending connection
          if (this.conn && this.conn !== conn) {
            try { this.conn.close(); } catch { /* ignore */ }
          }
          this.conn = conn;
          this.setupDataChannel();
          this.send({ type: 'ping' });
          this.stopHostConnectPolling();
        });

        conn.on('error', (err) => {
          clearTimeout(timer);
          console.warn(`[MP] HOST: Proactive attempt #${attemptNum} error:`, err.type, err.message);
        });
      } catch (e) {
        console.warn(`[MP] HOST: Proactive connect failed:`, (e as Error).message);
      }
    }, 3000); // Try every 3 seconds
  }

  private stopHostConnectPolling(): void {
    if (this.hostConnectTimer) {
      clearInterval(this.hostConnectTimer);
      this.hostConnectTimer = null;
    }
  }

  private setupHostListeners(): void {
    if (!this.peer) {
      console.error('[MP] setupHostListeners: No peer exists!');
      return;
    }
    console.log('[MP] setupHostListeners: Listening for incoming connections');
    
    this.peer.on('connection', (conn) => {
      console.log('[MP] HOST: ◀ Incoming connection from:', conn.peer);

      // Reject if handshake already complete and connection is open
      if (this.handshakeComplete && this.conn?.open) {
        console.log('[MP] HOST: Rejecting (already connected)');
        conn.close();
        return;
      }

      // Replace any prior pending connection
      if (this.conn) {
        console.warn('[MP] HOST: Replacing stale pending connection');
        try { this.conn.close(); } catch { /* ignore */ }
        this.conn = null;
      }
      this.conn = conn;

      monitorICE(conn, 'HOST◀GUEST');

      let openHandled = false;
      const openTimeout = setTimeout(() => {
        if (!openHandled && !conn.open) {
          console.warn('[MP] HOST: Incoming connection timeout (20s)');
          openHandled = true;
          conn.close();
          if (this.conn === conn) this.conn = null;
        }
      }, 20000);

      const onOpen = () => {
        if (openHandled || this.handshakeComplete) return;
        openHandled = true;
        clearTimeout(openTimeout);
        console.log('[MP] HOST: ✓ Incoming connection OPENED from:', conn.peer);
        this.setupDataChannel();
        this.send({ type: 'ping' });
      };

      conn.on('open', onOpen);
      conn.on('close', () => {
        clearTimeout(openTimeout);
        if (!openHandled && this.conn === conn) {
          console.warn('[MP] HOST: Incoming connection closed before opening');
          this.conn = null;
        }
      });
      conn.on('error', (err) => {
        clearTimeout(openTimeout);
        if (!openHandled && this.conn === conn) {
          console.warn('[MP] HOST: Incoming connection error:', err.message);
          this.conn = null;
        }
      });

      if (conn.open && !openHandled) onOpen();
    });
  }

  // ── Join Game (guest) ──────────────────────────────────────────────────

  async joinRoom(code: string): Promise<void> {
    console.log('[MP] joinRoom: Starting join with code:', code);
    this.cleanup();
    this.role = 'guest';
    this.roomCode = code.toUpperCase().trim();
    this.handshakeComplete = false;
    console.log('[MP] joinRoom: Normalized code:', this.roomCode);
    this.setState('joining');

    const generation = ++this.joinGeneration;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let connectAttempt = 0;
      let connectTimer: ReturnType<typeof setInterval> | null = null;
      let overallTimeout: ReturnType<typeof setTimeout> | null = null;

      const settle = (success: boolean, err?: Error) => {
        if (settled || generation !== this.joinGeneration) return;
        settled = true;
        if (connectTimer) { clearInterval(connectTimer); connectTimer = null; }
        if (overallTimeout) { clearTimeout(overallTimeout); overallTimeout = null; }
        if (this.joinRoomTimeout) { clearTimeout(this.joinRoomTimeout); this.joinRoomTimeout = null; }
        this.joinRoomResolve = null;
        if (success) resolve(); else reject(err ?? new Error('Join failed'));
      };

      // Store resolve callback for handshake completion
      this.joinRoomResolve = () => settle(true);

      // Guest registers with a PREDICTABLE peer ID so the host can find it
      const guestId = PEER_PREFIX + this.roomCode + GUEST_SUFFIX;
      const hostId = PEER_PREFIX + this.roomCode;
      
      console.log('[MP] GUEST: Registering with predictable ID:', guestId);
      console.log('[MP] GUEST: Will connect to host:', hostId);

      const peer = createPeer(guestId);
      this.peer = peer;

      // Called when any connection opens (guest→host OR host→guest)
      const onAnyConnectionOpen = (conn: DataConnection, direction: string) => {
        if (settled || generation !== this.joinGeneration || this.handshakeComplete) {
          try { conn.close(); } catch { /* ignore */ }
          return;
        }
        console.log(`[MP] GUEST: ✓ ${direction} connection OPENED`);

        // Stop retry polling
        if (connectTimer) { clearInterval(connectTimer); connectTimer = null; }

        // Use this connection
        if (this.conn && this.conn !== conn) {
          try { this.conn.close(); } catch { /* ignore */ }
        }
        this.conn = conn;
        this.setupDataChannel();

        // Wait for host's ping to complete handshake
        console.log('[MP] GUEST: Waiting for ping from host...');
        this.joinRoomTimeout = setTimeout(() => {
          if (settled || generation !== this.joinGeneration) return;
          console.error('[MP] GUEST: Handshake timeout (no ping from host in 10s)');
          this.emit({ kind: 'error', message: 'Host did not respond. Try again.' });
          settle(false, new Error('Handshake timeout'));
        }, 10000);
      };

      peer.on('open', (id) => {
        if (settled || generation !== this.joinGeneration) return;
        console.log('[MP] GUEST: Peer opened with ID:', id);

        // === DIRECTION 1: Guest listens for HOST connecting TO us ===
        peer.on('connection', (incomingConn) => {
          console.log('[MP] GUEST: ◀ Incoming connection from:', incomingConn.peer);
          monitorICE(incomingConn, 'GUEST◀HOST');

          incomingConn.on('open', () => {
            onAnyConnectionOpen(incomingConn, 'HOST→GUEST (incoming)');
          });
          incomingConn.on('error', (err) => {
            console.warn('[MP] GUEST: Incoming connection error:', err.message);
          });
        });

        // === DIRECTION 2: Guest actively connects TO host ===
        const tryConnect = () => {
          if (settled || generation !== this.joinGeneration || this.handshakeComplete) return;

          connectAttempt++;
          console.log(`[MP] GUEST: ▶ Outgoing connect attempt #${connectAttempt} to ${hostId}`);

          try {
            const conn = peer.connect(hostId, { serialization: 'json' });
            monitorICE(conn, `GUEST▶HOST[#${connectAttempt}]`);

            // Log signaling state periodically
            const attemptCapture = connectAttempt;
            const stateLog = setInterval(() => {
              if (settled || generation !== this.joinGeneration) { clearInterval(stateLog); return; }
              const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
              if (pc) {
                console.log(`[MP] GUEST: Attempt #${attemptCapture} signaling: ${pc.signalingState}, ICE: ${pc.iceConnectionState}, conn: ${pc.connectionState}`);
              }
            }, 3000);

            // Per-attempt timeout: close after 10s if not open
            const attemptTimeout = setTimeout(() => {
              clearInterval(stateLog);
              if (!conn.open) {
                const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
                console.log(`[MP] GUEST: Attempt #${attemptCapture} timed out. Signaling: ${pc?.signalingState}, ICE: ${pc?.iceConnectionState}`);
                try { conn.close(); } catch { /* ignore */ }
              }
            }, 10000);

            conn.on('open', () => {
              clearTimeout(attemptTimeout);
              clearInterval(stateLog);
              onAnyConnectionOpen(conn, `GUEST→HOST (outgoing #${attemptCapture})`);
            });

            conn.on('error', (err) => {
              clearTimeout(attemptTimeout);
              clearInterval(stateLog);
              console.warn(`[MP] GUEST: Outgoing attempt #${attemptCapture} error:`, err.type, err.message);
            });

            conn.on('close', () => {
              clearTimeout(attemptTimeout);
              clearInterval(stateLog);
            });
          } catch (e) {
            console.warn(`[MP] GUEST: Connect attempt #${connectAttempt} threw:`, (e as Error).message);
          }
        };

        // First attempt immediately
        tryConnect();

        // Retry every 4 seconds with the SAME peer (fast retries, just resend SDP offer)
        connectTimer = setInterval(() => {
          if (settled || generation !== this.joinGeneration || this.handshakeComplete) {
            if (connectTimer) { clearInterval(connectTimer); connectTimer = null; }
            return;
          }
          tryConnect();
        }, 4000);
      });

      peer.on('error', (err) => {
        if (settled || generation !== this.joinGeneration) return;
        console.error('[MP] GUEST: Peer error:', err.type, err.message);

        // If our predictable guest ID is already taken (another guest with same code),
        // fall back to a random ID
        if (err.type === 'unavailable-id') {
          console.warn('[MP] GUEST: Predictable ID taken, falling back to random ID');
          if (this.peer) {
            try { this.peer.destroy(); } catch { /* ignore */ }
          }
          const fallbackPeer = createPeer(); // random ID
          this.peer = fallbackPeer;
          fallbackPeer.on('open', (id) => {
            if (settled || generation !== this.joinGeneration) return;
            console.log('[MP] GUEST: Fallback peer opened with ID:', id);
            // Only do outgoing connections (host can't find us)
            const tryFallbackConnect = () => {
              if (settled || generation !== this.joinGeneration || this.handshakeComplete) return;
              connectAttempt++;
              console.log(`[MP] GUEST: ▶ Fallback connect attempt #${connectAttempt} to ${hostId}`);
              try {
                const conn = fallbackPeer.connect(hostId, { serialization: 'json' });
                monitorICE(conn, `GUEST▶HOST[fb#${connectAttempt}]`);
                const timeout = setTimeout(() => {
                  if (!conn.open) try { conn.close(); } catch { /* ignore */ }
                }, 10000);
                conn.on('open', () => {
                  clearTimeout(timeout);
                  onAnyConnectionOpen(conn, `GUEST→HOST (fallback #${connectAttempt})`);
                });
                conn.on('error', (err2) => {
                  clearTimeout(timeout);
                  console.warn('[MP] GUEST: Fallback conn error:', err2.type, err2.message);
                });
              } catch { /* ignore */ }
            };
            tryFallbackConnect();
            connectTimer = setInterval(() => {
              if (settled || generation !== this.joinGeneration || this.handshakeComplete) {
                if (connectTimer) { clearInterval(connectTimer); connectTimer = null; }
                return;
              }
              tryFallbackConnect();
            }, 4000);
          });
          fallbackPeer.on('error', (e2) => {
            if (settled || generation !== this.joinGeneration) return;
            this.emit({ kind: 'error', message: e2.message });
            settle(false, new Error(e2.message));
          });
          return;
        }

        if (err.type === 'peer-unavailable') {
          // This means the host peer doesn't exist
          this.emit({ kind: 'error', message: 'Room not found. Check the code.' });
          settle(false, new Error('Room not found'));
          return;
        }

        this.emit({ kind: 'error', message: err.message });
        settle(false, new Error(err.message));
      });

      peer.on('disconnected', () => {
        if (settled || generation !== this.joinGeneration) return;
        console.warn('[MP] GUEST: Peer disconnected from signaling, reconnecting...');
        if (this.peer && !this.peer.destroyed) {
          try { this.peer.reconnect(); } catch (e) {
            console.warn('[MP] GUEST: Reconnect failed:', (e as Error).message);
          }
        }
      });

      // Overall timeout: 45 seconds total for all attempts
      overallTimeout = setTimeout(() => {
        if (settled || generation !== this.joinGeneration) return;
        console.error('[MP] GUEST: Overall timeout (45s) - no connection established');
        this.emit({ kind: 'error', message: 'Could not connect after 45 seconds. The host may be offline or unreachable.' });
        settle(false, new Error('Overall join timeout'));
      }, 45000);
    });
  }

  // ── Data channel ───────────────────────────────────────────────────────

  private setupDataChannel(): void {
    if (!this.conn) return;
    console.log('[MP] setupDataChannel: Setting up data channel handlers (role:', this.role + ')');

    this.conn.on('data', (raw) => {
      const msg = raw as Message;
      console.log('[MP] setupDataChannel: Received data message:', msg.type);
      this.handleMessage(msg);
    });

    this.conn.on('close', () => {
      console.log('[MP] setupDataChannel: Connection closed');
      this.emit({ kind: 'opponent-disconnected' });
      if (this.lobbyState !== 'finished') {
        this.setState('idle');
      }
    });

    this.conn.on('error', (err) => {
      console.error('[MP] setupDataChannel: Connection error:', err);
      this.emit({ kind: 'error', message: `Connection error: ${err.message}` });
    });
  }

  private handleMessage(msg: Message): void {
    switch (msg.type) {
      case 'song-info':
        this.emit({ kind: 'song-info', data: msg.data });
        this.setState('waiting-guest-ready');
        break;

      case 'guest-ready':
        this.emit({ kind: 'guest-ready' });
        this.setState('ready');
        break;

      case 'start-game':
        this.emit({ kind: 'start-game' });
        this.setState('playing');
        break;

      case 'score-update':
        this.opponentScore = msg.data;
        this.emit({ kind: 'opponent-score', data: msg.data });
        break;

      case 'game-over':
        this.opponentScore = msg.data;
        this.opponentFinished = true;
        this.emit({ kind: 'opponent-finished', data: msg.data });
        if (this.hasFinished) {
          this.setState('finished');
        }
        break;

      case 'ping':
        console.log('[MP] handleMessage: Received ping (role:', this.role, 'state:', this.lobbyState + ')');
        this.send({ type: 'pong' });
        if (this.role === 'guest' && this.lobbyState === 'joining') {
          console.log('[MP] handleMessage: ✓ Guest handshake complete!');
          this.handshakeComplete = true;
          if (this.joinRoomResolve) {
            this.joinRoomResolve();
          }
          this.emit({ kind: 'opponent-connected' });
          this.setState('waiting-song');
        }
        break;
      case 'pong':
        console.log('[MP] handleMessage: Received pong (role:', this.role, 'state:', this.lobbyState + ')');
        if (this.role === 'host' && this.lobbyState === 'creating') {
          console.log('[MP] handleMessage: ✓ Host handshake complete!');
          this.handshakeComplete = true;
          this.stopHostConnectPolling();
          this.emit({ kind: 'opponent-connected' });
          this.setState('waiting-song');
        }
        break;
    }
  }

  private send(msg: Message): void {
    if (this.conn?.open) {
      console.log('[MP] send: Sending message:', msg.type, '(role:', this.role + ')');
      this.conn.send(msg);
    } else {
      console.error('[MP] send: Cannot send, connection not open. Message:', msg.type);
    }
  }

  // ── Host actions ───────────────────────────────────────────────────────

  /** Host sends song metadata so guest knows what to load. */
  sendSongInfo(info: SongInfo): void {
    this.send({ type: 'song-info', data: info });
    this.setState('waiting-guest-ready');
  }

  /** Host signals game start (3-2-1 countdown then play). */
  startGame(): void {
    this.hasFinished = false;
    this.opponentFinished = false;
    this.opponentScore = null;
    this.send({ type: 'start-game' });
    this.setState('countdown');
  }

  // ── Guest actions ──────────────────────────────────────────────────────

  /** Guest signals they've loaded the song and are ready. */
  sendGuestReady(): void {
    this.send({ type: 'guest-ready' });
    this.setState('ready');
  }

  // ── Gameplay ───────────────────────────────────────────────────────────

  /** Start sending score updates at a regular interval. */
  startScoreSync(): void {
    this.setState('playing');
    this.stopScoreSync();
    this.scoreInterval = setInterval(() => {
      if (this.latestScore) {
        this.send({ type: 'score-update', data: this.latestScore });
      }
    }, 200); // 5 times per second
  }

  /** Update the latest score (called from game loop). */
  updateScore(score: PlayerScore): void {
    this.latestScore = score;
  }

  /** Signal that this player has finished the song. */
  finishGame(finalScore: PlayerScore): void {
    this.latestScore = finalScore;
    this.hasFinished = true;
    this.stopScoreSync();
    this.send({ type: 'game-over', data: finalScore });

    if (this.opponentFinished) {
      this.setState('finished');
    }
  }

  private stopScoreSync(): void {
    if (this.scoreInterval) {
      clearInterval(this.scoreInterval);
      this.scoreInterval = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  cleanup(): void {
    this.joinGeneration++; // cancel any in-flight join attempts
    this.stopScoreSync();
    this.stopHostConnectPolling();
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.roomCode = '';
    this.latestScore = null;
    this.opponentScore = null;
    this.hasFinished = false;
    this.opponentFinished = false;
    this.handshakeComplete = false;
    if (this.joinRoomTimeout) {
      clearTimeout(this.joinRoomTimeout);
      this.joinRoomTimeout = null;
    }
    this.joinRoomResolve = null;
    this.setState('idle');
  }
}
