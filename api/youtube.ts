import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from '@distube/ytdl-core';

export const config = {
  maxDuration: 60, // Allow up to 60s for extraction attempts
};

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.tokhmi.xyz',
  'https://api-piped.mha.fi',
  'https://pipedapi.syncpundit.io',
];

const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://vid.puffyan.us',
  'https://invidious.lunar.icu',
  'https://inv.tux.pizza',
  'https://invidious.privacydev.net',
  'https://yewtu.be',
];

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function getDynamicPipedInstances(): Promise<string[]> {
  try {
    const resp = await fetch('https://piped-instances.kavin.rocks/', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as Array<{ api_url?: string }>;
    return data
      .map((instance) => instance.api_url)
      .filter((apiUrl): apiUrl is string => Boolean(apiUrl))
      .map(normalizeBase);
  } catch {
    return [];
  }
}

async function getDynamicInvidiousInstances(): Promise<string[]> {
  try {
    const resp = await fetch('https://api.invidious.io/instances.json?sort_by=health', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as Array<[string, { type?: string; api?: boolean; uri?: string }]>;
    return data
      .filter(([, meta]) => meta?.type === 'https' && meta?.api === true && !!meta?.uri)
      .map(([, meta]) => normalizeBase(meta.uri!));
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow any origin (our own site)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoId = req.query.v as string | undefined;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Missing or invalid video ID' });
  }

  console.log(`[YouTube API] Attempting to extract audio for video: ${videoId}`);
  const errors: string[] = [];

  // ── Try direct YouTube extraction first (most reliable) ───────────────
  try {
    console.log('[YouTube API] Trying ytdl-core direct extraction...');
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`);
    const audioFormats = ytdl
      .filterFormats(info.formats, 'audioonly')
      .filter((f) => !!f.url)
      .sort((a, b) => (b.audioBitrate ?? 0) - (a.audioBitrate ?? 0));

    const best = audioFormats[0];
    if (best?.url) {
      console.log('[YouTube API] ✓ Success via ytdl-core');
      return res.status(200).json({
        title: info.videoDetails?.title ?? `YouTube – ${videoId}`,
        audioUrl: best.url,
        duration: Number(info.videoDetails?.lengthSeconds ?? 0),
        source: 'youtube-direct',
      });
    }
    erole.log('[YouTube API] Trying Piped instances...');
  const pipedCandidates = Array.from(new Set([
    ...(await getDynamicPipedInstances()),
    ...PIPED_INSTANCES.map(normalizeBase),
  ]));

  for (const base of pipedCandidates) {
    try {
      const resp = await fetch(`${base}/streams/${videoId}`, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'RhythmAI/1.0' },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const audioStreams: { url: string; mimeType: string; bitrate: number }[] = data.audioStreams ?? [];
      const best = audioStreams
        .filter((s) => s.mimeType?.startsWith('audio/'))
        .sort((a, b) => b.bitrate - a.bitrate)[0];
      if (best?.url) {
        console.log(`[YouTube API] ✓ Success via Piped: ${base}`);
        return res.status(200).json({
          title: data.title ?? `YouTube – ${videoId}`,
          audioUrl: best.url,
          duration: data.duration ?? 0,
          source: 'piped',
        });
      }
    } catch (err) {
      console.log(`[YouTube API] Piped ${base} failed: ${(err as Error).message}`);
   
        return res.status(200).json({
          title: data.title ?? `YouTube – ${videoId}`,
          audioUrl: best.url,
          duration: data.duration ?? 0,
          source: 'piped',
        });
      }
    } ole.log('[YouTube API] Trying Invidious instances...');
  const invidiousCandidates = Array.from(new Set([
    ...(await getDynamicInvidiousInstances()),
    ...INVIDIOUS_INSTANCES.map(normalizeBase),
  ]));

  for (const base of invidiousCandidates) {
    try {
      const resp = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'RhythmAI/1.0' },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const audioStreams: { url: string; type: string; bitrate: string }[] =
        data.adaptiveFormats?.filter((f: { type: string }) => f.type?.startsWith('audio/')) ?? [];
      const best = audioStreams.sort((a, b) => parseInt(b.bitrate) - parseInt(a.bitrate))[0];
      if (best?.url) {
        console.log(`[YouTube API] ✓ Success via Invidious: ${base}`);
        return res.status(200).json({
          title: data.title ?? `YouTube – ${videoId}`,
          audioUrl: best.url,
          duration: data.lengthSeconds ?? 0,
          source: 'invidious',
        });
      }
    } catch (err) {
      console.log(`[YouTube API] Invidious ${base} failed: ${(err as Error).message}`);
    }
  }

  console.error(`[YouTube API] ✗ All extraction methods failed for ${videoId}`);
  console.error('[YouTube API] Errors:', errors);
  return res.status(502).json({
    error: 'Could not extract audio for this video.\n\nPossible reasons:\n• Video is region-restricted or private\n• All proxy servers are temporarily unavailable\n• Video has unusual encoding\n\nTry another video or wait a moment and try again
  }

  return res.status(502).json({
    error: 'Could not extract audio for this video. It may be region/age restricted or temporarily unavailable.',
  });
}
