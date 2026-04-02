import type { EventRow, EventStoreChangeMeta, RuntimeMessage } from "../core/runtimeTypes";
import type { ProgramFlowNode, ProgramTrigger, ProgramTriggerTemplate } from "./ProgramFlowContracts";

export type WatcherMode = "set" | "valuechange";

export interface WatchAttributeRecord {
  kind?: unknown;
  path?: unknown;
  assetId?: unknown;
  attributeName?: unknown;
  value?: unknown;
  ts?: unknown;
  [key: string]: unknown;
}

export interface TriggerRuntimeDeps {
  now?: () => string;
  cloneMessage?: <T>(value: T) => T;
}

export function createTriggerRuntimeDeps(deps: TriggerRuntimeDeps = {}): Required<TriggerRuntimeDeps> {
  return {
    now: deps.now || (() => new Date().toISOString()),
    cloneMessage: deps.cloneMessage || (<T>(value: T) => structuredClone(value))
  };
}

export function splitPath(pathValue: string): string[] {
  return String(pathValue || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function matchWildcardPath(pattern: string, value: string): boolean {
  const p = splitPath(pattern);
  const v = splitPath(value);
  if (p.length !== v.length) return false;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] !== "*" && p[i] !== v[i]) return false;
  }
  return true;
}

export function matchWildcardText(pattern: string, value: string): boolean {
  const normalizedPattern = String(pattern || "").trim() || "*";
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return false;

  const patternParts = normalizedPattern.split("/").map((part) => part.trim());
  const valueParts = normalizedValue.split("/").map((part) => part.trim());
  if (patternParts.length !== valueParts.length) return false;

  for (let i = 0; i < patternParts.length; i += 1) {
    const pp = patternParts[i];
    const vp = valueParts[i];
    if (pp === "*") continue;
    const escaped = pp.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const segmentRegex = new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
    if (!segmentRegex.test(vp)) return false;
  }

  return true;
}

export function resolveTriggerConfig(
  node: ProgramFlowNode,
  templateById: Map<string, ProgramTriggerTemplate>
): ProgramTrigger {
  const config = node.config && typeof node.config === "object" ? (node.config as Record<string, unknown>) : {};
  const template = node.templateId ? templateById.get(node.templateId) : undefined;
  return {
    id: node.id,
    enabled: node.enabled !== false && template?.enabled !== false,
    type: String(config.type || template?.type || "interval") as ProgramTrigger["type"],
    intervalMs: Math.max(1, Number(config.intervalMs ?? template?.intervalMs ?? 1000) || 1000),
    activeFrom: String(config.activeFrom ?? template?.activeFrom ?? ""),
    activeTo: String(config.activeTo ?? template?.activeTo ?? ""),
    watchPath: String(config.watchPath ?? template?.watchPath ?? ""),
    message:
      config.message && typeof config.message === "object"
        ? (config.message as Record<string, unknown>)
        : template?.message && typeof template.message === "object"
          ? (template.message as Record<string, unknown>)
          : { payload: 0 }
  };
}

export function resolveTriggers(
  triggerNodes: ProgramFlowNode[] = [],
  triggerTemplates: ProgramTriggerTemplate[] = [],
  legacyTriggers: unknown[] = []
): ProgramTrigger[] {
  const templateById = new Map(triggerTemplates.map((item) => [String(item.id || "").trim(), item]));
  return triggerNodes.length > 0
    ? triggerNodes.map((node) => resolveTriggerConfig(node, templateById))
    : (legacyTriggers as ProgramTrigger[]);
}

export function normalizeWatchPath(trigger: ProgramTrigger, fallback: string): string {
  return String(trigger.watchPath || "").trim() || fallback;
}

export function createTriggerMessage(
  trigger: ProgramTrigger,
  payload: Record<string, unknown>,
  triggerMeta: Record<string, unknown>,
  deps: Required<TriggerRuntimeDeps>
): RuntimeMessage {
  const baseMsg = trigger.message || {};
  const msg = deps.cloneMessage(baseMsg) as Record<string, unknown>;
  msg.payload = payload;
  msg._trigger = {
    id: trigger.id,
    ...triggerMeta,
    ts: deps.now()
  };
  return msg as RuntimeMessage;
}

export function getAttributeChanges(meta: unknown): WatchAttributeRecord[] {
  const changes = Array.isArray((meta as { change?: { changes?: unknown[] } } | undefined)?.change?.changes)
    ? ((meta as { change?: { changes?: unknown[] } }).change?.changes as unknown[])
    : [];
  return changes.filter((change): change is WatchAttributeRecord => Boolean(change) && typeof change === "object");
}

export function matchesWatcherPath(watchPath: string, change: WatchAttributeRecord): boolean {
  return String(change.kind || "") === "attribute" && matchWildcardPath(watchPath, String(change.path || ""));
}

export function computeAttributeChangeKey(change: WatchAttributeRecord): string {
  return `${String(change.assetId || "")}:${String(change.attributeName || "")}`;
}

export function computeAttributeSignature(change: WatchAttributeRecord): string {
  return `${JSON.stringify(change.value ?? null)}::${String(change.ts ?? "")}`;
}

export function shouldEmitAttributeChange(
  mode: WatcherMode,
  change: WatchAttributeRecord,
  watchPath: string,
  lastSeenByKey: Map<string, string>
): boolean {
  if (!matchesWatcherPath(watchPath, change)) return false;
  if (mode === "set") return true;
  const key = computeAttributeChangeKey(change);
  const sig = computeAttributeSignature(change);
  const prevSig = lastSeenByKey.get(key);
  if (prevSig === sig) return false;
  lastSeenByKey.set(key, sig);
  return true;
}

export function getEventRows(meta: EventStoreChangeMeta): EventRow[] {
  return Array.isArray(meta.rows) ? meta.rows : meta.row ? [meta.row] : [];
}

export function mapClosedEventRow(meta: EventStoreChangeMeta, row: EventRow): Record<string, unknown> | null {
  if (row.status !== "closed") return null;
  return {
    id: row.id,
    event_path: row.event_path,
    start_ts: row.start_ts,
    end_ts: row.end_ts,
    status_before: "open",
    status_after: "closed",
    source: meta.type,
    event: row
  };
}

export function mapOpenedEventRow(meta: EventStoreChangeMeta, row: EventRow): Record<string, unknown> | null {
  if (row.status !== "open") return null;
  return {
    id: row.id,
    event_path: row.event_path,
    start_ts: row.start_ts,
    end_ts: row.end_ts,
    status_before: "closed",
    status_after: "open",
    source: meta.type,
    event: row
  };
}
