import type { RuntimeNodeHandler, ProgramDefinition } from "../core/runtimeTypes";
import type { ProgramFlowDefinition } from "./ProgramFlowContracts";

export function resolveFlowVariableValue(
  variable: { source?: string; staticValue?: unknown; attributePath?: string },
  runtimeContext: Parameters<RuntimeNodeHandler>[2]
): unknown {
  const source = String(variable?.source || "static_string");
  const path = String(variable?.attributePath || "").trim();
  if (source === "asset") {
    if (!path) return null;
    const matches = runtimeContext.asset.query(path).filter((item) => item.kind === "asset");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }
  if (source === "attribute") {
    if (!path) return null;
    const matches = runtimeContext.asset.query(path).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }
  if (source === "static_number") return Number(variable?.staticValue || 0);
  if (source === "static_boolean") return variable?.staticValue === true || String(variable?.staticValue).toLowerCase() === "true";
  if (source === "static_array") return Array.isArray(variable?.staticValue) ? variable?.staticValue : [];
  if (source === "static_object") return variable?.staticValue && typeof variable.staticValue === "object" ? variable.staticValue : {};
  return variable?.staticValue ?? "";
}

export function buildProgramFlows(program: ProgramDefinition): ProgramFlowDefinition[] {
  if (Array.isArray(program.flowDefinitions) && program.flowDefinitions.length > 0) {
    return program.flowDefinitions as ProgramFlowDefinition[];
  }
  return [
    {
      id: String((program.flows as { id?: unknown } | undefined)?.id || "flow_main"),
      name: String((program.flows as { name?: unknown } | undefined)?.name || "Main Flow"),
      enabled: (program.flows as { enabled?: unknown } | undefined)?.enabled !== false,
      variables: Array.isArray((program.flows as { variables?: unknown } | undefined)?.variables)
        ? ((program.flows as { variables?: unknown[] }).variables as ProgramFlowDefinition["variables"])
        : [],
      nodes: Array.isArray(program.flows?.nodes) ? (program.flows?.nodes as ProgramFlowDefinition["nodes"]) : [],
      links: Array.isArray(program.flows?.links) ? (program.flows?.links as ProgramFlowDefinition["links"]) : [],
      nodePositions:
        program.flows?.nodePositions && typeof program.flows.nodePositions === "object"
          ? (program.flows.nodePositions as Record<string, unknown>)
          : {}
    }
  ];
}
