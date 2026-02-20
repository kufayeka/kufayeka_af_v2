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
  | { program: Program; path: string }
  | { ok: true; path: string }
  | { error: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProgramResponse>
) {
  const programPath = resolveProgramPath();
  ensureProgramFile(programPath);

  if (req.method === "GET") {
    const raw = fs.readFileSync(programPath, "utf8");
    const program = JSON.parse(raw) as Program;
    res.status(200).json({ program, path: programPath });
    return;
  }

  if (req.method === "PUT") {
    const body = (req.body ?? {}) as { program?: Program };
    if (!body.program || typeof body.program !== "object") {
      res.status(400).json({ error: "Body wajib punya object 'program'" });
      return;
    }

    fs.writeFileSync(programPath, JSON.stringify(body.program, null, 2));
    res.status(200).json({ ok: true, path: programPath });
    return;
  }

  res.status(405).json({ error: `Method ${req.method} tidak didukung` });
}
