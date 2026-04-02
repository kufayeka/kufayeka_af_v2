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
  if (envPath && envPath.trim()) {
    return path.resolve(envPath);
  }

  // Next.js can set process.cwd() to a workspace root that is not this project root.
  // Resolve project root from multiple anchors to consistently use programs/main.af.json.
  const anchors = [process.cwd(), __dirname];
  for (const anchor of anchors) {
    const root = findProjectRootFrom(anchor);
    if (root) {
      return path.resolve(root, "programs", "main.af.json");
    }
  }

  const cwd = process.cwd();
  const cwdBasename = path.basename(cwd).toLowerCase();
  const rootCandidate = path.resolve(cwd, "programs", "main.af.json");
  const editorCandidate = path.resolve(cwd, "..", "programs", "main.af.json");

  const hasRootPrograms = fs.existsSync(path.resolve(cwd, "programs"));
  const hasEditorSiblingPrograms = fs.existsSync(path.resolve(cwd, "..", "programs"));

  if (cwdBasename === "editor" && hasEditorSiblingPrograms) {
    return editorCandidate;
  }
  if (hasRootPrograms) {
    return rootCandidate;
  }
  if (hasEditorSiblingPrograms) {
    return editorCandidate;
  }

  return cwdBasename === "editor" ? editorCandidate : rootCandidate;
}

function ensureProgramFile(programPath: string) {
  if (fs.existsSync(programPath)) {
    return;
  }

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

type ProgramResponse =
  | { program: Program; path: string; workspace: true }
  | { ok: true; path: string; workspaceSaved: true }
  | { error: string };

function containsPersistedAttributeValues(program: Program): boolean {
  const assets = program.assets?.assets || [];
  for (const asset of assets) {
    const attributes = asset?.attributes && typeof asset.attributes === "object" ? asset.attributes : {};
    if (Object.keys(attributes).length > 0) return true;
  }
  return false;
}

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
  res: NextApiResponse<ProgramResponse>
) {
  setOpenCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const programPath = resolveProgramPath();
  ensureProgramFile(programPath);

  if (req.method === "GET") {
    const raw = fs.readFileSync(programPath, "utf8");
    const program = JSON.parse(raw) as Program;
    res.status(200).json({ program, path: programPath, workspace: true });
    return;
  }

  if (req.method === "PUT") {
    const body = (req.body ?? {}) as { program?: Program };
    if (!body.program || typeof body.program !== "object") {
      res.status(400).json({ error: "Body must include a 'program' object" });
      return;
    }
    if (containsPersistedAttributeValues(body.program)) {
      res.status(400).json({
        error:
          "Workspace save is not allowed to persist asset attribute values. Apply values via runtime/effective attribute flow."
      });
      return;
    }

    fs.writeFileSync(programPath, JSON.stringify(body.program, null, 2));
    res.status(200).json({ ok: true, path: programPath, workspaceSaved: true });
    return;
  }

  res.status(405).json({ error: `Method ${req.method} is not supported` });
}
