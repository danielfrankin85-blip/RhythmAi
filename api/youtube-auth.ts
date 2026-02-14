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

interface GoogleApiError {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface PlayerFormat {
  mimeType?: string;
  bitrate?: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
}

function classifyGoogleApiError(status: number, body: GoogleApiError | null): string {
  const reason = body?.error?.errors?.[0]?.reason ?? '';
  const message = body?.error?.message ?? `YouTube API error (${status})`;

  if (reason === 'accessNotConfigured' || reason === 'forbidden') {
    return 'Your API key is blocked from this server request. In Google Cloud key settings, remove HTTP referrer restriction for this key or create a server key with YouTube Data API v3 enabled.';
  }

  if (reason === 'keyInvalid') {
    return 'The API key is invalid. Paste a valid YouTube Data API v3 key.';
  }

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return 'Your YouTube API quota is exhausted for today. Try again tomorrow or use a different key.';
  }

  return message;
}

async function fetchVideoMeta(videoId: string, apiKey: string): Promise<{ title: string; duration: number }> {
  const metaResp = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!metaResp.ok) {
    const body = (await metaResp.json().catch(() => null)) as GoogleApiError | null;
    throw new Error(classifyGoogleApiError(metaResp.status, body));
  }

  const metaData = await metaResp.json();
  const video = metaData.items?.[0];
  if (!video) {
    throw new Error('Video not found (private, deleted, or unavailable to this key).');
  }

  if (video.status?.embeddable === false) {
    throw new Error('This video is not embeddable, so direct stream extraction is blocked.');
  }

  const title = video.snippet?.title ?? `YouTube – ${videoId}`;
  const durationISO = video.contentDetails?.duration ?? 'PT0S';
  return { title, duration: parseDuration(durationISO) };
}

function extractDirectUrl(format: PlayerFormat): string | null {
  if (format.url) return format.url;

  const cipher = format.signatureCipher ?? format.cipher;
  if (!cipher) return null;

  const params = new URLSearchParams(cipher);
  const baseUrl = params.get('url');
  if (!baseUrl) return null;

  const sig = params.get('sig');
  const sp = params.get('sp') ?? 'signature';

  if (sig) {
    const url = new URL(baseUrl);
    url.searchParams.set(sp, sig);
    return url.toString();
  }

  return null;
}

async function fetchPlayerData(videoId: string): Promise<string | null> {
  const clients = [
    { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 34 },
    { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0' },
    { clientName: 'IOS', clientVersion: '20.03.02' },
  ];

  for (const client of clients) {
    try {
      const playerResp = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!playerResp.ok) continue;

      const playerData = await playerResp.json();
      const adaptive = (playerData.streamingData?.adaptiveFormats ?? []) as PlayerFormat[];
      const muxed = (playerData.streamingData?.formats ?? []) as PlayerFormat[];
      const allFormats = [...adaptive, ...muxed];

      const audioFormats = allFormats
        .filter((f) => f.mimeType?.startsWith('audio/'))
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

      for (const format of audioFormats) {
        const directUrl = extractDirectUrl(format);
        if (directUrl) return directUrl;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function extractWithApiKey(videoId: string, apiKey: string): Promise<VideoInfo> {
  const meta = await fetchVideoMeta(videoId, apiKey);
  const audioUrl = await fetchPlayerData(videoId);

  if (!audioUrl) {
    throw new Error('YouTube returned only protected/ciphered streams for this video. Try another video or leave API key blank to use proxy fallback.');
  }

  return {
    title: meta.title,
    audioUrl,
    duration: meta.duration,
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

    const isKeyIssue =
      msg.includes('API key') ||
      msg.includes('quota') ||
      msg.includes('Google Cloud') ||
      msg.includes('forbidden') ||
      msg.includes('invalid');

    return res.status(isKeyIssue ? 403 : 502).json({
      error: msg,
    });
  }
}
