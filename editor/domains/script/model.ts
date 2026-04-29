import type { FlowNodeDefinition, ScriptNodeSummary } from "../../types/program";

export function deriveScriptNodeSummaries(nodes: FlowNodeDefinition[]): ScriptNodeSummary[] {
  return nodes
    .filter((node) => node.kind === "action")
    .map((node) => ({
      id: node.id,
      label: node.label ?? "",
      type: "script",
      enabled: node.enabled !== false,
      description: String((node.config as Record<string, unknown> | undefined)?.description ?? ""),
      templateId: node.templateId ?? "",
      templateBindingOverrides:
        (((node.config as Record<string, unknown> | undefined)?.templateBindingOverrides as Record<string, unknown>) || {}) as any,
      eventTemplateId: String((node.config as Record<string, unknown> | undefined)?.eventTemplateId ?? ""),
      eventTemplateOverrides:
        (((node.config as Record<string, unknown> | undefined)?.eventTemplateOverrides as Record<string, unknown>) || {}) as any,
      script: String((node.config as Record<string, unknown> | undefined)?.script ?? "")
    }));
}
