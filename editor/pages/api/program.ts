import fs from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Program } from "../../types/program";

function resolveProgramPath() {
  const envPath = process.env.KUFAYEKA_PROGRAM_PATH;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath);
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

const PROGRAM_PATH = resolveProgramPath();

function ensureProgramFile() {
  if (fs.existsSync(PROGRAM_PATH)) {
    return;
  }

  fs.mkdirSync(path.dirname(PROGRAM_PATH), { recursive: true });
  const initialProgram: Program = {
    meta: { name: "Kufayeka AF Program", version: 1 },
    triggers: [],
    actions: [],
    flows: { links: [] }
  };
  fs.writeFileSync(PROGRAM_PATH, JSON.stringify(initialProgram, null, 2));
}

type ProgramResponse = { program: Program } | { ok: true } | { error: string };

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProgramResponse>
) {
  ensureProgramFile();

  if (req.method === "GET") {
    const raw = fs.readFileSync(PROGRAM_PATH, "utf8");
    const program = JSON.parse(raw) as Program;
    res.status(200).json({ program });
    return;
  }

  if (req.method === "PUT") {
    const body = (req.body ?? {}) as { program?: Program };
    if (!body.program || typeof body.program !== "object") {
      res.status(400).json({ error: "Body wajib punya object 'program'" });
      return;
    }

    fs.writeFileSync(PROGRAM_PATH, JSON.stringify(body.program, null, 2));
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: `Method ${req.method} tidak didukung` });
}
