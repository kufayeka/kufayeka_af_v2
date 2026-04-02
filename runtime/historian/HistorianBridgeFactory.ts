import type { AssetStore, AttributeQueryMatch, HistorianTarget } from "../core/runtimeTypes";
import type { HistorianPointRow } from "../db/dbConnectionManager";

interface HistorianBridgeTargetState {
  id: string;
  name: string;
  unit: "us" | "ns";
  enabled: boolean;
  enqueuedPoints: number;
  droppedPoints: number;
  invalidTimestampFallbacks: number;
}

interface HistorianBridgeOptions {
  enabled?: boolean;
  timestampUnit?: string;
  maxQueue?: number;
  targets?: unknown[];
  enqueueHistorianRows?: (rows: HistorianPointRow[]) => void;
}

function parseTimestamp(raw: unknown, unit: "us" | "ns"): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return normalizeEpoch(raw, unit);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const asInt = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asInt)) return normalizeEpoch(asInt, unit);
    const epochMs = Date.parse(trimmed);
    if (!Number.isNaN(epochMs)) return unit === "ns" ? epochMs * 1_000_000 : epochMs * 1_000;
  }
  return null;
}

function epochToMs(ts: number, unit: "us" | "ns"): number {
  if (!Number.isFinite(ts)) return Number.NaN;
  if (unit === "ns") return ts / 1_000_000;
  return ts / 1_000;
}

function isPlausibleEpoch(ts: number, unit: "us" | "ns"): boolean {
  const ms = epochToMs(ts, unit);
  if (!Number.isFinite(ms)) return false;
  const minMs = Date.UTC(2000, 0, 1, 0, 0, 0);
  const maxMs = Date.UTC(2200, 0, 1, 0, 0, 0);
  return ms >= minMs && ms <= maxMs;
}

function normalizeEpoch(value: number, unit: "us" | "ns"): number {
  const abs = Math.abs(value);
  if (unit === "ns") {
    if (abs < 1e13) return Math.trunc(value * 1_000_000);
    if (abs < 1e16) return Math.trunc(value * 1_000);
    return Math.trunc(value);
  }
  if (abs < 1e13) return Math.trunc(value * 1_000);
  if (abs > 1e16) return Math.trunc(value / 1_000);
  return Math.trunc(value);
}

function nowEpoch(unit: "us" | "ns"): number {
  const ms = Date.now();
  return unit === "ns" ? ms * 1_000_000 : ms * 1_000;
}

function toTargetConfig(input: unknown): Partial<HistorianTarget> {
  if (!input || typeof input !== "object") return {};
  return input as Partial<HistorianTarget>;
}

export function fnv1a32(input: unknown): number {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function makeTagKey(assetId: string, attributeName: string): string {
  return `${assetId}:${attributeName}`;
}

export function computeTagID(assetId: string, attributeName: string): number {
  return fnv1a32(makeTagKey(assetId, attributeName));
}

export function createHistorianBridge(options: HistorianBridgeOptions = {}) {
  const enabled = options.enabled !== false;
  const fallbackUnit: "us" | "ns" = options.timestampUnit === "ns" ? "ns" : "us";
  const maxQueue = Math.max(1000, Number(options.maxQueue || 100000));
  const enqueueHistorianRows =
    typeof options.enqueueHistorianRows === "function" ? options.enqueueHistorianRows : (_rows: HistorianPointRow[]) => {};
  const targets = new Map<string, HistorianBridgeTargetState>();
  const queue: Array<{ targetId: string; row: HistorianPointRow }> = [];
  let droppedByQueue = 0;

  const ensureTarget = (cfgInput: unknown): HistorianBridgeTargetState => {
    const cfg = toTargetConfig(cfgInput);
    const id = String(cfg.id || "default");
    if (targets.has(id)) return targets.get(id) as HistorianBridgeTargetState;
    const target: HistorianBridgeTargetState = {
      id,
      name: String(cfg.name || id),
      unit: cfg.timestampUnit === "ns" ? "ns" : fallbackUnit,
      enabled: cfg.enabled !== false,
      enqueuedPoints: 0,
      droppedPoints: 0,
      invalidTimestampFallbacks: 0
    };
    targets.set(id, target);
    return target;
  };

  const applyTargets = (cfgTargets: unknown[] = []): void => {
    const normalized = Array.isArray(cfgTargets) ? cfgTargets : [];
    const nextIds = new Set(["default"]);
    ensureTarget({
      id: "default",
      name: "Default Historian",
      timestampUnit: fallbackUnit,
      enabled: true
    });
    for (const t of normalized) {
      if (!t || typeof t !== "object") continue;
      const id = String((t as { id?: unknown }).id || "");
      if (!id) continue;
      nextIds.add(id);
      const current = ensureTarget(t);
      const obj = t as Partial<HistorianTarget>;
      current.name = String(obj.name || id);
      current.unit = obj.timestampUnit === "ns" ? "ns" : "us";
      current.enabled = obj.enabled !== false;
    }
    for (const [id] of targets.entries()) {
      if (nextIds.has(id)) continue;
      targets.delete(id);
    }
  };
  applyTargets(options.targets || []);

  const resolveTimeSource = (change: AttributeQueryMatch, store: AssetStore, unit: "us" | "ns"): number => {
    const fallbackToNow = (): number => {
      const fromChangeTs = parseTimestamp(change.ts, unit);
      if (fromChangeTs != null && isPlausibleEpoch(fromChangeTs, unit)) return fromChangeTs;
      return nowEpoch(unit);
    };
    const sourcePath = String(change.historianTimeSourcePath || "").trim();
    if (!sourcePath) return fallbackToNow();
    const matches = store.query(sourcePath).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return fallbackToNow();
    const ts = parseTimestamp(matches[0].value, unit);
    if (ts == null || !isPlausibleEpoch(ts, unit)) return fallbackToNow();
    return ts;
  };

  const flush = (): void => {
    if (!enabled || queue.length === 0) return;
    const rows = queue.splice(0, queue.length).map((item) => item.row);
    enqueueHistorianRows(rows);
  };

  return {
    updateTargets(nextTargets: unknown[] = []) {
      applyTargets(nextTargets);
    },
    enqueueChanges(changes: AttributeQueryMatch[] = [], store: AssetStore) {
      if (!enabled || !store) return;
      for (const change of changes) {
        if (!change || change.kind !== "attribute") continue;
        if (change.historianEnabled !== true) continue;
        if (!change.assetId || !change.attributeName) continue;
        const targetId = String(change.historianTargetId || "default");
        const target = targets.get(targetId) || targets.get("default");
        if (!target || !target.enabled) continue;
        const resolvedTs = resolveTimeSource(change, store, target.unit);
        const resolvedDate = new Date(epochToMs(resolvedTs, target.unit));
        if (Number.isNaN(resolvedDate.getTime())) {
          target.droppedPoints += 1;
          continue;
        }
        if (!isPlausibleEpoch(resolvedTs, target.unit)) target.invalidTimestampFallbacks += 1;
        queue.push({
          targetId: target.id,
          row: {
            ts: resolvedDate,
            attributePath: change.path,
            value: change.value
          }
        });
        target.enqueuedPoints += 1;
      }
      if (queue.length > maxQueue) {
        const overflow = queue.length - maxQueue;
        const dropped = queue.splice(0, overflow);
        droppedByQueue += dropped.length;
      }
      flush();
    },
    stats() {
      const byTarget: Record<string, unknown> = {};
      for (const target of targets.values()) {
        byTarget[target.id] = {
          name: target.name,
          enabled: target.enabled,
          timestampUnit: target.unit,
          enqueuedPoints: target.enqueuedPoints,
          droppedPoints: target.droppedPoints,
          invalidTimestampFallbacks: target.invalidTimestampFallbacks
        };
      }
      return {
        enabled,
        queue: queue.length,
        droppedByQueue,
        targets: byTarget
      };
    },
    close() {
      flush();
    }
  };
}
