import type { VercelRequest, VercelResponse } from '@vercel/node';
import ytdl from '@distube/ytdl-core';

export const config = {
  maxDuration: 60,
};

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
];

function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

function isYouTubeLike(url: string): boolean {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(url);
}

function isSpotifyLike(url: string): boolean {
  return /(?:open\.spotify\.com|spotify\.link)/i.test(url);
}

function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const u = new URL(trimmed);

    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.split('/').filter(Boolean)[0] ?? '';
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (u.hostname.includes('youtube.com') || u.hostname.includes('music.youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;

      // shorts / embed support
      const segments = u.pathname.split('/').filter(Boolean);
      const markerIndex = segments.findIndex((s) => s === 'shorts' || s === 'embed');
      if (markerIndex >= 0 && segments[markerIndex + 1]) {
        const id = segments[markerIndex + 1];
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
    }
  } catch {
    return null;
  }

  return null;
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

async function searchYouTubeVideoId(query: string): Promise<string | null> {
  const pipedCandidates = Array.from(new Set([...(await getDynamicPipedInstances()), ...PIPED_INSTANCES.map(normalizeBase)]));

  for (const base of pipedCandidates) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&filter=music_songs`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'RhythmAI/1.0' },
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as {
        items?: Array<{
          url?: string;
          title?: string;
          type?: string;
        }>;
      };

      const first = (data.items ?? []).find((item) => item.type === 'stream' && item.url && item.title);
      if (!first?.url) continue;

      const match = first.url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
      if (match?.[1]) return match[1];

      const parts = first.url.split('/').filter(Boolean);
      const id = parts[parts.length - 1];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    } catch {
      // try next
    }
  }

  return null;
}

async function resolveSpotifySearchQuery(url: string): Promise<string | null> {
  try {
    const oembed = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });

    if (!oembed.ok) return null;

    const data = (await oembed.json()) as { title?: string; author_name?: string };
    const title = (data.title ?? '').trim();
    const author = (data.author_name ?? '').trim();

    if (title && author) return `${author} - ${title}`;
    if (title) return title;
    return null;
  } catch {
    return null;
  }
}

async function tryCobaltAudioExtraction(url: string): Promise<{ title: string; audioUrl: string; note: string } | null> {
  try {
    const resp = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        isAudioOnly: true,
        audioFormat: 'mp3',
        audioBitrate: 320,
        filenamePattern: 'basic',
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      status?: string;
      url?: string;
      filename?: string;
    };

    if (!data?.url || (data.status !== 'stream' && data.status !== 'redirect')) {
      return null;
    }

    const title = (data.filename ?? 'converted-track')
      .replace(/\.[^.]+$/, '')
      .trim();

    return {
      title: title || 'converted-track',
      audioUrl: data.url,
      note: 'Targeted MP3 320kbps conversion via cobalt.tools',
    };
  } catch {
    return null;
  }
}

async function tryYtdlAudioExtraction(videoId: string): Promise<{ title: string; audioUrl: string; note: string } | null> {
  try {
    const info = await Promise.race([
      ytdl.getInfo(videoId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('ytdl timeout')), 15000)),
    ]);

    const selected = ytdl.chooseFormat(info.formats, {
      filter: 'audioonly',
      quality: 'highestaudio',
    });

    if (!selected?.url) return null;

    return {
      title: info.videoDetails?.title ?? `YouTube – ${videoId}`,
      audioUrl: selected.url,
      note: 'Fallback source stream (codec/bitrate depends on source availability)',
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url in request body' });
  }

  let url: string;
  try {
    url = new URL(rawUrl).toString();
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // 1) Best effort direct MP3-320 conversion for all supported links
  const cobaltDirect = await tryCobaltAudioExtraction(url);
  if (cobaltDirect) {
    return res.status(200).json({
      title: cobaltDirect.title,
      audioUrl: cobaltDirect.audioUrl,
      note: cobaltDirect.note,
    });
  }

  // 2) Fallback for YouTube links via direct extraction
  if (isYouTubeLike(url)) {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Could not parse a YouTube video ID from this URL' });
    }

    const ytdlResult = await tryYtdlAudioExtraction(videoId);
    if (!ytdlResult) {
      return res.status(502).json({ error: 'Could not extract audio from this YouTube link right now' });
    }

    return res.status(200).json({
      title: ytdlResult.title,
      audioUrl: ytdlResult.audioUrl,
      note: ytdlResult.note,
    });
  }

  // 3) Spotify fallback: resolve title -> search YouTube -> extract audio
  if (isSpotifyLike(url)) {
    const query = await resolveSpotifySearchQuery(url);
    if (!query) {
      return res.status(502).json({ error: 'Could not resolve Spotify track metadata from this link' });
    }

    const videoId = await searchYouTubeVideoId(query);
    if (!videoId) {
      return res.status(502).json({ error: 'Could not find a matching YouTube version for this Spotify track' });
    }

    const ytdlResult = await tryYtdlAudioExtraction(videoId);
    if (!ytdlResult) {
      return res.status(502).json({ error: 'Found a YouTube match, but could not extract its audio stream' });
    }

    return res.status(200).json({
      title: ytdlResult.title,
      audioUrl: ytdlResult.audioUrl,
      note: `Resolved from Spotify via YouTube search (${query})`,
    });
  }

  return res.status(400).json({
    error: 'Unsupported link. Please paste a YouTube, YouTube Music, or Spotify URL.',
  });
}
