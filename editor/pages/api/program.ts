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

  // Next.js bisa set process.cwd() ke workspace root yang bukan root project ini.
  // Cari root project dari beberapa anchor supaya selalu pakai programs/main.af.json yang benar.
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
    triggers: [],
    actions: [],
    scriptTemplates: [],
    flows: { links: [] },
    assets: { assets: [], attributeTemplates: [] }
  };
  fs.writeFileSync(programPath, JSON.stringify(initialProgram, null, 2));
}

type ProgramResponse =
  | { program: Program; path: string; runtimeRead?: boolean }
  | { ok: true; path: string; runtimeSynced?: boolean; runtimeError?: string }
  | { error: string };

function getRuntimeAssetApiUrl() {
  return (
    process.env.KUFAYEKA_RUNTIME_ASSET_API?.trim() ||
    "http://127.0.0.1:4000/api/assets/system"
  );
}

async function fetchRuntimeAssets(): Promise<Program["assets"] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(getRuntimeAssetApiUrl(), {
      method: "GET",
      signal: controller.signal
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Program["assets"] };
    if (!data.data || typeof data.data !== "object") return null;
    return data.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function pushRuntimeAssets(
  assets: Program["assets"]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(getRuntimeAssetApiUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(assets)
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error || `Runtime API error ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProgramResponse>
) {
  const programPath = resolveProgramPath();
  ensureProgramFile(programPath);

  if (req.method === "GET") {
    const raw = fs.readFileSync(programPath, "utf8");
    const program = JSON.parse(raw) as Program;
    const runtimeAssets = await fetchRuntimeAssets();
    const nextProgram = runtimeAssets
      ? { ...program, assets: runtimeAssets }
      : program;
    res.status(200).json({ program: nextProgram, path: programPath, runtimeRead: Boolean(runtimeAssets) });
    return;
  }

  if (req.method === "PUT") {
    const body = (req.body ?? {}) as { program?: Program };
    if (!body.program || typeof body.program !== "object") {
      res.status(400).json({ error: "Body wajib punya object 'program'" });
      return;
    }

    const runtimeResult = await pushRuntimeAssets(body.program.assets);
    if (!runtimeResult.ok) {
      fs.writeFileSync(programPath, JSON.stringify(body.program, null, 2));
      res.status(200).json({
        ok: true,
        path: programPath,
        runtimeSynced: false,
        runtimeError: runtimeResult.error
      });
      return;
    }

    const runtimeAssets = await fetchRuntimeAssets();
    const programForSave: Program = runtimeAssets
      ? { ...body.program, assets: runtimeAssets }
      : body.program;
    fs.writeFileSync(programPath, JSON.stringify(programForSave, null, 2));

    res.status(200).json({ ok: true, path: programPath, runtimeSynced: true });
    return;
  }

  res.status(405).json({ error: `Method ${req.method} tidak didukung` });
}
