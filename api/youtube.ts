import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 60,
};

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.aeong.one',
  'https://watchapi.whatever.social',
  'https://api.piped.privacydev.net',
  'https://pipedapi.palveluntarjoaja.eu',
];

const INVIDIOUS_INSTANCES = [
  'https://invidious.fdn.fr',
  'https://vid.puffyan.us',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://inv.riverside.rocks',
  'https://invidious.drgns.space',
];

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function getDynamicPipedInstances(): Promise<string[]> {
  try {
    const resp = await fetch('https://piped-instances.kavin.rocks/', {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<{ api_url?: string }>;
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
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<[string, { type?: string; api?: boolean; uri?: string }]>;
    return data
      .filter(([, meta]) => meta?.type === 'https' && meta?.api === true && !!meta?.uri)
      .map(([, meta]) => normalizeBase(meta.uri!));
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoId = req.query.v as string | undefined;
  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Missing or invalid video ID' });
  }

  console.log(`[YouTube API] Extracting audio for: ${videoId}`);

  // ── Try Piped instances ───────────────────────────────────────────────
  console.log('[YouTube API] Trying Piped...');
  const pipedCandidates = Array.from(new Set([
    ...(await getDynamicPipedInstances()),
    ...PIPED_INSTANCES.map(normalizeBase),
  ]));

  for (const base of pipedCandidates) {
    try {
      const resp = await fetch(`${base}/streams/${videoId}`, {
        signal: AbortSignal.timeout(12000),
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
      const msg = (err as Error).message;
      console.log(`[YouTube API] Piped ${base} failed: ${msg}`);
    }
  }

  // ── Try Invidious instances ────────────────────────────────────────────
  console.log('[YouTube API] Trying Invidious...');
  const invidiousCandidates = Array.from(new Set([
    ...(await getDynamicInvidiousInstances()),
    ...INVIDIOUS_INSTANCES.map(normalizeBase),
  ]));

  for (const base of invidiousCandidates) {
    try {
      const resp = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(12000),
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
      const msg = (err as Error).message;
      console.log(`[YouTube API] Invidious ${base} failed: ${msg}`);
    }
  }

  console.error(`[YouTube API] ✗ All methods failed for ${videoId}`);
  
  // ── Final fallback: Try cobalt.tools API ──────────────────────────────
  try {
    console.log('[YouTube API] Trying cobalt.tools as final fallback...');
    const cobaltResp = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        isAudioOnly: true,
        filenamePattern: 'basic',
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (cobaltResp.ok) {
      const cobaltData = await cobaltResp.json();
      if (cobaltData.status === 'stream' && cobaltData.url) {
        console.log('[YouTube API] ✓ Success via cobalt.tools');
        return res.status(200).json({
          title: `YouTube – ${videoId}`,
          audioUrl: cobaltData.url,
          duration: 0,
          source: 'cobalt',
        });
      }
    }
  } catch (err) {
    console.log(`[YouTube API] cobalt.tools failed: ${(err as Error).message}`);
  }

  return res.status(502).json({
    error: 'Could not extract audio for this video.\n\nPossible reasons:\n• Video is region-restricted or private\n• All proxy servers are temporarily unavailable\n• Video has unusual encoding\n\nTry another video or wait a moment and try again.',
  });
}
