import type {
  AssetStore,
  EventRow,
  EventTemplateBinding,
  EventTemplateDefinition,
  EventTemplateField,
  EventTemplateMetadata,
  EventTemplateTimeSource
} from "../types";
import { firstNonEmptyString, hasRenderableValue, renderTemplate, toRecord } from "./eventTemplateNormalization";

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

export function resolveAssetPaths(template: EventTemplateDefinition, vars: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const item of template.assetPaths || []) {
    output[item.id] = item.source === "static" ? String(item.value || "").trim() : firstNonEmptyString([vars[String(item.key || "")]]);
  }
  const sharedAssetPath = firstNonEmptyString([output.assetPath, output.asset, vars.assetPath, vars.asset]);
  if (!output.assetPath && sharedAssetPath) output.assetPath = sharedAssetPath;
  if (!output.asset && sharedAssetPath) output.asset = sharedAssetPath;
  return output;
}

export function resolveAssetPathReference(
  assetPathId: string,
  assetPaths: Record<string, string>,
  vars: Record<string, unknown>
): string {
  const normalizedAssetPathId = String(assetPathId || "").trim();
  const nonEmptyAssetPaths = Object.values(assetPaths).map((item) => String(item || "").trim()).filter(Boolean);
  return firstNonEmptyString([
    normalizedAssetPathId ? assetPaths[normalizedAssetPathId] : "",
    normalizedAssetPathId ? vars[normalizedAssetPathId] : "",
    assetPaths.assetPath,
    assetPaths.asset,
    vars.assetPath,
    vars.asset,
    nonEmptyAssetPaths.length === 1 ? nonEmptyAssetPaths[0] : ""
  ]);
}

export function resolveTime(
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
  const assetPath = resolveAssetPathReference(String(timeSource.assetPathId || ""), assetPaths, vars);
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
  const assetPath = resolveAssetPathReference(String(field.assetPathId || ""), assetPaths, vars);
  const attributeName = String(field.attributeName || "").trim();
  if (!assetPath || !attributeName) return null;
  return assetStore.getAttribute(`${assetPath}.${attributeName}`, null);
}

export function resolveCapturedFields(
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

export function resolveContextFields(
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

export function mergeCaptured(autoCapture: Record<string, unknown>, explicit: unknown): unknown {
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) return autoCapture;
  return {
    ...autoCapture,
    explicit: explicit as Record<string, unknown>
  };
}

export function getEventTemplateMetadataFromRow(row: EventRow): Record<string, unknown> {
  const metadataFromColumn = toRecord(row.event_metadata);
  if (Object.keys(metadataFromColumn).length > 0) return metadataFromColumn;
  return toRecord(toRecord(row.context).__event_template);
}

export function getTemplate(templateMap: Map<string, EventTemplateDefinition>, templateId: string): EventTemplateDefinition {
  const template = templateMap.get(String(templateId || "").trim());
  if (!template || template.enabled === false) {
    throw new Error(`Event template "${String(templateId || "")}" not found`);
  }
  return template;
}

export function buildTemplateMetadata(template: EventTemplateDefinition, vars: Record<string, unknown>): EventTemplateMetadata {
  const assetPaths = resolveAssetPaths(template, vars);
  const renderVars = { ...assetPaths, ...vars };
  const eventPath = renderTemplate(template.eventPathTemplate, renderVars).trim();
  const closePattern = renderTemplate(template.closePatternTemplate || template.eventPathTemplate, renderVars).trim() || eventPath;
  const assetPath = firstNonEmptyString([assetPaths.assetPath, assetPaths.asset, vars.assetPath, vars.asset]);
  const uniquePattern = renderTemplate(template.uniquePatternTemplate || "", renderVars).trim();
  const requiredParentPattern = renderTemplate(template.requiredParentPattern || "", renderVars).trim();
  const closeOnOpenPatterns = (template.closeOnOpenPatterns || []).map((item) => renderTemplate(item, renderVars).trim()).filter(Boolean);
  const closeChildrenOnClosePatterns = (template.closeChildrenOnClosePatterns || []).map((item) => renderTemplate(item, renderVars).trim()).filter(Boolean);
  const missingPathVars = Array.from(
    new Set(
      (template.eventPathTemplate.match(/\{([^}]+)\}/g) || [])
        .map((item) => item.slice(1, -1).trim())
        .filter((key) => !hasRenderableValue(renderVars[key]))
    )
  );
  if (missingPathVars.length > 0) {
    throw new Error(`Event template "${template.id}" is missing value(s) for event path: ${missingPathVars.join(", ")}`);
  }
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

export function normalizeRowsAssetPaths(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item || "")]));
}

export function parseTimestampMs(value: string | undefined | null): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function buildResolvedContext(
  assetStore: AssetStore,
  template: EventTemplateDefinition,
  vars: Record<string, unknown>,
  explicitContext: Record<string, unknown>,
  assetPaths: Record<string, string>
): { capturedValues: Record<string, unknown>; context: Record<string, unknown> } {
  const capturedValues = resolveCapturedFields(assetStore, template, vars, assetPaths);
  const legacyContext = resolveContext(assetStore, template, vars, explicitContext);
  const context = resolveContextFields(assetStore, template, vars, assetPaths, capturedValues, legacyContext);
  return { capturedValues, context };
}
