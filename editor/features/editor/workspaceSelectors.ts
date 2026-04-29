import { getTriggerBaseLabel } from "../../domains/flow/model";
import type {
  FlowDefinition,
  Program,
  TriggerDefinition
} from "../../types/program";

export function buildFlowNodeLabels(program: Program) {
  return Object.fromEntries(
    (program.flows?.nodes || []).map((node) => [node.id, (node.label || node.id).trim() || node.id]) as Array<[string, string]>
  );
}

export function buildFlowNodeSubtitles(program: Program) {
  return Object.fromEntries(
    (program.flows?.nodes || []).map((node) => {
      const templateLabel =
        node.kind === "action"
          ? program.scriptTemplates.find((item) => item.id === node.templateId)?.name
          : node.kind === "event_open" || node.kind === "event_close"
            ? (program.eventTemplates || []).find((item) => item.id === node.templateId)?.id
            : (program.triggerTemplates || []).find((item) => item.id === node.templateId)?.name ||
              getTriggerBaseLabel((node.config as Record<string, unknown> | undefined)?.type as TriggerDefinition["type"] || "interval");
      return [node.id, String(node.subtitle || templateLabel || node.label || node.id)];
    }) as Array<[string, string]>
  );
}

export function buildFlowNodeOutputs(program: Program) {
  return Object.fromEntries(
    (program.flows?.nodes || [])
      .filter((node) => node.kind === "action")
      .map((node) => {
        const templateOutputs = program.scriptTemplates.find((template) => template.id === node.templateId)?.outputs;
        const outputs = Array.isArray((node.config as Record<string, unknown> | undefined)?.outputs)
          ? (((node.config as Record<string, unknown>).outputs as unknown[])
              .map((item) => String(item || "").trim())
              .filter(Boolean))
          : Array.isArray(templateOutputs) && templateOutputs.length > 0
            ? templateOutputs.slice().sort((a, b) => a.order - b.order).map((item) => item.name)
            : ["out"];
        return [
          node.id,
          outputs.map((label, index) => ({ id: label || `out${index + 1}`, label: label || `OUT ${index + 1}` }))
        ];
      }) as Array<[string, Array<{ id: string; label: string }>]>
  );
}

export function buildFlowTriggerIds(program: Program) {
  return (program.flows?.nodes || []).filter((node) => node.kind === "trigger").map((node) => node.id);
}

export function buildFlowActionIds(program: Program) {
  return (program.flows?.nodes || []).filter((node) => node.kind === "action").map((node) => node.id);
}

export function buildFlowEventNodeIds(program: Program) {
  return (program.flows?.nodes || [])
    .filter((node) => node.kind === "event_open" || node.kind === "event_close")
    .map((node) => node.id);
}

export function buildActiveFlowVariableNames(activeFlow: FlowDefinition) {
  return (activeFlow.variables || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => item.name)
    .filter(Boolean);
}

export function buildWatchPathOptions(program: Program) {
  const byId = new Map(program.assets.assets.map((asset) => [asset.id, asset]));
  const templateById = new Map(program.assets.attributeTemplates.map((template) => [template.id, template]));

  const getAssetPath = (assetId: string): string => {
    const asset = byId.get(assetId);
    if (!asset) return "";
    const parts = [asset.name];
    let parentId = asset.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }
    return parts.join(".");
  };

  const paths = new Set<string>(["*.*.*"]);
  for (const asset of program.assets.assets) {
    const assetPath = getAssetPath(asset.id);
    if (!assetPath) continue;
    const attributes = new Set<string>(Object.keys(asset.attributes || {}));
    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attr of template.attributes || []) {
        if (attr.enabled === false) continue;
        attributes.add(attr.name);
      }
    }
    for (const attributeName of attributes) {
      const full = `${assetPath}.${attributeName}`;
      paths.add(full);
      const segments = full.split(".");
      if (segments.length >= 2) {
        paths.add(`${segments.slice(0, -1).join(".")}.*`);
        paths.add(`${segments[0]}.*.${segments[segments.length - 1]}`);
      }
    }
  }

  return Array.from(paths).sort((a, b) => a.localeCompare(b));
}

export function buildEventWatchPathOptions(program: Program) {
  const options = new Set<string>(["*"]);
  for (const template of program.triggerTemplates || []) {
    if (template.type !== "watcher_event_open" && template.type !== "watcher_event_close") continue;
    const pattern = String(template.watchPath || "").trim();
    if (!pattern) continue;
    options.add(pattern);
  }
  return Array.from(options).sort((a, b) => a.localeCompare(b));
}
