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

function buildRuntimeUrl(req: NextApiRequest): string {
  const rawPath = req.query.path;
  const pathSegments = Array.isArray(rawPath) ? rawPath : rawPath ? [rawPath] : [];
  const upstreamPath = pathSegments.map((item) => encodeURIComponent(String(item || ""))).join("/");
  const url = new URL(`${getRuntimeBaseUrl()}/api/${upstreamPath}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    if (value != null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setOpenCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    res.status(405).json({ error: `Method ${req.method} is not supported` });
    return;
  }

  try {
    const url = buildRuntimeUrl(req);
    const headers: Record<string, string> = {};
    if (method !== "GET" && method !== "DELETE") {
      headers["content-type"] = "application/json";
    }
    const upstream = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(req.body || {})
    });
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(text ? JSON.parse(text) : {});
    } catch {
      res.send(text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `Runtime API error: ${message}` });
  }
}
