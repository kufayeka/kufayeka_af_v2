import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "node:stream";

function getRuntimeBaseUrl(): string {
  return process.env.KUFAYEKA_RUNTIME_API_BASE?.trim() || "http://127.0.0.1:4000";
}

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const abortController = new AbortController();

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const closeStream = () => {
    abortController.abort();
    try {
      res.end();
    } catch {
      // ignore
    }
  };

  _req.on("close", closeStream);

  try {
    const upstream = await fetch(`${getRuntimeBaseUrl()}/api/node-status/stream`, {
      headers: {
        Accept: "text/event-stream"
      },
      signal: abortController.signal
    });

    if (!upstream.ok || !upstream.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: `Upstream SSE error ${upstream.status}` })}\n\n`);
      closeStream();
      return;
    }

    const stream = Readable.fromWeb(upstream.body as any);
    stream.on("error", () => closeStream());
    stream.pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    closeStream();
  }
}
