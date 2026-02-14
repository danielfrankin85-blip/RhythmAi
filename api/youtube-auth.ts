import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  maxDuration: 30,
};

interface VideoInfo {
  title: string;
  audioUrl: string;
  duration: number;
  source: string;
}

// Use YouTube Data API v3 + innertube for stream extraction
async function extractWithApiKey(videoId: string, apiKey: string): Promise<VideoInfo> {
  // Get video metadata from YouTube Data API
  const metaResp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!metaResp.ok) {
    throw new Error(`YouTube API error: ${metaResp.status}`);
  }

  const metaData = await metaResp.json();
  const video = metaData.items?.[0];
  if (!video) {
    throw new Error('Video not found');
  }

  const title = video.snippet?.title ?? `YouTube – ${videoId}`;
  const durationISO = video.contentDetails?.duration ?? 'PT0S';
  const duration = parseDuration(durationISO);

  // Use InnerTube API (same as YouTube mobile app) to get stream URLs
  const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '17.31.35',
          androidSdkVersion: 30,
        },
      },
      videoId,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!playerResp.ok) {
    throw new Error('Failed to fetch stream URLs');
  }

  const playerData = await playerResp.json();
  const formats = playerData.streamingData?.adaptiveFormats ?? [];
  const audioFormats = formats.filter((f: { mimeType: string }) => 
    f.mimeType?.startsWith('audio/')
  );

  const best = audioFormats.sort((a: { bitrate: number }, b: { bitrate: number }) => 
    b.bitrate - a.bitrate
  )[0];

  if (!best?.url) {
    throw new Error('No audio stream found');
  }

  return {
    title,
    audioUrl: best.url,
    duration,
    source: 'youtube-api',
  };
}

function parseDuration(iso8601: string): number {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const videoId = req.query.v as string | undefined;
  const apiKey = req.query.apiKey as string | undefined;

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Missing or invalid video ID' });
  }

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing API key' });
  }

  try {
    console.log(`[YouTube Auth API] Extracting ${videoId} with user API key`);
    const result = await extractWithApiKey(videoId, apiKey);
    console.log(`[YouTube Auth API] ✓ Success`);
    return res.status(200).json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[YouTube Auth API] ✗ Failed: ${msg}`);
    return res.status(502).json({
      error: `Failed to extract video: ${msg}\n\nCheck that your API key is valid and has YouTube Data API v3 enabled.`,
    });
  }
}
