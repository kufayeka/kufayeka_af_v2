import type {
  EventActionBindingDefinition,
  EventNodeSummary,
  EventTemplateDefinition,
  EventTemplateInputBindingDefinition,
  FlowNodeDefinition
} from "../../types/program";

export function deriveEventNodeSummaries(nodes: FlowNodeDefinition[]): EventNodeSummary[] {
  const grouped = new Map<string, { open?: FlowNodeDefinition; close?: FlowNodeDefinition }>();
  nodes.forEach((node) => {
    if (node.kind !== "event_open" && node.kind !== "event_close") return;
    const key = node.refId;
    const entry = grouped.get(key) || {};
    if (node.kind === "event_open") entry.open = node;
    if (node.kind === "event_close") entry.close = node;
    grouped.set(key, entry);
  });
  return Array.from(grouped.entries()).map(([id, entry]) => {
    const openConfig = (entry.open?.config || {}) as Record<string, unknown>;
    const closeConfig = (entry.close?.config || {}) as Record<string, unknown>;
    return {
      id,
      label: (entry.open?.label || entry.close?.label || "").replace(/^OPEN\s+|^CLOSE\s+/i, ""),
      enabled: (entry.open?.enabled ?? entry.close?.enabled) !== false,
      description: String(openConfig.description ?? closeConfig.description ?? ""),
      templateId: entry.open?.templateId || entry.close?.templateId || "",
      templateOverrides: (openConfig.templateOverrides || closeConfig.templateOverrides || {}) as any,
      bindings: (openConfig.bindings || closeConfig.bindings || {}) as any,
      openNotes: String(openConfig.openNotes ?? ""),
      closeNotes: String(closeConfig.closeNotes ?? "")
    };
  });
}

export function collectTemplateVariables(template: EventTemplateDefinition | undefined): string[] {
  if (!template) return [];
  if ((template.bindings || []).length > 0) {
    return (template.bindings || []).map((item) => item.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  const keys = new Set<string>();
  const collectFromString = (input: string | undefined) => {
    for (const match of String(input || "").matchAll(/\{([^}]+)\}/g)) {
      const key = String(match[1] || "").trim();
      if (key) keys.add(key);
    }
  };
  (template.eventPathBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.closePatternBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.assetPaths || []).forEach((item) => {
    if (item.source === "variable" && item.key) keys.add(item.key);
  });
  Object.values(template.contextBindings || {}).forEach((binding) => {
    if (binding.source === "variable" && binding.key) keys.add(binding.key);
    if (binding.source === "attribute" && binding.pathTemplate) collectFromString(binding.pathTemplate);
  });
  (template.contextFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  (template.captureFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  if (template.timeSource?.open?.source === "variable" && template.timeSource.open.key) keys.add(template.timeSource.open.key);
  if (template.timeSource?.close?.source === "variable" && template.timeSource.close.key) keys.add(template.timeSource.close.key);
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

export function defaultEventBindingForVariable(name: string): EventActionBindingDefinition {
  if (name.toLowerCase().includes("asset")) return { source: "asset", attributePath: "" };
  if (name.toLowerCase().includes("time") || name === "timestamp") return { source: "msg_path", attributePath: "ts" };
  return { source: "msg_path", attributePath: `payload.${name}` };
}

export function eventTemplateBindingToActionBinding(
  binding: EventTemplateInputBindingDefinition
): EventActionBindingDefinition {
  const fallback = defaultEventBindingForVariable(binding.name);
  const source = binding.source || fallback.source;
  if (source === "asset" || source === "attribute" || source === "flow_variable" || source === "msg_path") {
    return {
      source,
      attributePath:
        typeof binding.defaultValue === "string"
          ? binding.defaultValue
          : fallback.attributePath ?? ""
    };
  }
  if (source === "static_boolean") {
    return {
      source,
      staticValue: binding.defaultValue === true
    };
  }
  if (source === "static_number") {
    return {
      source,
      staticValue: Number(binding.defaultValue ?? 0)
    };
  }
  return {
    source,
    staticValue: binding.defaultValue ?? ""
  };
}

export function buildEventActionBindingsFromTemplate(
  template: EventTemplateDefinition
): Record<string, EventActionBindingDefinition> {
  const explicit = new Map(
    (template.bindings || [])
      .filter((item) => String(item.name || "").trim())
      .map((item) => [String(item.name).trim(), eventTemplateBindingToActionBinding(item)])
  );
  for (const key of collectTemplateVariables(template)) {
    if (!explicit.has(key)) explicit.set(key, defaultEventBindingForVariable(key));
  }
  return Object.fromEntries(explicit);
}
