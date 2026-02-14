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

// ICE server configuration with STUN + TURN for NAT/firewall traversal
// Uses Open Relay Project free TURN servers (https://www.metered.ca/tools/openrelay)
const ICE_CONFIG = {
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
  private joinRoomReject: ((error: Error) => void) | null = null;
  private joinRoomTimeout: ReturnType<typeof setTimeout> | null = null;
  private signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
      this.peer = new Peer(peerId, { debug: 2, config: ICE_CONFIG });

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
          this.peer = new Peer(newPeerId, { debug: 2, config: ICE_CONFIG });
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
      // Accept only one active guest.
      // If we have a stale pending connection that never opened, replace it.
      if (this.conn) {
        if (this.conn.open) {
          console.log('[MP] setupHostListeners: Rejecting additional connection (already have active guest)');
          conn.close();
          return;
        }

        console.warn('[MP] setupHostListeners: Replacing stale pending guest connection');
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
          console.warn('[MP] setupHostListeners: Guest connection open timeout; clearing pending slot');
          conn.close();
          if (this.conn === conn) {
            this.conn = null;
          }
          this.emit({ kind: 'error', message: 'Guest connection failed to establish' });
        }
      }, 10000);

      const onOpen = () => {
        console.log('[MP] setupHostListeners: Connection channel opened');
        if (openHandled) return;
        openHandled = true;
        clearTimeout(openTimeout);
        this.setupDataChannel();
        console.log('[MP] setupHostListeners: Data channel set up, sending ping to guest');
        // Don't emit opponent-connected yet! Wait for guest to confirm via handshake.
        // Send a ready ping - when guest responds, THEN we're connected.
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
          console.warn('[MP] setupHostListeners: Pending guest connection error before open:', err.message);
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

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let attempt = 0;
      let attemptToken = 0;
      let stateCheckInterval: ReturnType<typeof setInterval> | null = null;
      let openTimeout: ReturnType<typeof setTimeout> | null = null;
      const MAX_JOIN_ATTEMPTS = 3;
      const OPEN_TIMEOUT_MS = 12000;

      const clearAttemptTimers = () => {
        if (stateCheckInterval) {
          clearInterval(stateCheckInterval);
          stateCheckInterval = null;
        }
        if (openTimeout) {
          clearTimeout(openTimeout);
          openTimeout = null;
        }
      };

      const failJoin = (message: string, err?: Error) => {
        if (this.joinRoomReject) {
          this.emit({ kind: 'error', message });
          this.joinRoomReject(err ?? new Error(message));
        }
      };

      const retryOrFail = (reason: string, fallbackMessage: string) => {
        if (settled) return;
        console.warn(`[MP] joinRoom: Attempt ${attempt}/${MAX_JOIN_ATTEMPTS} failed: ${reason}`);
        clearAttemptTimers();
        this.conn?.close();
        this.conn = null;

        if (attempt < MAX_JOIN_ATTEMPTS) {
          startAttempt();
          return;
        }

        failJoin(fallbackMessage, new Error(reason));
      };

      const startAttempt = () => {
        if (settled || !this.peer) return;

        attempt += 1;
        const token = ++attemptToken;
        const hostId = PEER_PREFIX + this.roomCode;

        console.log(`[MP] joinRoom: Attempt ${attempt}/${MAX_JOIN_ATTEMPTS} connecting to host ID:`, hostId);

        this.conn?.close();
        this.conn = this.peer.connect(hostId, { serialization: 'json' });

        console.log('[MP] joinRoom: Connection object created, initial state:', {
          open: this.conn.open,
          peer: this.conn.peer,
          type: this.conn.type,
          metadata: this.conn.metadata,
        });

        monitorICE(this.conn, `GUEST[attempt-${attempt}]`);

        this.conn.on('open', () => {
          if (settled || token !== attemptToken) return;
          clearAttemptTimers();
          console.log('[MP] joinRoom: Connection channel opened, waiting for ping from host');

          this.setupDataChannel();
          console.log('[MP] joinRoom: Data channel set up, starting 10s handshake timeout');

          this.joinRoomTimeout = setTimeout(() => {
            if (settled || token !== attemptToken) return;
            console.error('[MP] joinRoom: Handshake timeout - no ping received from host');
            retryOrFail('Handshake timeout', 'Handshake timed out. Host did not respond.');
          }, 10000);
        });

        this.conn.on('error', (err) => {
          if (settled || token !== attemptToken) return;
          console.error('[MP] joinRoom: Connection error:', err);
          retryOrFail(err.message || 'Connection error', `Failed to connect: ${err.message}`);
        });

        this.conn.on('close', () => {
          if (settled || token !== attemptToken) return;
          console.warn('[MP] joinRoom: Connection closed before handshake completed');
          retryOrFail('Connection closed early', 'Connection closed before it could open. Check the room code.');
        });

        stateCheckInterval = setInterval(() => {
          if (this.conn && token === attemptToken) {
            console.log('[MP] joinRoom: Connection state check - open:', this.conn.open, 'peer:', this.conn.peer);
          }
        }, 2000);

        openTimeout = setTimeout(() => {
          if (settled || token !== attemptToken) return;
          console.error(`[MP] joinRoom: Attempt ${attempt} open-timeout (${OPEN_TIMEOUT_MS}ms)`);
          console.error('[MP] joinRoom: Final connection state:', this.conn ? {
            open: this.conn.open,
            peer: this.conn.peer,
            type: this.conn.type,
          } : 'null');
          retryOrFail('Connection open timeout', 'Connection timed out. The host may be offline, unreachable, or behind strict NAT.');
        }, OPEN_TIMEOUT_MS);
      };

      // Store callbacks for handshake completion
      this.joinRoomResolve = () => {
        if (settled) return;
        settled = true;
        clearAttemptTimers();
        if (this.joinRoomTimeout) {
          clearTimeout(this.joinRoomTimeout);
          this.joinRoomTimeout = null;
        }
        this.joinRoomResolve = null;
        this.joinRoomReject = null;
        resolve();
      };

      this.joinRoomReject = (err: Error) => {
        if (settled) return;
        settled = true;
        clearAttemptTimers();
        if (this.joinRoomTimeout) {
          clearTimeout(this.joinRoomTimeout);
          this.joinRoomTimeout = null;
        }
        this.joinRoomResolve = null;
        this.joinRoomReject = null;
        reject(err);
      };

      this.peer = new Peer({ debug: 2, config: ICE_CONFIG });

      this.peer.on('open', () => {
        console.log('[MP] joinRoom: Guest peer opened with ID:', this.peer!.id);
        console.log('[MP] joinRoom: Peer status - disconnected:', this.peer!.disconnected, 'destroyed:', this.peer!.destroyed);
        startAttempt();
      });

      this.peer.on('error', (err) => {
        console.error('[MP] joinRoom: Peer error:', err.type, err.message);
        if (settled) return;
        settled = true;
        this.emit({ kind: 'error', message: err.message });
        reject(err);
      });

      this.peer.on('disconnected', () => {
        console.warn('[MP] joinRoom: Peer disconnected from signaling server');
        this.schedulePeerReconnect();
      });

      this.peer.on('close', () => {
        console.warn('[MP] joinRoom: Peer closed');
      });

      // Peer itself may fail to reach signaling server
      setTimeout(() => {
        if (!settled) {
          failJoin('Could not reach the multiplayer server. Check your internet connection.', new Error('Signaling server timeout'));
        }
      }, 20000);
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
    this.joinRoomReject = null;
    this.setState('idle');
  }
}
