import type { NextApiRequest, NextApiResponse } from "next";

function setOpenCors(res: NextApiResponse): void {
  const preferredCorsOrigin = "http://192.168.68.99:3333";
  const requestOrigin =
    typeof res.req?.headers.origin === "string" ? res.req.headers.origin : undefined;
  if (requestOrigin === preferredCorsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", preferredCorsOrigin);
  } else if (requestOrigin && requestOrigin.trim()) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
  const requestHeaders =
    typeof res.req?.headers["access-control-request-headers"] === "string"
      ? res.req.headers["access-control-request-headers"]
      : "*";
  res.setHeader("Access-Control-Allow-Headers", requestHeaders);
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getRuntimeBaseUrl(): string {
  return process.env.KUFAYEKA_RUNTIME_API_BASE?.trim() || "http://127.0.0.1:4000";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setOpenCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.status(405).json({ error: `Method ${req.method} is not supported` });
    return;
  }

  const rawKey = req.query.key;
  const key = Array.isArray(rawKey) ? rawKey.join("/") : String(rawKey || "");
  if (!key) {
    res.status(400).json({ error: "Key is required" });
    return;
  }

  const url = `${getRuntimeBaseUrl()}/api/global/${encodeURIComponent(key)}`;
  try {
    if (req.method === "GET") {
      const upstream = await fetch(url, { method: "GET" });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
      return;
    }

    if (req.method === "DELETE") {
      const upstream = await fetch(url, { method: "DELETE" });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
      return;
    }

    const upstream = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `Runtime API error: ${message}` });
  }
}

