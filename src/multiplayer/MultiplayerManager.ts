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

// Multiple ICE configurations for fallback:
// Config 0 – STUN + TURN (normal mode)
// Config 1 – alternate STUN/TURN servers
// Config 2 – relay-only mode (force TURN, bypasses NAT completely)
const ICE_CONFIGS: RTCConfiguration[] = [
  // Config 0: Standard STUN + TURN
  {
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
  },
  // Config 1: Alternate servers (broader STUN coverage + repeat TURN for second attempt)
  {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.services.mozilla.com' },
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
  },
  // Config 2: RELAY ONLY – force all traffic through TURN (bypasses symmetric NAT)
  {
    iceServers: [
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
    iceTransportPolicy: 'relay', // Force TURN relay – never attempt direct
  },
];

// Host always uses config 0
const HOST_ICE_CONFIG = ICE_CONFIGS[0];

/** Log ICE connection state changes on the underlying RTCPeerConnection */
function monitorICE(conn: DataConnection, label: string): void {
  // PeerJS exposes the underlying RTCPeerConnection via peerConnection
  const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
  if (!pc) {
    // peerConnection may not exist yet; try again after a short delay
    setTimeout(() => {
      const pcRetry = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (pcRetry) {
        attachICEListeners(pcRetry, label);
      } else {
        console.warn('[MP]', label, 'Could not access peerConnection for ICE monitoring');
      }
    }, 500);
    return;
  }
  attachICEListeners(pc, label);
}

function attachICEListeners(pc: RTCPeerConnection, label: string): void {
  console.log('[MP]', label, 'Initial ICE state:', pc.iceConnectionState, '| Gathering:', pc.iceGatheringState, '| Connection:', pc.connectionState);
  // IMPORTANT: Use addEventListener, NOT property assignment (e.g. pc.onicecandidate = ...).
  // PeerJS uses the on* properties internally to trickle ICE candidates.
  // Overwriting them breaks WebRTC negotiation entirely.
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
      console.log('[MP]', label, 'ICE candidate gathering complete');
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    console.log('[MP]', label, 'Connection state →', pc.connectionState);
  });
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
  private signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cancellation token: incremented to abort stale join attempts */
  private joinGeneration = 0;

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
    console.log('[MP] createRoom: Room code generated:', this.roomCode);
    this.setState('creating');

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const peerId = PEER_PREFIX + this.roomCode;
      console.log('[MP] createRoom: Creating peer with ID:', peerId);
      this.peer = new Peer(peerId, { debug: 2, config: HOST_ICE_CONFIG });

      this.peer.on('open', () => {
        console.log('[MP] createRoom: Peer opened with ID:', peerId);
        if (settled) return;
        settled = true;
        this.setupHostListeners();
        console.log('[MP] createRoom: Host listeners set up, resolving with code:', this.roomCode);
        resolve(this.roomCode);
      });

      this.peer.on('error', (err) => {
        console.error('[MP] createRoom: Peer error:', err.type, '-', err.message);
        if (settled) return;
        // If peer ID taken, regenerate
        if (err.type === 'unavailable-id') {
          console.log('[MP] createRoom: Peer ID unavailable, regenerating...');
          this.roomCode = generateRoomCode();
          this.peer?.destroy();
          const newPeerId = PEER_PREFIX + this.roomCode;
          console.log('[MP] createRoom: Retrying with new peer ID:', newPeerId);
          this.peer = new Peer(newPeerId, { debug: 2, config: HOST_ICE_CONFIG });
          this.peer.on('open', () => {
            if (settled) return;
            settled = true;
            this.setupHostListeners();
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
        console.warn('[MP] createRoom: Host peer disconnected from signaling server');
        if (this.role === 'host') {
          this.emit({ kind: 'error', message: 'Multiplayer server link dropped. Reconnecting…' });
          this.schedulePeerReconnect();
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

  private schedulePeerReconnect(): void {
    if (!this.peer || this.peer.destroyed || this.signalingReconnectTimer) return;
    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null;
      if (!this.peer || this.peer.destroyed) return;
      try {
        console.log('[MP] schedulePeerReconnect: Attempting peer.reconnect()');
        this.peer.reconnect();
      } catch (err) {
        console.error('[MP] schedulePeerReconnect: Reconnect failed:', (err as Error).message);
      }
    }, 800);
  }

  private setupHostListeners(): void {
    if (!this.peer) {
      console.error('[MP] setupHostListeners: No peer exists!');
      return;
    }
    console.log('[MP] setupHostListeners: Listening for guest connections on peer ID:', this.peer.id);
    console.log('[MP] setupHostListeners: Peer connection status - disconnected:', this.peer.disconnected, 'destroyed:', this.peer.destroyed);
    
    this.peer.on('connection', (conn) => {
      console.log('[MP] setupHostListeners: Guest connection received from:', conn.peer);

      // Always accept the newest connection attempt from a guest.
      // Only reject if we already have a CONFIRMED, OPEN connection and handshake is done.
      const handshakeComplete = this.lobbyState !== 'creating';
      if (this.conn && handshakeComplete && this.conn.open) {
        console.log('[MP] setupHostListeners: Rejecting additional connection (already matched with a guest)');
        conn.close();
        return;
      }

      // Replace any prior pending connection (guest may have retried with fresh peer)
      if (this.conn) {
        console.warn('[MP] setupHostListeners: Replacing stale/pending guest connection');
        try { this.conn.close(); } catch { /* ignore */ }
        this.conn = null;
      }
      this.conn = conn;

      // Monitor ICE connection state on host side
      monitorICE(conn, 'HOST');

      // IMPORTANT: Wait for the data channel to be fully open before proceeding.
      // PeerJS fires 'connection' on the host before the WebRTC channel is ready.
      let openHandled = false;
      const openTimeout = setTimeout(() => {
        if (!openHandled && !conn.open) {
          console.warn('[MP] setupHostListeners: Guest connection open timeout (15s); clearing pending slot');
          openHandled = true;
          conn.close();
          if (this.conn === conn) {
            this.conn = null;
          }
          // Don't emit error to UI — guest will retry and host will accept the new connection
          console.log('[MP] setupHostListeners: Ready for next guest connection attempt');
        }
      }, 15000); // 15s to allow slow ICE negotiation

      const onOpen = () => {
        console.log('[MP] setupHostListeners: Connection channel opened to guest:', conn.peer);
        if (openHandled) return;
        openHandled = true;
        clearTimeout(openTimeout);
        this.setupDataChannel();
        console.log('[MP] setupHostListeners: Data channel set up, sending ping to guest');
        this.send({ type: 'ping' });
      };

      conn.on('open', onOpen);
      conn.on('close', () => {
        clearTimeout(openTimeout);
        if (!openHandled && this.conn === conn) {
          console.warn('[MP] setupHostListeners: Pending guest connection closed before open');
          this.conn = null;
        }
      });
      conn.on('error', (err) => {
        clearTimeout(openTimeout);
        if (!openHandled && this.conn === conn) {
          console.warn('[MP] setupHostListeners: Pending guest connection error:', err.message);
          this.conn = null;
        }
      });

      // If already open (rare but possible), call onOpen
      if (conn.open && !openHandled) {
        onOpen();
      }
    });
  }

  // ── Join Game (guest) ──────────────────────────────────────────────────

  async joinRoom(code: string): Promise<void> {
    console.log('[MP] joinRoom: Starting join with code:', code);
    this.cleanup();
    this.role = 'guest';
    this.roomCode = code.toUpperCase().trim();
    console.log('[MP] joinRoom: Normalized code:', this.roomCode);
    this.setState('joining');

    const generation = ++this.joinGeneration;
    const MAX_JOIN_ATTEMPTS = 4;
    const OPEN_TIMEOUT_MS = 14000;  // 14s per attempt for ICE negotiation
    const HANDSHAKE_TIMEOUT_MS = 8000; // 8s for ping/pong after channel opens

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const settle = (success: boolean, err?: Error) => {
        if (settled || generation !== this.joinGeneration) return;
        settled = true;
        if (this.joinRoomTimeout) { clearTimeout(this.joinRoomTimeout); this.joinRoomTimeout = null; }
        this.joinRoomResolve = null;
        if (success) resolve(); else reject(err ?? new Error('Join failed'));
      };

      // Store resolve callback for handshake completion (called from handleMessage on ping)
      this.joinRoomResolve = () => settle(true);

      const startAttempt = (attempt: number) => {
        if (settled || generation !== this.joinGeneration) return;

        // Pick ICE config for this attempt (cycles through configs, last uses relay-only)
        const iceConfigIdx = attempt >= MAX_JOIN_ATTEMPTS
          ? ICE_CONFIGS.length - 1 // last attempt → relay-only
          : Math.min(attempt - 1, ICE_CONFIGS.length - 1);
        const iceConfig = ICE_CONFIGS[iceConfigIdx];
        const isRelay = (iceConfig as any).iceTransportPolicy === 'relay';
        console.log(`[MP] joinRoom: ── Attempt ${attempt}/${MAX_JOIN_ATTEMPTS} ── ICE config #${iceConfigIdx}${isRelay ? ' (RELAY ONLY)' : ''}`);

        // **CRITICAL FIX**: Destroy old peer and create a FRESH one per attempt.
        // PeerJS keeps internal state from previous failed connections that prevents
        // subsequent connect() calls from completing properly.
        if (this.peer) {
          try { this.peer.destroy(); } catch { /* ignore */ }
          this.peer = null;
        }
        this.conn = null;

        const peer = new Peer({ debug: 2, config: iceConfig });
        this.peer = peer;

        let attemptTimedOut = false;
        let peerOpened = false;

        // Peer-level timeout: if signaling server doesn't respond
        const peerTimeout = setTimeout(() => {
          if (settled || generation !== this.joinGeneration || peerOpened) return;
          console.error(`[MP] joinRoom: Attempt ${attempt} - signaling server timeout`);
          attemptTimedOut = true;
          try { peer.destroy(); } catch { /* ignore */ }
          if (attempt < MAX_JOIN_ATTEMPTS) {
            console.log(`[MP] joinRoom: Retrying (attempt ${attempt + 1})...`);
            startAttempt(attempt + 1);
          } else {
            this.emit({ kind: 'error', message: 'Could not reach the multiplayer server after multiple attempts.' });
            settle(false, new Error('Signaling server timeout'));
          }
        }, 10000);

        peer.on('open', (id) => {
          if (settled || generation !== this.joinGeneration || attemptTimedOut) return;
          clearTimeout(peerTimeout);
          peerOpened = true;
          console.log(`[MP] joinRoom: Attempt ${attempt} - peer opened with ID: ${id}`);

          const hostId = PEER_PREFIX + this.roomCode;
          console.log(`[MP] joinRoom: Attempt ${attempt} - connecting to host:`, hostId);

          const conn = peer.connect(hostId, {
            serialization: 'json',
            reliable: true,
          });
          this.conn = conn;

          console.log(`[MP] joinRoom: Attempt ${attempt} - connection object created`);
          monitorICE(conn, `GUEST[attempt-${attempt}]`);

          // Timer: data channel must open within OPEN_TIMEOUT_MS
          const openTimer = setTimeout(() => {
            if (settled || generation !== this.joinGeneration) return;
            console.error(`[MP] joinRoom: Attempt ${attempt} - data channel open timeout (${OPEN_TIMEOUT_MS}ms)`);
            // Log final state for debugging
            const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
            if (pc) {
              console.log(`[MP] joinRoom: Attempt ${attempt} - ICE: ${pc.iceConnectionState}, Conn: ${pc.connectionState}, Gathering: ${pc.iceGatheringState}`);
            }
            try { conn.close(); } catch { /* ignore */ }
            if (this.conn === conn) this.conn = null;

            if (attempt < MAX_JOIN_ATTEMPTS) {
              console.log(`[MP] joinRoom: Retrying (attempt ${attempt + 1})...`);
              this.emit({ kind: 'error', message: `Connection attempt ${attempt} failed, retrying...` });
              startAttempt(attempt + 1);
            } else {
              this.emit({ kind: 'error', message: 'Connection timed out after all attempts. The host may be behind a strict firewall.' });
              settle(false, new Error('All connection attempts timed out'));
            }
          }, OPEN_TIMEOUT_MS);

          conn.on('open', () => {
            if (settled || generation !== this.joinGeneration) return;
            clearTimeout(openTimer);
            console.log(`[MP] joinRoom: Attempt ${attempt} - ✓ channel OPEN, waiting for host ping...`);

            this.setupDataChannel();

            // Handshake timeout: host must send ping within HANDSHAKE_TIMEOUT_MS
            this.joinRoomTimeout = setTimeout(() => {
              if (settled || generation !== this.joinGeneration) return;
              console.error(`[MP] joinRoom: Attempt ${attempt} - handshake timeout (no ping from host)`);
              try { conn.close(); } catch { /* ignore */ }
              if (this.conn === conn) this.conn = null;

              if (attempt < MAX_JOIN_ATTEMPTS) {
                this.emit({ kind: 'error', message: `Handshake timeout on attempt ${attempt}, retrying...` });
                startAttempt(attempt + 1);
              } else {
                this.emit({ kind: 'error', message: 'Host did not respond to handshake after all attempts.' });
                settle(false, new Error('Handshake timeout'));
              }
            }, HANDSHAKE_TIMEOUT_MS);
          });

          conn.on('error', (err) => {
            if (settled || generation !== this.joinGeneration) return;
            clearTimeout(openTimer);
            console.error(`[MP] joinRoom: Attempt ${attempt} - connection error:`, err);
            try { conn.close(); } catch { /* ignore */ }
            if (this.conn === conn) this.conn = null;

            if (attempt < MAX_JOIN_ATTEMPTS) {
              this.emit({ kind: 'error', message: `Connection error on attempt ${attempt}, retrying...` });
              startAttempt(attempt + 1);
            } else {
              this.emit({ kind: 'error', message: `Connection error: ${err.message}` });
              settle(false, new Error(err.message));
            }
          });

          conn.on('close', () => {
            if (settled || generation !== this.joinGeneration) return;
            clearTimeout(openTimer);
            console.warn(`[MP] joinRoom: Attempt ${attempt} - connection closed prematurely`);
            if (this.conn === conn) this.conn = null;

            if (attempt < MAX_JOIN_ATTEMPTS) {
              this.emit({ kind: 'error', message: `Connection dropped on attempt ${attempt}, retrying...` });
              startAttempt(attempt + 1);
            } else {
              this.emit({ kind: 'error', message: 'Connection closed. Check the room code and try again.' });
              settle(false, new Error('Connection closed'));
            }
          });

          // If already open (race), fire immediately
          if (conn.open) {
            conn.emit('open');
          }
        });

        peer.on('error', (err) => {
          if (settled || generation !== this.joinGeneration || attemptTimedOut) return;
          clearTimeout(peerTimeout);
          console.error(`[MP] joinRoom: Attempt ${attempt} - peer error:`, err.type, err.message);

          // peer-unavailable means the host peer ID doesn't exist on the signaling server
          if (err.type === 'peer-unavailable') {
            this.emit({ kind: 'error', message: 'Room not found. Make sure the host has created the room and the code is correct.' });
            settle(false, new Error('Room not found'));
            return;
          }

          if (attempt < MAX_JOIN_ATTEMPTS) {
            this.emit({ kind: 'error', message: `Network error on attempt ${attempt}, retrying...` });
            startAttempt(attempt + 1);
          } else {
            this.emit({ kind: 'error', message: err.message });
            settle(false, new Error(err.message));
          }
        });

        peer.on('disconnected', () => {
          if (settled || generation !== this.joinGeneration || attemptTimedOut) return;
          console.warn(`[MP] joinRoom: Attempt ${attempt} - peer disconnected from signaling`);
          // Try to reconnect to signaling
          this.schedulePeerReconnect();
        });
      };

      // Start first attempt
      startAttempt(1);
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
        // Guest receives this immediately after host's channel opens.
        // Respond with pong AND confirm we're connected.
        this.send({ type: 'pong' });
        if (this.role === 'guest' && this.lobbyState === 'joining') {
          console.log('[MP] handleMessage: Guest completing handshake, resolving joinRoom promise');
          // Complete the joinRoom handshake
          if (this.joinRoomResolve) {
            this.joinRoomResolve();
          }
          this.emit({ kind: 'opponent-connected' });
          this.setState('waiting-song');
        }
        break;
      case 'pong':
        console.log('[MP] handleMessage: Received pong (role:', this.role, 'state:', this.lobbyState + ')');
        // Host receives this after guest confirms bidirectional channel.
        // NOW we know both sides can communicate.
        if (this.role === 'host' && this.lobbyState === 'creating') {
          console.log('[MP] handleMessage: Host received pong, connection confirmed');
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
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.roomCode = '';
    this.latestScore = null;
    this.opponentScore = null;
    this.hasFinished = false;
    this.opponentFinished = false;
    if (this.joinRoomTimeout) {
      clearTimeout(this.joinRoomTimeout);
      this.joinRoomTimeout = null;
    }
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer);
      this.signalingReconnectTimer = null;
    }
    this.joinRoomResolve = null;
    this.setState('idle');
  }
}
