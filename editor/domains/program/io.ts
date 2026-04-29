import { hydrateActiveFlow, migrateProgramIdentity } from "../flow/model";
import { deriveScriptNodeSummaries } from "../script/model";
import { normalizeProgram } from "../../lib/programUtils";
import type { FlowNodeDefinition, Program } from "../../types/program";

export function syncProgramActionScripts(
  program: Program,
  selectedFlowId: string,
  latestActionScripts: Record<string, string>,
  options?: { stripAssetValues?: boolean }
): Program {
  const activeFlowId = program.activeFlowId || program.flows.activeFlowId || selectedFlowId;
  const syncedFlowDefinitions = (program.flowDefinitions || []).map((flow) =>
    flow.id === activeFlowId
      ? {
          ...flow,
          nodes: ((flow.nodes || []) as FlowNodeDefinition[]).map((node) =>
            node.kind === "action"
              ? {
                  ...node,
                  config: {
                    ...(node.config || {}),
                    script:
                      latestActionScripts[node.id] !== undefined
                        ? latestActionScripts[node.id]
                        : String((node.config as Record<string, unknown> | undefined)?.script ?? "")
                  }
                }
              : node
          )
        }
      : flow
  );

  const nextProgram: Program = {
    ...program,
    flowDefinitions: syncedFlowDefinitions
  };

  if (!options?.stripAssetValues) {
    return hydrateActiveFlow(nextProgram, activeFlowId);
  }

  return hydrateActiveFlow(
    {
      ...nextProgram,
      assets: {
        ...program.assets,
        assets: (program.assets?.assets || []).map((asset) => ({
          ...asset,
          attributes: {}
        }))
      }
    },
    activeFlowId
  );
}

export function buildWorkspaceProgramForSave(
  program: Program,
  selectedFlowId: string,
  latestActionScripts: Record<string, string>
): Program {
  return syncProgramActionScripts(program, selectedFlowId, latestActionScripts, {
    stripAssetValues: true
  });
}

export function buildProgramForExport(
  program: Program,
  selectedFlowId: string,
  latestActionScripts: Record<string, string>
): Program {
  return syncProgramActionScripts(program, selectedFlowId, latestActionScripts);
}

export async function saveProgramToWorkspace(program: Program): Promise<{ path?: string }> {
  const res = await fetch("/api/program", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ program })
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "unknown error");
  }

  return (await res.json()) as { path?: string };
}

export function downloadProgramJsonFile(program: Program, programName: string): string {
  const json = JSON.stringify(program, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filenameBase = (programName || "program")
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const filename = `${filenameBase || "program"}.af.json`;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export async function importProgramFromFile(file: File): Promise<Program> {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as Program;
  return migrateProgramIdentity(normalizeProgram(parsed));
}

export function collectLatestActionScripts(program: Program): Record<string, string> {
  return Object.fromEntries(
    deriveScriptNodeSummaries(program.flows.nodes || []).map((action) => [action.id, action.script || ""])
  );
}
