import type {
  AssetStore,
  EventRow,
  EventStore,
  EventTemplateAssetPath,
  EventTemplateBinding,
  EventTemplateCloseOptions,
  EventTemplateDefinition,
  EventTemplateField,
  EventTemplateInputBinding,
  EventTemplateMetadata,
  EventTemplateOpenOptions,
  EventTemplatePathSegment,
  EventTemplateTimeSource
} from "./types";

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return String(template || "").replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
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

function mergeTemplate(
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
    const closePatternBuilder = Array.isArray(src.closePatternBuilder) ? normalizePathBuilder(src.closePatternBuilder) : parsePathBuilder(String(src.closePatternTemplate || src.eventPathTemplate || ""));
    const uniquePatternBuilder = Array.isArray(src.uniquePatternBuilder) ? normalizePathBuilder(src.uniquePatternBuilder) : parsePathBuilder(String(src.uniquePatternTemplate || ""));
    const requiredParentBuilder = Array.isArray(src.requiredParentBuilder) ? normalizePathBuilder(src.requiredParentBuilder) : parsePathBuilder(String(src.requiredParentPattern || ""));
    const closeOnOpenPatternBuilders = Array.isArray(src.closeOnOpenPatternBuilders)
      ? src.closeOnOpenPatternBuilders.map((builder) => Array.isArray(builder) ? normalizePathBuilder(builder) : [])
      : [];
    const closeChildrenOnClosePatternBuilders = Array.isArray(src.closeChildrenOnClosePatternBuilders)
      ? src.closeChildrenOnClosePatternBuilders.map((builder) => Array.isArray(builder) ? normalizePathBuilder(builder) : [])
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
      closeOnOpenPatterns: closeOnOpenPatternBuilders.length > 0
        ? closeOnOpenPatternBuilders.map((builder) => renderPathBuilder(builder)).filter(Boolean)
        : Array.isArray(src.closeOnOpenPatterns) ? src.closeOnOpenPatterns.map((item) => String(item || "").trim()).filter(Boolean) : [],
      closeOnOpenPatternBuilders: closeOnOpenPatternBuilders.length > 0
        ? closeOnOpenPatternBuilders
        : Array.isArray(src.closeOnOpenPatterns) ? src.closeOnOpenPatterns.map((item) => parsePathBuilder(String(item || ""))) : [],
      requiredParentPattern: (requiredParentBuilder.length > 0 ? renderPathBuilder(requiredParentBuilder) : String(src.requiredParentPattern || "").trim()) || undefined,
      requiredParentBuilder,
      closeChildrenOnClosePatterns: closeChildrenOnClosePatternBuilders.length > 0
        ? closeChildrenOnClosePatternBuilders.map((builder) => renderPathBuilder(builder)).filter(Boolean)
        : Array.isArray(src.closeChildrenOnClosePatterns) ? src.closeChildrenOnClosePatterns.map((item) => String(item || "").trim()).filter(Boolean) : [],
      closeChildrenOnClosePatternBuilders: closeChildrenOnClosePatternBuilders.length > 0
        ? closeChildrenOnClosePatternBuilders
        : Array.isArray(src.closeChildrenOnClosePatterns) ? src.closeChildrenOnClosePatterns.map((item) => parsePathBuilder(String(item || ""))) : [],
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

function resolveBindingValue(
  assetStore: AssetStore,
  binding: EventTemplateBinding,
  vars: Record<string, unknown>
): unknown {
  if (binding.source === "variable") {
    return vars[String(binding.key || "")];
  }
  if (binding.source === "attribute") {
    const path = renderTemplate(String(binding.pathTemplate || ""), vars).trim();
    if (!path) return null;
    return assetStore.getAttribute(path, null);
  }
  return binding.value ?? null;
}

function resolveContext(
  assetStore: AssetStore,
  template: EventTemplateDefinition,
  vars: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, binding] of Object.entries(template.contextBindings || {})) {
    resolved[key] = resolveBindingValue(assetStore, binding, vars);
  }
  return { ...resolved, ...extra };
}

function resolveTime(
  assetStore: AssetStore,
  timeSource: EventTemplateTimeSource | undefined,
  vars: Record<string, unknown>,
  assetPaths: Record<string, string>,
  explicitTs?: string
): string | undefined {
  if (explicitTs && explicitTs.trim()) return explicitTs;
  if (!timeSource || timeSource.source === "now") return undefined;
  if (timeSource.source === "variable") {
    const value = vars[String(timeSource.key || "")];
    return value == null ? undefined : String(value);
  }
  const assetPath = String(assetPaths[String(timeSource.assetPathId || "")] || "").trim();
  const attributeName = String(timeSource.attributeName || "").trim();
  const path = assetPath && attributeName ? `${assetPath}.${attributeName}` : "";
  if (!path) return undefined;
  const value = assetStore.getAttribute(path, undefined);
  return value == null ? undefined : String(value);
}

export function captureAssetSnapshot(assetStore: AssetStore, assetPath: string): Record<string, unknown> {
  const normalizedAssetPath = String(assetPath || "").trim();
  if (!normalizedAssetPath) return {};
  const matches = assetStore.query(`${normalizedAssetPath}.*`);
  const attributes: Record<string, unknown> = {};
  for (const item of matches) {
    if (item.kind !== "attribute") continue;
    attributes[item.path] = {
      value: item.value,
      ts: item.ts || null,
      attributeName: item.attributeName
    };
  }
  return {
    asset_path: normalizedAssetPath,
    captured_at: new Date().toISOString(),
    attribute_count: Object.keys(attributes).length,
    attributes
  };
}

function resolveAssetPaths(
  template: EventTemplateDefinition,
  vars: Record<string, unknown>
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const item of template.assetPaths || []) {
    output[item.id] = item.source === "static" ? String(item.value || "").trim() : String(vars[String(item.key || "")] || "").trim();
  }
  if (!output.assetPath && vars.assetPath != null) {
    output.assetPath = String(vars.assetPath);
  }
  return output;
}

function resolveTemplateFieldValue(
  assetStore: AssetStore,
  field: EventTemplateField,
  vars: Record<string, unknown>,
  assetPaths: Record<string, string>,
  capturedValues: Record<string, unknown>
): unknown {
  if (field.source === "variable") return vars[String(field.variableKey || "")];
  if (field.source === "static") return field.value ?? null;
  if (field.source === "captured_value") return capturedValues[String(field.capturedKey || "")];
  const assetPath = String(assetPaths[String(field.assetPathId || "")] || "").trim();
  const attributeName = String(field.attributeName || "").trim();
  if (!assetPath || !attributeName) return null;
  return assetStore.getAttribute(`${assetPath}.${attributeName}`, null);
}

function resolveCapturedFields(
  assetStore: AssetStore,
  template: EventTemplateDefinition,
  vars: Record<string, unknown>,
  assetPaths: Record<string, string>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of template.captureFields || []) {
    output[field.key] = resolveTemplateFieldValue(assetStore, field, vars, assetPaths, output);
  }
  return output;
}

function resolveContextFields(
  assetStore: AssetStore,
  template: EventTemplateDefinition,
  vars: Record<string, unknown>,
  assetPaths: Record<string, string>,
  capturedValues: Record<string, unknown>,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of template.contextFields || []) {
    output[field.key] = resolveTemplateFieldValue(assetStore, field, vars, assetPaths, capturedValues);
  }
  return { ...output, ...extra };
}

function mergeCaptured(autoCapture: Record<string, unknown>, explicit: unknown): unknown {
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) return autoCapture;
  return {
    ...autoCapture,
    explicit: explicit as Record<string, unknown>
  };
}

function getEventTemplateMetadataFromRow(row: EventRow): Record<string, unknown> {
  const metadataFromColumn = toRecord(row.event_metadata);
  if (Object.keys(metadataFromColumn).length > 0) return metadataFromColumn;
  return toRecord(toRecord(row.context).__event_template);
}

function getTemplate(templateMap: Map<string, EventTemplateDefinition>, templateId: string): EventTemplateDefinition {
  const template = templateMap.get(String(templateId || "").trim());
  if (!template || template.enabled === false) {
    throw new Error(`Event template "${String(templateId || "")}" not found`);
  }
  return template;
}

function buildTemplateMetadata(
  template: EventTemplateDefinition,
  vars: Record<string, unknown>
): EventTemplateMetadata {
  const assetPaths = resolveAssetPaths(template, vars);
  const renderVars = { ...assetPaths, ...vars };
  const eventPath = renderTemplate(template.eventPathTemplate, renderVars).trim();
  const closePattern = renderTemplate(template.closePatternTemplate || template.eventPathTemplate, renderVars).trim() || eventPath;
  const assetPath = String(assetPaths.assetPath || "").trim() || String(vars.assetPath || "").trim();
  const uniquePattern = renderTemplate(template.uniquePatternTemplate || "", renderVars).trim();
  const requiredParentPattern = renderTemplate(template.requiredParentPattern || "", renderVars).trim();
  const closeOnOpenPatterns = (template.closeOnOpenPatterns || []).map((item) => renderTemplate(item, renderVars).trim()).filter(Boolean);
  const closeChildrenOnClosePatterns = (template.closeChildrenOnClosePatterns || []).map((item) => renderTemplate(item, renderVars).trim()).filter(Boolean);
  return {
    id: template.id,
    eventPath,
    closePattern,
    assetPath,
    assetPaths,
    vars,
    closeTimeSource: template.timeSource?.close || null,
    parent_event_id: null,
    policy: {
      concurrencyMode: template.concurrencyMode || (template.allowParallel === false ? "unique_exact_path" : "parallel"),
      uniquePattern: uniquePattern || undefined,
      requiredParentPattern: requiredParentPattern || undefined,
      closeOnOpenPatterns,
      closeChildrenOnClosePatterns
    }
  };
}

function normalizeRowsAssetPaths(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item || "")]));
}

function parseTimestampMs(value: string | undefined | null): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

async function closeRowsByPatterns(options: {
  assetStore: AssetStore;
  eventStore: EventStore;
  templateMap: Map<string, EventTemplateDefinition>;
  patterns: string[];
  notes?: string;
  ts?: string;
  excludeIds?: Set<string>;
}): Promise<EventRow[]> {
  const closedRows: EventRow[] = [];
  const excluded = new Set(options.excludeIds || []);
  for (const pattern of options.patterns) {
    const rows = (await options.eventStore.get(pattern, "*", "*", "open", {}, { limit: 5000 }))
      .filter((row) => !excluded.has(row.id));
    if (rows.length === 0) continue;
    const result = await closeEventsWithAutoCapture({
      assetStore: options.assetStore,
      eventStore: options.eventStore,
      templateMap: options.templateMap,
      rows,
      notes: options.notes,
      ts: options.ts
    });
    result.rows.forEach((row) => {
      if (excluded.has(row.id)) return;
      excluded.add(row.id);
      closedRows.push(row);
    });
  }
  return closedRows;
}

export async function openEventFromTemplate(options: {
  assetStore: AssetStore;
  eventStore: EventStore;
  templateMap: Map<string, EventTemplateDefinition>;
  templateId: string;
  openOptions?: EventTemplateOpenOptions;
}): Promise<EventRow> {
  const template = mergeTemplate(getTemplate(options.templateMap, options.templateId), options.openOptions?.templateOverrides);
  const vars = { ...(options.openOptions?.vars || {}) };
  const metadata = buildTemplateMetadata(template, vars);
  if (!metadata.eventPath) throw new Error(`Event template "${template.id}" produced empty event path`);
  const openTs = resolveTime(options.assetStore, template.timeSource?.open, vars, metadata.assetPaths || {}, options.openOptions?.ts);
  const effectiveOpenTs = openTs || new Date().toISOString();
  const requiredParentPattern = String(metadata.policy?.requiredParentPattern || "").trim();
  if (requiredParentPattern) {
    const parents = await options.eventStore.get(requiredParentPattern, "*", "*", "open", {}, { limit: 1, sortBy: "start_ts", sortDir: "asc" });
    const parent = parents[0];
    if (!parent) {
      throw new Error(`Event template "${template.id}" requires open parent event matching "${requiredParentPattern}"`);
    }
    const parentStartMs = parseTimestampMs(parent.start_ts);
    const childStartMs = parseTimestampMs(effectiveOpenTs);
    if (parentStartMs != null && childStartMs != null && childStartMs < parentStartMs) {
      throw new Error(`Child event "${metadata.eventPath}" cannot start before parent "${parent.event_path}"`);
    }
    metadata.parent_event_id = parent.id;
  }
  const closeOnOpenPatterns = metadata.policy?.closeOnOpenPatterns || [];
  if (closeOnOpenPatterns.length > 0) {
    await closeRowsByPatterns({
      assetStore: options.assetStore,
      eventStore: options.eventStore,
      templateMap: options.templateMap,
      patterns: closeOnOpenPatterns,
      notes: options.openOptions?.notes || "",
      ts: effectiveOpenTs
    });
  }
  const explicitContext = toRecord(options.openOptions?.context);
  const capturedValues = resolveCapturedFields(options.assetStore, template, vars, metadata.assetPaths || {});
  const legacyContext = resolveContext(options.assetStore, template, vars, explicitContext);
  const context = resolveContextFields(options.assetStore, template, vars, metadata.assetPaths || {}, capturedValues, legacyContext);
  const concurrencyMode = template.concurrencyMode || (template.allowParallel === false ? "unique_exact_path" : "parallel");
  if (concurrencyMode !== "parallel") {
    const uniquePattern = concurrencyMode === "unique_pattern"
      ? String(metadata.policy?.uniquePattern || metadata.closePattern || metadata.eventPath || "*")
      : metadata.eventPath;
    const existing = await options.eventStore.get(uniquePattern, "*", "*", "open", {}, { limit: 1 });
    if (existing.length > 0) return existing[0];
  }
  const autoCapture = template.capture?.onOpen === false ? null : capturedValues;
  const captured = autoCapture ? mergeCaptured(autoCapture, options.openOptions?.capturedDataOnOpen ?? null) : options.openOptions?.capturedDataOnOpen ?? null;
  return await options.eventStore.open(
    metadata.eventPath,
    openTs,
    context,
    options.openOptions?.notes || "",
    options.openOptions?.severity || template.severity || "other",
    captured,
    metadata as unknown as Record<string, unknown>
  );
}

function buildCloseRowsCapture(
  assetStore: AssetStore,
  row: EventRow,
  templateMap: Map<string, EventTemplateDefinition>,
  explicit: unknown
): unknown {
  const metadata = getEventTemplateMetadataFromRow(row);
  const templateId = String(metadata.id || "").trim();
  const template = templateMap.get(templateId);
  const vars = toRecord(metadata.vars);
  const assetPaths = toRecord(metadata.assetPaths);
  const autoCapture = template
    ? resolveCapturedFields(assetStore, template, vars, normalizeRowsAssetPaths(assetPaths))
    : null;
  if (!autoCapture) return explicit ?? null;
  return mergeCaptured(autoCapture, explicit);
}

export async function closeEventsWithAutoCapture(options: {
  assetStore: AssetStore;
  eventStore: EventStore;
  templateMap: Map<string, EventTemplateDefinition>;
  rows: EventRow[];
  notes?: string;
  ts?: string;
  explicitCaptured?: unknown;
}): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; rows: EventRow[] }> {
  const closedRows: EventRow[] = [];
  let effectiveTs = options.ts;
  for (const row of options.rows) {
    const metadata = getEventTemplateMetadataFromRow(row);
    const closeTimeSource = metadata.closeTimeSource as EventTemplateTimeSource | undefined;
    const assetPaths = normalizeRowsAssetPaths(toRecord(metadata.assetPaths));
    const resolvedTs = effectiveTs || (closeTimeSource && closeTimeSource.source === "asset_path_attribute"
      ? String(options.assetStore.getAttribute(`${String(assetPaths[String(closeTimeSource.assetPathId || "")] || "")}.${String(closeTimeSource.attributeName || "")}`, new Date().toISOString()))
      : undefined);
    const result = await options.eventStore.closeById(
      row.id,
      resolvedTs,
      options.notes || "",
      buildCloseRowsCapture(options.assetStore, row, options.templateMap, options.explicitCaptured)
    );
    if (result.closedCount > 0) {
      const closedRow = await options.eventStore.getById(row.id);
      if (closedRow) {
        closedRows.push(closedRow);
        const childPatterns = Array.isArray((metadata.policy as { closeChildrenOnClosePatterns?: unknown })?.closeChildrenOnClosePatterns)
          ? ((metadata.policy as { closeChildrenOnClosePatterns?: unknown }).closeChildrenOnClosePatterns as unknown[]).map((item) => String(item || "").trim()).filter(Boolean)
          : [];
        if (childPatterns.length > 0) {
          const childRows = await closeRowsByPatterns({
            assetStore: options.assetStore,
            eventStore: options.eventStore,
            templateMap: options.templateMap,
            patterns: childPatterns,
            notes: options.notes,
            ts: result.ts,
            excludeIds: new Set([row.id])
          });
          closedRows.push(...childRows);
        }
      }
      if (!effectiveTs) effectiveTs = result.ts;
    }
  }
  return {
    pattern: "*",
    closedCount: closedRows.length,
    ts: effectiveTs || new Date().toISOString(),
    notes_on_close: options.notes == null ? null : String(options.notes),
    rows: closedRows
  };
}

export async function closeEventFromTemplate(options: {
  assetStore: AssetStore;
  eventStore: EventStore;
  templateMap: Map<string, EventTemplateDefinition>;
  templateId: string;
  closeOptions?: EventTemplateCloseOptions;
}): Promise<{ pattern: string; closedCount: number; ts: string; notes_on_close: string | null; rows: EventRow[] }> {
  const template = mergeTemplate(getTemplate(options.templateMap, options.templateId), options.closeOptions?.templateOverrides);
  const vars = { ...(options.closeOptions?.vars || {}) };
  const metadata = buildTemplateMetadata(template, vars);
  const ts = resolveTime(options.assetStore, template.timeSource?.close, vars, metadata.assetPaths || {}, options.closeOptions?.ts);
  if (options.closeOptions?.id) {
    const row = await options.eventStore.getById(String(options.closeOptions.id));
    if (!row || row.status !== "open") {
      return {
        pattern: String(options.closeOptions.id),
        closedCount: 0,
        ts: ts || new Date().toISOString(),
        notes_on_close: options.closeOptions?.notes == null ? null : String(options.closeOptions.notes),
        rows: []
      };
    }
    return await closeEventsWithAutoCapture({
      assetStore: options.assetStore,
      eventStore: options.eventStore,
      templateMap: options.templateMap,
      rows: [row],
      notes: options.closeOptions?.notes,
      ts,
      explicitCaptured: options.closeOptions?.capturedDataOnClose
    });
  }
  const pattern = String(options.closeOptions?.pattern || metadata.closePattern || metadata.eventPath || "*");
  const rows = await options.eventStore.get(pattern, "*", "*", "open", {}, { limit: 5000 });
  return await closeEventsWithAutoCapture({
    assetStore: options.assetStore,
    eventStore: options.eventStore,
    templateMap: options.templateMap,
    rows,
    notes: options.closeOptions?.notes,
    ts,
    explicitCaptured: options.closeOptions?.capturedDataOnClose
  });
}
