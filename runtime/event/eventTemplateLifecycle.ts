import type {
  AssetStore,
  EventRow,
  EventStore,
  EventTemplateCloseOptions,
  EventTemplateDefinition,
  EventTemplateOpenOptions,
  EventTemplateTimeSource
} from "../types";
import { mergeTemplate, toRecord } from "./eventTemplateNormalization";
import {
  buildResolvedContext,
  buildTemplateMetadata,
  getEventTemplateMetadataFromRow,
  getTemplate,
  mergeCaptured,
  normalizeRowsAssetPaths,
  parseTimestampMs,
  resolveCapturedFields,
  resolveTime
} from "./eventTemplateResolution";

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
    const rows = (await options.eventStore.get(pattern, "*", "*", "open", {}, { limit: 5000 })).filter((row) => !excluded.has(row.id));
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
  const { capturedValues, context } = buildResolvedContext(options.assetStore, template, vars, explicitContext, metadata.assetPaths || {});
  const concurrencyMode = template.concurrencyMode || (template.allowParallel === false ? "unique_exact_path" : "parallel");
  if (concurrencyMode !== "parallel") {
    const uniquePattern = concurrencyMode === "unique_pattern" ? String(metadata.policy?.uniquePattern || metadata.closePattern || metadata.eventPath || "*") : metadata.eventPath;
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
  const autoCapture = template ? resolveCapturedFields(assetStore, template, vars, normalizeRowsAssetPaths(assetPaths)) : null;
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
    const resolvedTs =
      effectiveTs ||
      (closeTimeSource && closeTimeSource.source === "asset_path_attribute"
        ? String(
            options.assetStore.getAttribute(
              `${String(assetPaths[String(closeTimeSource.assetPathId || "")] || "")}.${String(closeTimeSource.attributeName || "")}`,
              new Date().toISOString()
            )
          )
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
