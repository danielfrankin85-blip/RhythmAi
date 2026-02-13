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
    this.cleanup();
    this.role = 'host';
    this.roomCode = generateRoomCode();
    this.setState('creating');

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const peerId = PEER_PREFIX + this.roomCode;
      this.peer = new Peer(peerId, { debug: 0 });

      this.peer.on('open', () => {
        if (settled) return;
        settled = true;
        this.setupHostListeners();
        resolve(this.roomCode);
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        // If peer ID taken, regenerate
        if (err.type === 'unavailable-id') {
          this.roomCode = generateRoomCode();
          this.peer?.destroy();
          this.peer = new Peer(PEER_PREFIX + this.roomCode, { debug: 0 });
          this.peer.on('open', () => {
            if (settled) return;
            settled = true;
            this.setupHostListeners();
            resolve(this.roomCode);
          });
          this.peer.on('error', (e) => {
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

  private setupHostListeners(): void {
    if (!this.peer) return;
    this.peer.on('connection', (conn) => {
      // Accept only one guest
      if (this.conn) {
        conn.close();
        return;
      }
      this.conn = conn;

      // IMPORTANT: Wait for the data channel to be fully open before proceeding.
      // PeerJS fires 'connection' on the host before the WebRTC channel is ready.
      let openHandled = false;
      const openTimeout = setTimeout(() => {
        if (!openHandled && !conn.open) {
          conn.close();
          this.conn = null;
          this.emit({ kind: 'error', message: 'Guest connection failed to establish' });
        }
      }, 15000);

      const onOpen = () => {
        if (openHandled) return;
        openHandled = true;
        clearTimeout(openTimeout);
        this.setupDataChannel();
        // Don't emit opponent-connected yet! Wait for guest to confirm via handshake.
        // Send a ready ping - when guest responds, THEN we're connected.
        this.send({ type: 'ping' });
      };

      conn.on('open', onOpen);
      conn.on('close', () => clearTimeout(openTimeout));

      // If already open (rare but possible), call onOpen
      if (conn.open && !openHandled) {
        onOpen();
      }
    });
  }

  // ── Join Game (guest) ──────────────────────────────────────────────────

  async joinRoom(code: string): Promise<void> {
    this.cleanup();
    this.role = 'guest';
    this.roomCode = code.toUpperCase().trim();
    this.setState('joining');

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      // Store callbacks for handshake completion
      this.joinRoomResolve = () => {
        if (settled) return;
        settled = true;
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
        if (this.joinRoomTimeout) {
          clearTimeout(this.joinRoomTimeout);
          this.joinRoomTimeout = null;
        }
        this.joinRoomResolve = null;
        this.joinRoomReject = null;
        reject(err);
      };

      this.peer = new Peer({ debug: 0 });

      this.peer.on('open', () => {
        const hostId = PEER_PREFIX + this.roomCode;
        this.conn = this.peer!.connect(hostId, { reliable: true, serialization: 'json' });

        this.conn.on('open', () => {
          if (settled) return;
          // Channel is open - set up data handlers but DON'T resolve yet
          // Wait for ping from host to confirm bidirectional handshake
          this.setupDataChannel();
          
          // Start timeout waiting for ping
          this.joinRoomTimeout = setTimeout(() => {
            if (this.joinRoomReject) {
              this.emit({ kind: 'error', message: 'Handshake timeout. Host did not respond.' });
              this.joinRoomReject(new Error('Handshake timeout'));
            }
          }, 10000);
        });

        this.conn.on('error', (err) => {
          if (this.joinRoomReject) {
            this.emit({ kind: 'error', message: `Failed to connect: ${err.message}` });
            this.joinRoomReject(err);
          }
        });

        this.conn.on('close', () => {
          if (this.joinRoomReject) {
            this.emit({ kind: 'error', message: 'Connection closed before it could open. Check the room code.' });
            this.joinRoomReject(new Error('Connection closed early'));
          }
        });

        // Timeout if connection doesn't open at all
        setTimeout(() => {
          if (this.joinRoomReject) {
            this.conn?.close();
            this.conn = null;
            this.emit({ kind: 'error', message: 'Connection timed out. Check the room code and try again.' });
            this.joinRoomReject(new Error('Connection timeout'));
          }
        }, 15000);
      });

      this.peer.on('error', (err) => {
        if (settled) return;
        settled = true;
        this.emit({ kind: 'error', message: err.message });
        reject(err);
      });

      // Peer itself may fail to reach signaling server
      setTimeout(() => {
        if (!settled) {
          settled = true;
          this.emit({ kind: 'error', message: 'Could not reach the multiplayer server. Check your internet connection.' });
          reject(new Error('Signaling server timeout'));
        }
      }, 20000);
    });
  }

  // ── Data channel ───────────────────────────────────────────────────────

  private setupDataChannel(): void {
    if (!this.conn) return;

    this.conn.on('data', (raw) => {
      const msg = raw as Message;
      this.handleMessage(msg);
    });

    this.conn.on('close', () => {
      this.emit({ kind: 'opponent-disconnected' });
      if (this.lobbyState !== 'finished') {
        this.setState('idle');
      }
    });

    this.conn.on('error', (err) => {
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
        // Guest receives this immediately after host's channel opens.
        // Respond with pong AND confirm we're connected.
        this.send({ type: 'pong' });
        if (this.role === 'guest' && this.lobbyState === 'joining') {
          // Complete the joinRoom handshake
          if (this.joinRoomResolve) {
            this.joinRoomResolve();
          }
          this.emit({ kind: 'opponent-connected' });
          this.setState('waiting-song');
        }
        break;
      case 'pong':
        // Host receives this after guest confirms bidirectional channel.
        // NOW we know both sides can communicate.
        if (this.role === 'host' && this.lobbyState === 'creating') {
          this.emit({ kind: 'opponent-connected' });
          this.setState('waiting-song');
        }
        break;
    }
  }

  private send(msg: Message): void {
    if (this.conn?.open) {
      this.conn.send(msg);
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
    this.joinRoomResolve = null;
    this.joinRoomReject = null;
    this.setState('idle');
  }
}
