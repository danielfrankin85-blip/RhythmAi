import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  // Allow up to 60 s for large audio downloads
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const audioUrl = req.query.url as string | undefined;
  if (!audioUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    const upstream = await fetch(audioUrl, {
      signal: AbortSignal.timeout(55000),
      headers: { 'User-Agent': 'RhythmAI/1.0' },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    }

    // Forward content-type and stream the body
    const contentType = upstream.headers.get('content-type') || 'audio/webm';
    const contentLength = upstream.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Stream the response
    const body = upstream.body;
    if (!body) {
      // Fallback: buffer entire response
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return res.status(200).send(buffer);
    }

    // Node readable stream from web ReadableStream
    const reader = body.getReader();
    const push = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        const ok = res.write(value);
        if (!ok) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
    };
    await push();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({ error: `Download failed: ${(err as Error).message}` });
    }
    res.end();
  }
}
