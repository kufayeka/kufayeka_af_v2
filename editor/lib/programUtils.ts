import type {
  AssetFrameworkDefinition,
  EventActionBindingDefinition,
  EventTemplateAssetPathDefinition,
  EventTemplateInputBindingDefinition,
  EventTemplateFieldDefinition,
  EventTemplateDefinition,
  EventTemplatePathSegmentDefinition,
  FlowLink,
  FlowDefinition,
  FlowVariableDefinition,
  FlowNodeDefinition,
  NodePosition,
  Program,
  ScriptOutputDefinition,
  ScriptVariableBindingDefinition,
  ScriptTemplateDefinition,
  TriggerDefinition,
  TriggerTemplateDefinition
} from "../types/program";

function normalizeScriptOutputs(raw: unknown): ScriptOutputDefinition[] {
  if (!Array.isArray(raw)) return [{ name: "out", order: 1, description: "" }];
  const normalized = raw
    .map((item, index): ScriptOutputDefinition | null => {
      if (typeof item === "string") {
        const name = item.trim();
        if (!name) return null;
        return { name, order: index + 1, description: "" };
      }
      if (!item || typeof item !== "object") return null;
      const typed = item as { name?: unknown; order?: unknown; description?: unknown };
      const name = String(typed.name || "").trim();
      if (!name) return null;
      const order = Math.max(1, Number(typed.order || index + 1) || index + 1);
      return {
        name,
        order,
        description: String(typed.description || "")
      };
    })
    .filter((item): item is ScriptOutputDefinition => Boolean(item))
    .sort((a, b) => a.order - b.order);
  return normalized.length > 0 ? normalized : [{ name: "out", order: 1, description: "" }];
}

function normalizeFlowVariable(raw: unknown, index: number): FlowVariableDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const typed = raw as {
    name?: unknown;
    order?: unknown;
    description?: unknown;
    source?: unknown;
    staticValue?: unknown;
    attributePath?: unknown;
  };
  const name = String(typed.name || "").trim();
  if (!name) return null;
  const source = String(typed.source || "static_string");
  return {
    name,
    order: Math.max(1, Number(typed.order || index + 1) || index + 1),
    description: String(typed.description || ""),
    source:
      source === "asset" ||
      source === "attribute" ||
      source === "static_number" ||
      source === "static_boolean" ||
      source === "static_array" ||
      source === "static_object"
        ? (source as FlowVariableDefinition["source"])
        : "static_string",
    staticValue: typed.staticValue ?? "",
    attributePath: String(typed.attributePath ?? "")
  };
}

function normalizeFlowVariables(raw: unknown): FlowVariableDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => normalizeFlowVariable(item, index))
    .filter((item): item is FlowVariableDefinition => Boolean(item))
    .sort((a, b) => a.order - b.order);
}

export function getEventActionOpenNodeId(id: string): string {
  return `event.open.${id}`;
}

export function getEventActionCloseNodeId(id: string): string {
  return `event.close.${id}`;
}

export function sanitizeProgramStructure(program: Program): Program {
  const flowDefinitions = Array.isArray(program.flowDefinitions) ? program.flowDefinitions : [];
  const preferredActiveFlowId =
    String(program.activeFlowId ?? program.flows?.activeFlowId ?? "").trim() ||
    String(flowDefinitions[0]?.id ?? "").trim() ||
    "flow_main";
  const activeFlow =
    flowDefinitions.find((flow) => String(flow.id || "").trim() === preferredActiveFlowId) ||
    flowDefinitions[0] || {
      id: preferredActiveFlowId,
      name: "Main Flow",
      description: "",
      enabled: true,
      variables: [],
      nodes: [],
      links: [],
      nodePositions: {}
    };
  return {
    ...program,
    activeFlowId: activeFlow.id,
    flows: {
      ...(program.flows || { links: [] }),
      id: activeFlow.id,
      name: activeFlow.name,
      description: activeFlow.description || "",
      enabled: activeFlow.enabled !== false,
      variables: Array.isArray(activeFlow.variables) ? activeFlow.variables.map((item) => ({ ...item })) : [],
      activeFlowId: activeFlow.id,
      nodes: (Array.isArray(activeFlow.nodes) ? activeFlow.nodes : []).map((node) => ({ ...node })),
      links: (activeFlow.links || []).map((link) => ({ ...link })),
      nodePositions: { ...(activeFlow.nodePositions || {}) }
    }
  };
}

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

export function normalizeEventTemplatePathSegment(
  value: EventTemplatePathSegmentDefinition
): EventTemplatePathSegmentDefinition {
  const type = String(value.type || "static");
  return {
    type:
      type === "binding" ||
      type === "asset_path" ||
      type === "variable" ||
      type === "context_field" ||
      type === "captured_value" ||
      type === "wildcard"
        ? type
        : "static",
    value: String(value.value ?? ""),
    separator:
      value.separator === "/" || value.separator === "." || value.separator === "-" ? value.separator : ""
  };
}

export function normalizeEventTemplateInputBinding(
  value: Partial<EventTemplateInputBindingDefinition>
): EventTemplateInputBindingDefinition {
  const source = String(value.source || "msg_path");
  return {
    name: String(value.name ?? "").trim(),
    source:
      source === "asset" ||
      source === "attribute" ||
      source === "static_number" ||
      source === "static_string" ||
      source === "static_boolean" ||
      source === "static_array" ||
      source === "static_object"
        ? source
        : "msg_path",
    templateId: String(value.templateId ?? "").trim(),
    defaultValue: value.defaultValue
  };
}

export function renderEventTemplatePathBuilder(
  builder: EventTemplatePathSegmentDefinition[] | undefined
): string {
  return (builder || [])
    .map((segment) => {
      const normalized = normalizeEventTemplatePathSegment(segment);
      const body =
        normalized.type === "wildcard"
          ? "*"
          : normalized.type === "static"
            ? normalized.value || ""
            : normalized.value
              ? `{${normalized.value}}`
              : "";
      return `${body}${normalized.separator || ""}`;
    })
    .join("")
    .trim();
}

export function parseEventTemplatePathBuilder(template: string | undefined): EventTemplatePathSegmentDefinition[] {
  const input = String(template || "").trim();
  if (!input) return [];
  const output: EventTemplatePathSegmentDefinition[] = [];
  let i = 0;
  while (i < input.length) {
    let type: EventTemplatePathSegmentDefinition["type"] = "static";
    let value = "";
    if (input[i] === "{") {
      const end = input.indexOf("}", i + 1);
      if (end > i) {
        type = "variable";
        value = input.slice(i + 1, end).trim();
        i = end + 1;
      } else {
        value = input[i];
        i += 1;
      }
    } else if (input[i] === "*") {
      type = "wildcard";
      value = "*";
      i += 1;
    } else {
      const start = i;
      while (i < input.length && input[i] !== "{" && input[i] !== "*" && input[i] !== "/" && input[i] !== "." && input[i] !== "-") {
        i += 1;
      }
      value = input.slice(start, i);
    }
    let separator: EventTemplatePathSegmentDefinition["separator"] = "";
    if (i < input.length && (input[i] === "/" || input[i] === "." || input[i] === "-")) {
      separator = input[i] as EventTemplatePathSegmentDefinition["separator"];
      i += 1;
    }
    if (type === "static" && !value && !separator) continue;
    output.push(normalizeEventTemplatePathSegment({ type, value, separator }));
  }
  return output;
}

function normalizeEventTemplateConcurrencyMode(value: unknown): EventTemplateDefinition["concurrencyMode"] {
  const mode = String(value || "").trim();
  if (mode === "unique_exact_path" || mode === "unique_pattern") return mode;
  return "parallel";
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
        : rawSource === "flow_variable"
          ? "flow_variable"
        : rawSource === "msg_path"
          ? "msg_path"
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
  const normalizeEventActionBinding = (
    binding: Partial<EventActionBindingDefinition> & {
      source?: string;
      staticType?: string;
      assetPath?: string;
      attribute?: { path?: string };
    }
  ): EventActionBindingDefinition => {
    const normalized = normalizeBinding({
      name: "event_binding",
      source: binding.source,
      staticType: binding.staticType,
      staticValue: binding.staticValue,
      attributePath: binding.attributePath,
      assetPath: binding.assetPath,
      attribute: binding.attribute
    });
    return {
      source: normalized.source,
      staticValue: normalized.staticValue,
      attributePath: normalized.attributePath
    };
  };
  const normalizeEventTemplateAssetPath = (
    item: Partial<EventTemplateAssetPathDefinition>
  ): EventTemplateAssetPathDefinition => ({
    id: String(item.id ?? "").trim(),
    source: item.source === "static" ? "static" : "variable",
    key: String(item.key ?? "").trim(),
    value: String(item.value ?? "").trim(),
    templateId: String(item.templateId ?? "").trim()
  });
  const normalizeEventTemplateField = (
    item: Partial<EventTemplateFieldDefinition>
  ): EventTemplateFieldDefinition => ({
    key: String(item.key ?? "").trim(),
    source:
      item.source === "asset_path_attribute"
        ? "asset_path_attribute"
        : item.source === "captured_value"
          ? "captured_value"
          : item.source === "static"
            ? "static"
            : "variable",
    variableKey: String(item.variableKey ?? "").trim(),
    value: item.value ?? "",
    assetPathId: String(item.assetPathId ?? "").trim(),
    attributeName: String(item.attributeName ?? "").trim(),
    capturedKey: String(item.capturedKey ?? "").trim()
  });

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

  const normalizedEventTemplates: EventTemplateDefinition[] = Array.isArray(program.eventTemplates)
    ? program.eventTemplates
        .map((item) => {
          const snapshotTemplateId = String((item as { snapshotTemplateId?: unknown }).snapshotTemplateId ?? "").trim();
          const bindings = Array.isArray((item as { bindings?: unknown[] }).bindings)
            ? ((item as { bindings?: unknown[] }).bindings || [])
                .map((entry) => normalizeEventTemplateInputBinding(entry as EventTemplateInputBindingDefinition))
                .filter((entry) => entry.name.length > 0)
            : [];
          const normalizedAssetPaths = Array.isArray((item as { assetPaths?: unknown[] }).assetPaths)
            ? ((item as { assetPaths?: unknown[] }).assetPaths || [])
                .map((entry) => normalizeEventTemplateAssetPath(entry as EventTemplateAssetPathDefinition))
                .filter((entry) => entry.id.length > 0)
            : [];
          const legacyAssetPathTemplate = String((item as { assetPathTemplate?: unknown }).assetPathTemplate ?? "").trim();
          const derivedAssetPaths = bindings
            .filter((entry) => entry.source === "asset")
            .map((entry) => normalizeEventTemplateAssetPath({
              id: entry.name,
              source: "variable",
              key: entry.name,
              value: "",
              templateId: entry.templateId || ""
            }));
          const assetPaths = derivedAssetPaths.length > 0
            ? derivedAssetPaths
            : normalizedAssetPaths.length > 0
              ? normalizedAssetPaths
            : (() => {
                const match = legacyAssetPathTemplate.match(/^\{([^}]+)\}$/);
                if (match) {
                  return [{
                    id: String(match[1] || "").trim() || "assetPath",
                    source: "variable" as const,
                    key: String(match[1] || "").trim() || "assetPath",
                    value: "",
                    templateId: snapshotTemplateId
                  }];
                }
                if (legacyAssetPathTemplate) {
                  return [{
                    id: "assetPath",
                    source: "static" as const,
                    key: "",
                    value: legacyAssetPathTemplate,
                    templateId: snapshotTemplateId
                  }];
                }
                return [];
              })();

          const normalizedContextFields = Array.isArray((item as { contextFields?: unknown[] }).contextFields)
            ? ((item as { contextFields?: unknown[] }).contextFields || [])
                .map((entry) => normalizeEventTemplateField(entry as EventTemplateFieldDefinition))
                .filter((entry) => entry.key.length > 0)
            : [];
          const normalizedEventPathBuilder = Array.isArray((item as { eventPathBuilder?: unknown[] }).eventPathBuilder)
            ? ((item as { eventPathBuilder?: unknown[] }).eventPathBuilder || [])
                .map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition))
            : parseEventTemplatePathBuilder(String(item.eventPathTemplate ?? ""));
          const normalizedClosePatternBuilder = Array.isArray((item as { closePatternBuilder?: unknown[] }).closePatternBuilder)
            ? ((item as { closePatternBuilder?: unknown[] }).closePatternBuilder || [])
                .map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition))
            : parseEventTemplatePathBuilder(String(item.closePatternTemplate ?? item.eventPathTemplate ?? ""));
          const normalizedUniquePatternBuilder = Array.isArray((item as { uniquePatternBuilder?: unknown[] }).uniquePatternBuilder)
            ? ((item as { uniquePatternBuilder?: unknown[] }).uniquePatternBuilder || [])
                .map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition))
            : parseEventTemplatePathBuilder(String((item as { uniquePatternTemplate?: unknown }).uniquePatternTemplate ?? ""));
          const normalizedRequiredParentBuilder = Array.isArray((item as { requiredParentBuilder?: unknown[] }).requiredParentBuilder)
            ? ((item as { requiredParentBuilder?: unknown[] }).requiredParentBuilder || [])
                .map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition))
            : parseEventTemplatePathBuilder(String((item as { requiredParentPattern?: unknown }).requiredParentPattern ?? ""));
          const normalizedCloseOnOpenPatternBuilders = Array.isArray((item as { closeOnOpenPatternBuilders?: unknown[] }).closeOnOpenPatternBuilders)
            ? ((item as { closeOnOpenPatternBuilders?: unknown[] }).closeOnOpenPatternBuilders || [])
                .map((builder) => Array.isArray(builder) ? builder.map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition)) : [])
            : [];
          const normalizedCloseChildrenPatternBuilders = Array.isArray((item as { closeChildrenOnClosePatternBuilders?: unknown[] }).closeChildrenOnClosePatternBuilders)
            ? ((item as { closeChildrenOnClosePatternBuilders?: unknown[] }).closeChildrenOnClosePatternBuilders || [])
                .map((builder) => Array.isArray(builder) ? builder.map((entry) => normalizeEventTemplatePathSegment(entry as EventTemplatePathSegmentDefinition)) : [])
            : [];
          const eventPathTemplate = normalizedEventPathBuilder.length > 0
            ? renderEventTemplatePathBuilder(normalizedEventPathBuilder)
            : String(item.eventPathTemplate ?? "").trim();
          const closePatternTemplate = normalizedClosePatternBuilder.length > 0
            ? renderEventTemplatePathBuilder(normalizedClosePatternBuilder)
            : String(item.closePatternTemplate ?? "").trim();
          const uniquePatternTemplate = normalizedUniquePatternBuilder.length > 0
            ? renderEventTemplatePathBuilder(normalizedUniquePatternBuilder)
            : String((item as { uniquePatternTemplate?: unknown }).uniquePatternTemplate ?? "").trim();
          const requiredParentPattern = normalizedRequiredParentBuilder.length > 0
            ? renderEventTemplatePathBuilder(normalizedRequiredParentBuilder)
            : String((item as { requiredParentPattern?: unknown }).requiredParentPattern ?? "").trim();
          const contextBindings =
            item.contextBindings && typeof item.contextBindings === "object"
              ? item.contextBindings
              : {};
          const contextFields = normalizedContextFields.length > 0
            ? normalizedContextFields
            : Object.entries(contextBindings).map(([key, binding]) => {
                const src = (binding || {}) as { source?: unknown; key?: unknown; value?: unknown; pathTemplate?: unknown };
                if (String(src.source || "") === "attribute") {
                  const match = String(src.pathTemplate ?? "").trim().match(/^\{([^}]+)\}\.(.+)$/);
                  return normalizeEventTemplateField({
                    key,
                    source: "asset_path_attribute",
                    assetPathId: String(match?.[1] || "assetPath").trim(),
                    attributeName: String(match?.[2] || "").trim()
                  });
                }
                if (String(src.source || "") === "static") {
                  return normalizeEventTemplateField({
                    key,
                    source: "static",
                    value: src.value
                  });
                }
                return normalizeEventTemplateField({
                  key,
                  source: "variable",
                  variableKey: String(src.key ?? "").trim()
                });
              }).filter((entry) => entry.key.length > 0);

          return {
            id: String(item.id ?? "").trim(),
            enabled: item.enabled !== false,
            allowParallel: (item as { allowParallel?: unknown }).allowParallel !== false,
            concurrencyMode: normalizeEventTemplateConcurrencyMode((item as { concurrencyMode?: unknown }).concurrencyMode),
            eventPathTemplate,
            closePatternTemplate,
            eventPathBuilder: normalizedEventPathBuilder,
            closePatternBuilder: normalizedClosePatternBuilder,
            uniquePatternTemplate,
            uniquePatternBuilder: normalizedUniquePatternBuilder,
            closeOnOpenPatterns: normalizedCloseOnOpenPatternBuilders.length > 0
              ? normalizedCloseOnOpenPatternBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter((entry) => entry.length > 0)
              : Array.isArray((item as { closeOnOpenPatterns?: unknown[] }).closeOnOpenPatterns)
                ? ((item as { closeOnOpenPatterns?: unknown[] }).closeOnOpenPatterns || []).map((entry) => String(entry || "").trim()).filter((entry) => entry.length > 0)
                : [],
            closeOnOpenPatternBuilders: normalizedCloseOnOpenPatternBuilders.length > 0
              ? normalizedCloseOnOpenPatternBuilders
              : Array.isArray((item as { closeOnOpenPatterns?: unknown[] }).closeOnOpenPatterns)
                ? ((item as { closeOnOpenPatterns?: unknown[] }).closeOnOpenPatterns || []).map((entry) => parseEventTemplatePathBuilder(String(entry || "")))
                : [],
            requiredParentPattern,
            requiredParentBuilder: normalizedRequiredParentBuilder,
            closeChildrenOnClosePatterns: normalizedCloseChildrenPatternBuilders.length > 0
              ? normalizedCloseChildrenPatternBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter((entry) => entry.length > 0)
              : Array.isArray((item as { closeChildrenOnClosePatterns?: unknown[] }).closeChildrenOnClosePatterns)
                ? ((item as { closeChildrenOnClosePatterns?: unknown[] }).closeChildrenOnClosePatterns || []).map((entry) => String(entry || "").trim()).filter((entry) => entry.length > 0)
                : [],
            closeChildrenOnClosePatternBuilders: normalizedCloseChildrenPatternBuilders.length > 0
              ? normalizedCloseChildrenPatternBuilders
              : Array.isArray((item as { closeChildrenOnClosePatterns?: unknown[] }).closeChildrenOnClosePatterns)
                ? ((item as { closeChildrenOnClosePatterns?: unknown[] }).closeChildrenOnClosePatterns || []).map((entry) => parseEventTemplatePathBuilder(String(entry || "")))
                : [],
            bindings,
            snapshotTemplateId,
            severity: String(item.severity ?? "").trim() || "other",
            assetPaths,
            contextBindings,
            contextFields,
            timeSource:
              item.timeSource && typeof item.timeSource === "object"
                ? item.timeSource
                : {},
            capture:
              item.capture && typeof item.capture === "object"
                ? item.capture
                : { onOpen: true, onClose: true },
            captureFields: Array.isArray((item as { captureFields?: unknown[] }).captureFields)
              ? ((item as { captureFields?: unknown[] }).captureFields || [])
                  .map((entry) => normalizeEventTemplateField(entry as EventTemplateFieldDefinition))
                  .filter((entry) => entry.key.length > 0)
              : []
          };
        })
        .filter((item) => item.id.length > 0)
    : [];

  const legacyTriggerTemplateIdByNodeId = new Map<string, string>();
  const normalizedTriggerTemplates: TriggerTemplateDefinition[] = Array.isArray(program.triggerTemplates) && program.triggerTemplates.length > 0
    ? program.triggerTemplates.map((item, index) => normalizeTriggerTemplate(item, index))
    : (program.triggers || []).map((item, index) => {
        const normalized = normalizeTriggerTemplate(item, index);
        legacyTriggerTemplateIdByNodeId.set(String(item.id || "").trim(), normalized.id);
        return normalized;
      });

  const normalizeFlowNode = (node: unknown): FlowNodeDefinition | null => {
    if (!node || typeof node !== "object") return null;
    const rawNode = node as Record<string, unknown>;
    const rawConfig =
      rawNode.config && typeof rawNode.config === "object"
        ? (rawNode.config as Record<string, unknown>)
        : {};
    const rawKind = String(rawNode.kind || "");
    const normalizedKind =
      rawKind === "trigger"
        ? ("trigger" as const)
        : rawKind === "event_open"
          ? ("event_open" as const)
          : rawKind === "event_close"
            ? ("event_close" as const)
            : ("action" as const);
    const normalizedConfig =
      normalizedKind === "action"
        ? {
            ...rawConfig,
            description: String(rawConfig.description ?? ""),
            script: String(rawConfig.script ?? "send(msg);"),
            eventTemplateId: String(rawConfig.eventTemplateId ?? ""),
            eventTemplateOverrides:
              rawConfig.eventTemplateOverrides && typeof rawConfig.eventTemplateOverrides === "object"
                ? rawConfig.eventTemplateOverrides
                : {},
            templateBindingOverrides:
              rawConfig.templateBindingOverrides && typeof rawConfig.templateBindingOverrides === "object"
                ? Object.fromEntries(
                    Object.entries(rawConfig.templateBindingOverrides).map(([key, value]) => {
                      if (!value || typeof value !== "object") return [key, normalizeBinding({ name: key })];
                      return [key, normalizeBinding({ ...(value as ScriptVariableBindingDefinition), name: key })];
                    })
                  )
                : {}
          }
        : normalizedKind === "event_open" || normalizedKind === "event_close"
          ? {
              ...rawConfig,
              description: String(rawConfig.description ?? ""),
              templateOverrides:
                rawConfig.templateOverrides && typeof rawConfig.templateOverrides === "object"
                  ? rawConfig.templateOverrides
                  : {},
              bindings:
                rawConfig.bindings && typeof rawConfig.bindings === "object"
                  ? Object.fromEntries(
                      Object.entries(rawConfig.bindings).map(([key, value]) => {
                        if (!value || typeof value !== "object") return [key, normalizeEventActionBinding({})];
                        return [key, normalizeEventActionBinding(value as EventActionBindingDefinition)];
                      })
                    )
                  : {},
              openNotes: String(rawConfig.openNotes ?? ""),
              closeNotes: String(rawConfig.closeNotes ?? "")
            }
          : {
              ...rawConfig,
              type: String(rawConfig.type ?? "interval"),
              watchPath: String(rawConfig.watchPath ?? ""),
              intervalMs: Math.max(1, Number(rawConfig.intervalMs) || 1000),
              cronExpression: String(rawConfig.cronExpression ?? ""),
              timezone: String(rawConfig.timezone ?? ""),
              activeFrom: String(rawConfig.activeFrom ?? ""),
              activeTo: String(rawConfig.activeTo ?? ""),
              message:
                rawConfig.message && typeof rawConfig.message === "object"
                  ? rawConfig.message
                  : { payload: 0 }
            };
    const id = String(rawNode.id || "").trim();
    if (!id) return null;
    const inheritedTriggerTemplateId =
      normalizedKind === "trigger"
        ? String(rawNode.templateId || legacyTriggerTemplateIdByNodeId.get(id) || legacyTriggerTemplateIdByNodeId.get(String(rawNode.refId || "").trim()) || "").trim()
        : "";
    return {
      id,
      kind: normalizedKind,
      refId: String(rawNode.refId || "").trim(),
      label: String(rawNode.label || "").trim(),
      enabled: rawNode.enabled !== false,
      templateId: normalizedKind === "trigger" ? inheritedTriggerTemplateId : String(rawNode.templateId || "").trim(),
      config: normalizedConfig
    };
  };

  const normalizeFlowDefinition = (flow: unknown, index: number): FlowDefinition | null => {
    if (!flow || typeof flow !== "object") return null;
    const typed = flow as Record<string, unknown>;
    const id = String(typed.id || "").trim() || `flow_${index + 1}`;
    const nodes = Array.isArray(typed.nodes)
      ? typed.nodes.map((node) => normalizeFlowNode(node)).filter((node): node is FlowNodeDefinition => Boolean(node))
      : [];
    const links = Array.isArray(typed.links)
      ? typed.links.map((link) => ({ ...(link as FlowLink), enabled: (link as FlowLink).enabled !== false }))
      : [];
    const nodePositions =
      typed.nodePositions && typeof typed.nodePositions === "object"
        ? ({ ...(typed.nodePositions as Record<string, NodePosition>) })
        : {};
    return {
      id,
      name: String(typed.name || "").trim() || `Flow ${index + 1}`,
      description: String(typed.description || ""),
      enabled: typed.enabled !== false,
      variables: normalizeFlowVariables(typed.variables),
      nodes,
      links,
      nodePositions
    };
  };

  const normalizedFlowDefinitions =
    Array.isArray(program.flowDefinitions) && program.flowDefinitions.length > 0
      ? program.flowDefinitions
          .map((flow, index) => normalizeFlowDefinition(flow, index))
          .filter((flow): flow is FlowDefinition => Boolean(flow))
      : [
          {
            id: String((program.flows as { id?: unknown } | undefined)?.id || "flow_main").trim() || "flow_main",
            name: String((program.flows as { name?: unknown } | undefined)?.name || "Main Flow").trim() || "Main Flow",
            description: String((program.flows as { description?: unknown } | undefined)?.description || ""),
            enabled: (program.flows as { enabled?: unknown } | undefined)?.enabled !== false,
            variables: normalizeFlowVariables((program.flows as { variables?: unknown } | undefined)?.variables),
            nodes: Array.isArray(program.flows?.nodes)
              ? (program.flows?.nodes || []).map((node) => normalizeFlowNode(node)).filter((node): node is FlowNodeDefinition => Boolean(node))
              : [],
            links: ((program.flows && program.flows.links) || []).map((link) => ({ ...link, enabled: link.enabled !== false })),
            nodePositions: { ...((program.flows && program.flows.nodePositions) || {}) }
          }
        ];

  const activeFlowId =
    String(program.activeFlowId ?? (program.flows as { activeFlowId?: unknown } | undefined)?.activeFlowId ?? "").trim() ||
    normalizedFlowDefinitions[0]?.id ||
    "flow_main";
  const activeFlow =
    normalizedFlowDefinitions.find((flow) => flow.id === activeFlowId) ||
    normalizedFlowDefinitions[0] || {
      id: "flow_main",
      name: "Main Flow",
      description: "",
      enabled: true,
      variables: [],
      nodes: [],
      links: [],
      nodePositions: {}
    };

  return sanitizeProgramStructure({
    ...program,
    activeFlowId: activeFlow.id,
    flowDefinitions: normalizedFlowDefinitions,
    eventTemplates: normalizedEventTemplates,
    triggerTemplates: normalizedTriggerTemplates,
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
              : rawType === "watcher_event_falling"
                ? "watcher_event_falling"
              : rawType === "cron"
                ? "cron"
              : "interval",
        intervalMs: Math.max(1, Number(trigger.intervalMs) || 1000),
        cronExpression: String((trigger as { cronExpression?: unknown }).cronExpression || "").trim(),
        timezone: String((trigger as { timezone?: unknown }).timezone || "").trim(),
        activeFrom: String((trigger as { activeFrom?: unknown }).activeFrom || "").trim(),
        activeTo: String((trigger as { activeTo?: unknown }).activeTo || "").trim(),
        watchPath:
          rawType === "watcher_set" ||
          rawType === "watcher_valuechange"
            ? String(trigger.watchPath || "").trim() || "*.*.*"
            : rawType === "watcher_event_falling"
              ? String(trigger.watchPath || "").trim() || "*"
            : String(trigger.watchPath || ""),
        message: trigger.message && typeof trigger.message === "object" ? trigger.message : { payload: 0 },
        enabled: trigger.enabled !== false
      };
      }
    ),
    scriptTemplates: (program.scriptTemplates || []).map(
      (template): ScriptTemplateDefinition => ({
        ...template,
        description: template.description ?? "",
        script: template.script ?? "send(msg);",
        outputs: normalizeScriptOutputs((template as { outputs?: unknown[] }).outputs),
        allowTemplateReuse: (template.allowTemplateReuse ?? template.allowActionDuplication) !== false,
        variableBindings: Array.isArray(template.variableBindings)
          ? template.variableBindings.map((binding) =>
              normalizeBinding(binding as ScriptVariableBindingDefinition)
            )
          : []
      })
    ),
    flows: {
      id: activeFlow.id,
      name: activeFlow.name,
      description: activeFlow.description || "",
      enabled: activeFlow.enabled !== false,
      variables: activeFlow.variables || [],
      activeFlowId: activeFlow.id,
      nodes: activeFlow.nodes || [],
      links: activeFlow.links || [],
      nodePositions: activeFlow.nodePositions || {}
    },
    assets: normalizedAssets
  });
}
  const normalizeTriggerTemplate = (
    trigger: Partial<TriggerTemplateDefinition> | Partial<TriggerDefinition>,
    index: number
  ): TriggerTemplateDefinition => {
    const rawType = String((trigger as { type?: unknown }).type || "interval");
    const normalizedType =
      rawType === "watcher_set"
        ? "watcher_set"
        : rawType === "watcher_valuechange"
          ? "watcher_valuechange"
          : rawType === "watcher_event_open"
            ? "watcher_event_open"
            : rawType === "watcher_event_close" || rawType === "watcher_event_falling"
              ? "watcher_event_close"
              : "interval";
    const baseName =
      normalizedType === "interval"
        ? "Interval Trigger"
        : normalizedType === "watcher_set"
          ? "Attribute Set Trigger"
          : normalizedType === "watcher_valuechange"
            ? "Attribute Value Change Trigger"
            : normalizedType === "watcher_event_open"
              ? "Event Open Trigger"
              : "Event Close Trigger";
    return {
      id: String((trigger as { id?: unknown }).id || `trigger_template_${index + 1}`).trim() || `trigger_template_${index + 1}`,
      name: String((trigger as { name?: unknown; label?: unknown }).name ?? (trigger as { label?: unknown }).label ?? baseName).trim() || baseName,
      description: String((trigger as { description?: unknown }).description || ""),
      type: normalizedType,
      enabled: (trigger as { enabled?: unknown }).enabled !== false,
      intervalMs: Math.max(1, Number((trigger as { intervalMs?: unknown }).intervalMs) || 1000),
      activeFrom: String((trigger as { activeFrom?: unknown }).activeFrom || "").trim(),
      activeTo: String((trigger as { activeTo?: unknown }).activeTo || "").trim(),
      watchPath:
        normalizedType === "watcher_set" || normalizedType === "watcher_valuechange"
          ? String((trigger as { watchPath?: unknown }).watchPath || "").trim() || "*.*.*"
          : normalizedType === "watcher_event_open" || normalizedType === "watcher_event_close"
            ? String((trigger as { watchPath?: unknown }).watchPath || "").trim() || "*"
            : String((trigger as { watchPath?: unknown }).watchPath || "").trim(),
      message:
        (trigger as { message?: unknown }).message && typeof (trigger as { message?: unknown }).message === "object"
          ? (((trigger as { message?: unknown }).message as Record<string, unknown>) || { payload: 0 })
          : { payload: 0 }
    };
  };
