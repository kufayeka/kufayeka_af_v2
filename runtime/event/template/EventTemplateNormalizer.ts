import type {
  EventTemplateAssetPath,
  EventTemplateBinding,
  EventTemplateDefinition,
  EventTemplateField,
  EventTemplateInputBinding,
  EventTemplatePathSegment,
  EventTemplateTimeSource
} from "../../core/runtimeTypes";

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function hasRenderableValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function firstNonEmptyString(values: unknown[]): string {
  for (const value of values) {
    if (!hasRenderableValue(value)) continue;
    return String(value).trim();
  }
  return "";
}

function normalizePathBuilder(value: unknown): EventTemplatePathSegment[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const src = toRecord(item);
    const type = String(src.type || "static");
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
      value: src.value == null ? undefined : String(src.value),
      separator:
        src.separator === "/" || src.separator === "." || src.separator === "-"
          ? (src.separator as "" | "/" | "." | "-")
          : ""
    };
  });
}

function normalizeConcurrencyMode(value: unknown): EventTemplateDefinition["concurrencyMode"] {
  const mode = String(value || "").trim();
  if (mode === "unique_exact_path" || mode === "unique_pattern") return mode;
  return "parallel";
}

function renderPathBuilder(builder: EventTemplatePathSegment[]): string {
  return builder
    .map((segment) => {
      const body =
        segment.type === "wildcard"
          ? "*"
          : segment.type === "static"
            ? String(segment.value || "")
            : segment.value
              ? `{${String(segment.value)}}`
              : "";
      return `${body}${segment.separator || ""}`;
    })
    .join("")
    .trim();
}

function parsePathBuilder(template: string | undefined): EventTemplatePathSegment[] {
  const input = String(template || "").trim();
  if (!input) return [];
  const output: EventTemplatePathSegment[] = [];
  let i = 0;
  while (i < input.length) {
    let type: EventTemplatePathSegment["type"] = "static";
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
    let separator: EventTemplatePathSegment["separator"] = "";
    if (i < input.length && (input[i] === "/" || input[i] === "." || input[i] === "-")) {
      separator = input[i] as EventTemplatePathSegment["separator"];
      i += 1;
    }
    if (type === "static" && !value && !separator) continue;
    output.push({ type, value, separator });
  }
  return output;
}

function normalizeBindingMap(value: unknown): Record<string, EventTemplateBinding> {
  const source = toRecord(value);
  const output: Record<string, EventTemplateBinding> = {};
  for (const [key, raw] of Object.entries(source)) {
    const binding = toRecord(raw);
    const type = String(binding.source || "static");
    if (type !== "variable" && type !== "attribute" && type !== "static") continue;
    output[key] = {
      source: type,
      key: binding.key == null ? undefined : String(binding.key),
      value: binding.value,
      pathTemplate: binding.pathTemplate == null ? undefined : String(binding.pathTemplate)
    };
  }
  return output;
}

export function mergeTemplate(
  template: EventTemplateDefinition,
  overrides?: Partial<EventTemplateDefinition>
): EventTemplateDefinition {
  if (!overrides || typeof overrides !== "object") return template;
  return {
    ...template,
    ...overrides,
    contextBindings: {
      ...(template.contextBindings || {}),
      ...(overrides.contextBindings || {})
    },
    timeSource: {
      ...(template.timeSource || {}),
      ...(overrides.timeSource || {})
    },
    capture: {
      ...(template.capture || {}),
      ...(overrides.capture || {})
    }
  };
}

function normalizeTimeSource(value: unknown): EventTemplateTimeSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = toRecord(value);
  const type = String(source.source || "now");
  if (type !== "now" && type !== "variable" && type !== "asset_path_attribute") return undefined;
  return {
    source: type,
    key: source.key == null ? undefined : String(source.key),
    assetPathId: source.assetPathId == null ? undefined : String(source.assetPathId),
    attributeName: source.attributeName == null ? undefined : String(source.attributeName)
  };
}

function normalizeAssetPaths(value: unknown): EventTemplateAssetPath[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = toRecord(item);
      return {
        id: String(src.id || "").trim(),
        source: String(src.source || "variable") === "static" ? "static" : "variable",
        key: src.key == null ? undefined : String(src.key),
        value: src.value == null ? undefined : String(src.value),
        templateId: src.templateId == null ? undefined : String(src.templateId)
      } as EventTemplateAssetPath;
    })
    .filter((item) => item.id.length > 0);
}

function normalizeInputBindings(value: unknown): EventTemplateInputBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = toRecord(item);
      const type = String(src.source || "msg_path");
      return {
        name: String(src.name || "").trim(),
        source:
          type === "asset" ||
          type === "attribute" ||
          type === "static_number" ||
          type === "static_string" ||
          type === "static_boolean" ||
          type === "static_array" ||
          type === "static_object"
            ? type
            : "msg_path",
        templateId: src.templateId == null ? undefined : String(src.templateId),
        defaultValue: src.defaultValue
      } as EventTemplateInputBinding;
    })
    .filter((item) => item.name.length > 0);
}

function normalizeTemplateFields(value: unknown): EventTemplateField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const src = toRecord(item);
      const type = String(src.source || "variable");
      return {
        key: String(src.key || "").trim(),
        source:
          type === "asset_path_attribute"
            ? "asset_path_attribute"
            : type === "captured_value"
              ? "captured_value"
              : type === "static"
                ? "static"
                : "variable",
        variableKey: src.variableKey == null ? undefined : String(src.variableKey),
        value: src.value,
        assetPathId: src.assetPathId == null ? undefined : String(src.assetPathId),
        attributeName: src.attributeName == null ? undefined : String(src.attributeName),
        capturedKey: src.capturedKey == null ? undefined : String(src.capturedKey)
      } as EventTemplateField;
    })
    .filter((item) => item.key.length > 0);
}

export function normalizeEventTemplates(value: unknown): EventTemplateDefinition[] {
  if (!Array.isArray(value)) return [];
  const normalized: EventTemplateDefinition[] = [];
  for (const item of value) {
    const src = toRecord(item);
    const id = String(src.id || "").trim();
    const eventPathBuilder = Array.isArray(src.eventPathBuilder) ? normalizePathBuilder(src.eventPathBuilder) : parsePathBuilder(String(src.eventPathTemplate || ""));
    const closePatternBuilder = Array.isArray(src.closePatternBuilder)
      ? normalizePathBuilder(src.closePatternBuilder)
      : parsePathBuilder(String(src.closePatternTemplate || src.eventPathTemplate || ""));
    const uniquePatternBuilder = Array.isArray(src.uniquePatternBuilder) ? normalizePathBuilder(src.uniquePatternBuilder) : parsePathBuilder(String(src.uniquePatternTemplate || ""));
    const requiredParentBuilder = Array.isArray(src.requiredParentBuilder)
      ? normalizePathBuilder(src.requiredParentBuilder)
      : parsePathBuilder(String(src.requiredParentPattern || ""));
    const closeOnOpenPatternBuilders = Array.isArray(src.closeOnOpenPatternBuilders)
      ? src.closeOnOpenPatternBuilders.map((builder) => (Array.isArray(builder) ? normalizePathBuilder(builder) : []))
      : [];
    const closeChildrenOnClosePatternBuilders = Array.isArray(src.closeChildrenOnClosePatternBuilders)
      ? src.closeChildrenOnClosePatternBuilders.map((builder) => (Array.isArray(builder) ? normalizePathBuilder(builder) : []))
      : [];
    const eventPathTemplate = eventPathBuilder.length > 0 ? renderPathBuilder(eventPathBuilder) : String(src.eventPathTemplate || "").trim();
    if (!id || !eventPathTemplate) continue;
    const timeSource = toRecord(src.timeSource);
    const capture = toRecord(src.capture);
    const bindings = normalizeInputBindings(src.bindings);
    const derivedAssetPaths = bindings
      .filter((item) => item.source === "asset")
      .map((item) => ({
        id: item.name,
        source: "variable" as const,
        key: item.name,
        value: undefined,
        templateId: item.templateId
      }));
    normalized.push({
      id,
      enabled: src.enabled !== false,
      allowParallel: src.allowParallel !== false,
      concurrencyMode: normalizeConcurrencyMode(src.concurrencyMode),
      eventPathTemplate,
      closePatternTemplate: (closePatternBuilder.length > 0 ? renderPathBuilder(closePatternBuilder) : String(src.closePatternTemplate || "").trim()) || undefined,
      eventPathBuilder,
      closePatternBuilder,
      uniquePatternTemplate: (uniquePatternBuilder.length > 0 ? renderPathBuilder(uniquePatternBuilder) : String(src.uniquePatternTemplate || "").trim()) || undefined,
      uniquePatternBuilder,
      closeOnOpenPatterns:
        closeOnOpenPatternBuilders.length > 0
          ? closeOnOpenPatternBuilders.map((builder) => renderPathBuilder(builder)).filter(Boolean)
          : Array.isArray(src.closeOnOpenPatterns)
            ? src.closeOnOpenPatterns.map((item) => String(item || "").trim()).filter(Boolean)
            : [],
      closeOnOpenPatternBuilders:
        closeOnOpenPatternBuilders.length > 0
          ? closeOnOpenPatternBuilders
          : Array.isArray(src.closeOnOpenPatterns)
            ? src.closeOnOpenPatterns.map((item) => parsePathBuilder(String(item || "")))
            : [],
      requiredParentPattern: (requiredParentBuilder.length > 0 ? renderPathBuilder(requiredParentBuilder) : String(src.requiredParentPattern || "").trim()) || undefined,
      requiredParentBuilder,
      closeChildrenOnClosePatterns:
        closeChildrenOnClosePatternBuilders.length > 0
          ? closeChildrenOnClosePatternBuilders.map((builder) => renderPathBuilder(builder)).filter(Boolean)
          : Array.isArray(src.closeChildrenOnClosePatterns)
            ? src.closeChildrenOnClosePatterns.map((item) => String(item || "").trim()).filter(Boolean)
            : [],
      closeChildrenOnClosePatternBuilders:
        closeChildrenOnClosePatternBuilders.length > 0
          ? closeChildrenOnClosePatternBuilders
          : Array.isArray(src.closeChildrenOnClosePatterns)
            ? src.closeChildrenOnClosePatterns.map((item) => parsePathBuilder(String(item || "")))
            : [],
      bindings,
      snapshotTemplateId: String(src.snapshotTemplateId || "").trim() || undefined,
      severity: String(src.severity || "").trim() || undefined,
      assetPaths: derivedAssetPaths.length > 0 ? derivedAssetPaths : normalizeAssetPaths(src.assetPaths),
      contextBindings: normalizeBindingMap(src.contextBindings),
      contextFields: normalizeTemplateFields(src.contextFields),
      timeSource: {
        open: normalizeTimeSource(timeSource.open),
        close: normalizeTimeSource(timeSource.close)
      },
      capture: {
        onOpen: capture.onOpen !== false,
        onClose: capture.onClose !== false
      },
      captureFields: normalizeTemplateFields(src.captureFields)
    });
  }
  return normalized;
}
