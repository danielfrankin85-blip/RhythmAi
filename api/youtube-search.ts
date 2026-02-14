import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 30,
};

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
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
      .map((i) => i.api_url)
      .filter((u): u is string => Boolean(u))
      .map(normalizeBase);
  } catch {
    return [];
  }
}

interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  uploaderName: string;
  duration: number; // seconds
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = (req.query.q as string | undefined)?.trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing search query (?q=...)' });
  }

  const pipedCandidates = Array.from(
    new Set([...(await getDynamicPipedInstances()), ...PIPED_INSTANCES.map(normalizeBase)])
  );

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
          thumbnail?: string;
          uploaderName?: string;
          duration?: number;
          type?: string;
        }>;
      };

      const items = (data.items ?? [])
        .filter((item) => item.type === 'stream' && item.url && item.title)
        .slice(0, 20);

      const results: SearchResult[] = items.map((item) => {
        // Extract videoId from /watch?v=... URL
        const match = item.url?.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        const videoId = match ? match[1] : item.url?.split('/').pop() ?? '';
        return {
          videoId,
          title: item.title ?? '',
          thumbnail: item.thumbnail ?? '',
          uploaderName: item.uploaderName ?? '',
          duration: item.duration ?? 0,
        };
      }).filter((r) => r.videoId.length === 11);

      return res.status(200).json({ results });
    } catch {
      /* try next instance */
    }
  }

  return res.status(502).json({
    error: 'Search is temporarily unavailable. Please try again in a moment.',
  });
}
