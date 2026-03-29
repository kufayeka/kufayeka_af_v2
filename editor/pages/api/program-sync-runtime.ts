import fs from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Program } from "../../types/program";

function isProjectRoot(dir: string): boolean {
  return (
    fs.existsSync(path.resolve(dir, "index.js")) &&
    fs.existsSync(path.resolve(dir, "runtime", "Runtime.js")) &&
    fs.existsSync(path.resolve(dir, "editor", "package.json")) &&
    fs.existsSync(path.resolve(dir, "programs"))
  );
}

function findProjectRootFrom(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (isProjectRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveProgramPath() {
  const envPath = process.env.KUFAYEKA_PROGRAM_PATH;
  if (envPath && envPath.trim()) return path.resolve(envPath);

  const anchors = [process.cwd(), __dirname];
  for (const anchor of anchors) {
    const root = findProjectRootFrom(anchor);
    if (root) return path.resolve(root, "programs", "main.af.json");
  }

  const cwd = process.cwd();
  return path.resolve(cwd, "programs", "main.af.json");
}

function ensureProgramFile(programPath: string) {
  if (fs.existsSync(programPath)) return;
  fs.mkdirSync(path.dirname(programPath), { recursive: true });
  const initialProgram: Program = {
    meta: { name: "Kufayeka AF Program", version: 1 },
    eventTemplates: [],
    triggers: [],
    scriptTemplates: [],
    flows: { nodes: [], links: [] },
    assets: { assets: [], attributeTemplates: [] }
  };
  fs.writeFileSync(programPath, JSON.stringify(initialProgram, null, 2));
}

type SyncResponse =
  | { ok: true; path: string; runtimeUrl: string; program: Program }
  | { error: string };

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SyncResponse>
) {
  setOpenCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: `Method ${req.method} is not supported` });
    return;
  }

  const programPath = resolveProgramPath();
  ensureProgramFile(programPath);

  const runtimeUrl =
    process.env.KUFAYEKA_RUNTIME_ASSET_API?.trim() ||
    "http://127.0.0.1:4000/api/assets/system";

  try {
    const raw = fs.readFileSync(programPath, "utf8");
    const program = JSON.parse(raw) as Program;

    const runtimeRes = await fetch(runtimeUrl, { method: "GET" });
    if (!runtimeRes.ok) {
      res.status(502).json({ error: `Runtime API error ${runtimeRes.status}` });
      return;
    }

    const runtimeData = (await runtimeRes.json()) as {
      data?: Program["assets"];
    };
    if (!runtimeData.data || typeof runtimeData.data !== "object") {
      res.status(502).json({ error: "Runtime API did not return valid assets data" });
      return;
    }

    const next: Program = {
      ...program,
      assets: runtimeData.data
    };

    fs.writeFileSync(programPath, JSON.stringify(next, null, 2));
    res.status(200).json({ ok: true, path: programPath, runtimeUrl, program: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
}
