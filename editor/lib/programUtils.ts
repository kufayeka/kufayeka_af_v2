import type {
  ActionDefinition,
  AssetFrameworkDefinition,
  FlowLink,
  NodePosition,
  Program,
  ScriptVariableBindingDefinition,
  ScriptTemplateDefinition,
  TriggerDefinition
} from "../types/program";

export function upsertById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>
): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function renameNodeInLinks(links: FlowLink[], oldId: string, newId: string): FlowLink[] {
  return links.map((link) => ({
    ...link,
    from: link.from === oldId ? newId : link.from,
    to: link.to === oldId ? newId : link.to
  }));
}

export function removeNodeFromLinks(links: FlowLink[], nodeId: string): FlowLink[] {
  return links.filter((link) => link.from !== nodeId && link.to !== nodeId);
}

export function renameNodePositionKey(
  nodePositions: Record<string, NodePosition> | undefined,
  oldId: string,
  newId: string
): Record<string, NodePosition> {
  const next = { ...(nodePositions || {}) };
  if (oldId === newId) return next;
  if (!Object.prototype.hasOwnProperty.call(next, oldId)) return next;
  next[newId] = next[oldId];
  delete next[oldId];
  return next;
}

export function parseMaybeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function normalizeProgram(program: Program): Program {
  const normalizeAssetValueType = (
    value: unknown
  ):
    | "int8"
    | "uint8"
    | "int16"
    | "uint16"
    | "int32"
    | "uint32"
    | "float32"
    | "float64"
    | "boolean"
    | "string"
    | "array"
    | "object" => {
    const normalized = String(value || "string");
    if (
      normalized === "int8" ||
      normalized === "uint8" ||
      normalized === "int16" ||
      normalized === "uint16" ||
      normalized === "int32" ||
      normalized === "uint32" ||
      normalized === "float32" ||
      normalized === "float64" ||
      normalized === "boolean" ||
      normalized === "string" ||
      normalized === "array" ||
      normalized === "object"
    ) {
      return normalized;
    }
    if (normalized === "number") {
      return "float64";
    }
    return "string";
  };
  const normalizeBinding = (
    binding: Partial<ScriptVariableBindingDefinition> & {
      source?: string;
      staticType?: string;
      assetPath?: string;
      attribute?: { path?: string };
    }
  ): ScriptVariableBindingDefinition => {
    const rawSource = String(binding.source || "static_string");
    const staticType = String(binding.staticType || "string");
    const normalizedSource =
      rawSource === "asset"
        ? "asset"
        : rawSource === "attribute" || rawSource === "assetAttribute"
        ? "attribute"
        : rawSource === "static_number" ||
            rawSource === "static_string" ||
            rawSource === "static_boolean" ||
            rawSource === "static_array" ||
            rawSource === "static_object"
          ? rawSource
          : staticType === "number"
            ? "static_number"
            : staticType === "boolean"
              ? "static_boolean"
              : staticType === "array"
                ? "static_array"
                : staticType === "object"
                  ? "static_object"
                  : "static_string";
    return {
      name: String(binding.name ?? ""),
      source: normalizedSource,
      staticValue: binding.staticValue ?? "",
      attributePath: String(binding.attributePath ?? binding.assetPath ?? binding.attribute?.path ?? ""),
      allowOverride: binding.allowOverride === true
    };
  };

  const normalizedAssets: AssetFrameworkDefinition = {
    assets: (program.assets?.assets || []).map((asset) => ({
      ...asset,
      parentId: asset.parentId ?? null,
      templateIds: Array.isArray(asset.templateIds) ? asset.templateIds : [],
      attributes: asset.attributes || {}
    })),
    attributeTemplates: (program.assets?.attributeTemplates || []).map((template) => ({
      ...template,
      attributes: (template.attributes || []).map((attribute) => {
        const normalizedValueType = normalizeAssetValueType(
          (attribute as { valueType?: unknown; type?: unknown }).valueType ??
            (attribute as { type?: unknown }).type
        );

        return {
          enabled: attribute.enabled !== false,
          name: String(attribute.name ?? ""),
          valueType: normalizedValueType,
          default:
            (attribute as { default?: unknown }).default !== undefined
              ? (attribute as { default?: unknown }).default
              : (attribute as { defaultValue?: unknown }).defaultValue,
          unit: String(attribute.unit ?? ""),
          historianEnabled: (attribute as { historianEnabled?: unknown }).historianEnabled === true,
          historianTimeSourcePath: String((attribute as { historianTimeSourcePath?: unknown }).historianTimeSourcePath ?? ""),
          historianTargetId: String((attribute as { historianTargetId?: unknown }).historianTargetId ?? "default")
        };
      }).filter((attribute) => attribute.name.length > 0)
    })),
    historians: [
      {
        id: "default",
        name: "Default Historian",
        timestampUnit: "us" as "us" | "ns",
        enabled: true
      },
      ...((program.assets as { historians?: Array<Record<string, unknown>> } | undefined)?.historians || []).map((h) => ({
        id: String(h.id || ""),
        name: String(h.name || h.id || ""),
        timestampUnit: (String(h.timestampUnit || "us") === "ns" ? "ns" : "us") as "us" | "ns",
        enabled: h.enabled !== false
      })).filter((h) => h.id.length > 0)
    ].filter((h, i, arr) => arr.findIndex((x) => x.id === h.id) === i)
  };

  return {
    ...program,
    triggers: (program.triggers || []).map(
      (trigger): TriggerDefinition => {
        const rawType = String((trigger as { type?: unknown }).type || "interval");
        return {
          ...trigger,
        label: typeof trigger.label === "string" ? trigger.label : "",
        type:
          rawType === "watcher_set"
            ? "watcher_set"
            : rawType === "watcher_valuechange"
              ? "watcher_valuechange"
              : "interval",
        intervalMs: Math.max(1, Number(trigger.intervalMs) || 1000),
        watchPath:
          rawType === "watcher_set" ||
          rawType === "watcher_valuechange"
            ? String(trigger.watchPath || "").trim() || "*.*.*"
            : String(trigger.watchPath || ""),
        message: trigger.message && typeof trigger.message === "object" ? trigger.message : { payload: 0 },
        enabled: trigger.enabled !== false
      };
      }
    ),
    actions: (program.actions || []).map(
      (action): ActionDefinition => ({
        ...action,
        label: typeof action.label === "string" ? action.label : "",
        enabled: action.enabled !== false,
        allowTreeDuplicate: (action.allowTreeDuplicate ?? action.allowNodeDuplication) !== false,
        description: action.description ?? "",
        templateBindingOverrides:
          action.templateBindingOverrides && typeof action.templateBindingOverrides === "object"
            ? Object.fromEntries(
                Object.entries(action.templateBindingOverrides).map(([key, value]) => {
                  if (!value || typeof value !== "object") return [key, normalizeBinding({ name: key })];
                  return [key, normalizeBinding({ ...(value as ScriptVariableBindingDefinition), name: key })];
                })
              )
            : {}
      })
    ),
    scriptTemplates: (program.scriptTemplates || []).map(
      (template): ScriptTemplateDefinition => ({
        ...template,
        description: template.description ?? "",
        script: template.script ?? "send(msg);",
        allowTemplateReuse: (template.allowTemplateReuse ?? template.allowActionDuplication) !== false,
        variableBindings: Array.isArray(template.variableBindings)
          ? template.variableBindings.map((binding) =>
              normalizeBinding(binding as ScriptVariableBindingDefinition)
            )
          : []
      })
    ),
    flows: {
      ...program.flows,
      links: ((program.flows && program.flows.links) || []).map((link) => ({
        ...link,
        enabled: link.enabled !== false
      }))
    },
    assets: normalizedAssets
  };
}
