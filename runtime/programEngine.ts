import fs from "node:fs";
import path from "node:path";
import Runtime from "./Runtime";
import type { ProgramDefinition } from "./types";
export { startProgram } from "./flow/programBootstrap";

export function loadProgramFromFile(programPath: string): { absolutePath: string; program: ProgramDefinition } {
  const absolutePath = path.resolve(programPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const data = JSON.parse(raw) as ProgramDefinition;
  return { absolutePath, program: data };
}
