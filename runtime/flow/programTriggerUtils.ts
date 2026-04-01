import type Runtime from "../Runtime";
import type { EventStore, EventStoreChangeMeta, RuntimeMessage } from "../types";
import type { ProgramFlowNode, ProgramTrigger, ProgramTriggerTemplate } from "./programFlowTypes";

function splitPath(pathValue: string): string[] {
  return String(pathValue || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matchWildcardPath(pattern: string, value: string): boolean {
  const p = splitPath(pattern);
  const v = splitPath(value);
  if (p.length !== v.length) return false;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] !== "*" && p[i] !== v[i]) return false;
  }
  return true;
}

function matchWildcardText(pattern: string, value: string): boolean {
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

type WatcherMode = "set" | "valuechange";

interface WatchAttributeRecord {
  kind?: unknown;
  path?: unknown;
  assetId?: unknown;
  attributeName?: unknown;
  value?: unknown;
  ts?: unknown;
  [key: string]: unknown;
}

function startIntervalTrigger(runtime: Runtime, trigger: ProgramTrigger): () => void {
  const intervalMs = Math.max(1, Number(trigger.intervalMs) || 1000);
  const baseMsg = trigger.message || {};
  const timer = setInterval(() => {
    const msg = structuredClone(baseMsg) as Record<string, unknown>;
    msg._trigger = { id: trigger.id, type: "interval", ts: new Date().toISOString() };
    runtime.send(trigger.id, msg);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function buildWatcherHelpers(runtime: Runtime, trigger: ProgramTrigger) {
  const watchPath = String(trigger.watchPath || "").trim() || "*.*.*";
  const baseMsg = trigger.message || {};
  const store = runtime.getGlobal("assetStorage");
  if (!store || typeof (store as { subscribe?: unknown }).subscribe !== "function") {
    throw new Error(`Watcher trigger "${trigger.id}" failed: assetStorage is not available`);
  }

  const typedStore = store as {
    subscribe: (cb: (state: unknown, meta: any) => void) => () => void;
    query: (path: string) => Array<Record<string, unknown>>;
  };
  const lastSeenByKey = new Map<string, string>();

  const computeSignature = (change: Record<string, unknown>): string => `${JSON.stringify(change.value ?? null)}::${String(change.ts ?? "")}`;
  const changeKey = (change: Record<string, unknown>): string => `${String(change.assetId || "")}:${String(change.attributeName || "")}`;
  const emitChange = (change: Record<string, unknown>, source: "subscribe" | "poll"): void => {
    const msg = structuredClone(baseMsg) as Record<string, unknown>;
    msg.payload = change;
    msg._trigger = { id: trigger.id, type: "watcher", watchPath, source, ts: new Date().toISOString() };
    runtime.send(trigger.id, msg as RuntimeMessage);
  };
  const matchesWatcherPath = (change: Record<string, unknown>): boolean =>
    String(change.kind || "") === "attribute" && matchWildcardPath(watchPath, String(change.path || ""));

  return { typedStore, lastSeenByKey, computeSignature, changeKey, emitChange, matchesWatcherPath };
}

function startWatcherTrigger(runtime: Runtime, trigger: ProgramTrigger, mode: WatcherMode): () => void {
  const helpers = buildWatcherHelpers(runtime, trigger);
  const { typedStore, lastSeenByKey, computeSignature, changeKey, emitChange, matchesWatcherPath } = helpers;

  if (mode === "set") {
    const unsubscribe = typedStore.subscribe((_state, meta) => {
      const changes = Array.isArray(meta?.change?.changes) ? meta.change.changes : [];
      if (changes.length === 0) return;
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const typedChange = change as WatchAttributeRecord;
        if (!matchesWatcherPath(typedChange)) continue;
        emitChange(typedChange, "subscribe");
      }
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }

  const unsubscribe = typedStore.subscribe((_state, meta) => {
    const changes = Array.isArray(meta?.change?.changes) ? meta.change.changes : [];
    if (changes.length === 0) return;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const typedChange = change as WatchAttributeRecord;
      if (!matchesWatcherPath(typedChange)) continue;
      const key = changeKey(typedChange);
      const sig = computeSignature(typedChange);
      const prevSig = lastSeenByKey.get(key);
      if (prevSig === sig) continue;
      lastSeenByKey.set(key, sig);
      emitChange(typedChange, "subscribe");
    }
  });
  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function startEventFallingTrigger(runtime: Runtime, trigger: ProgramTrigger): () => void {
  const watchPath = String(trigger.watchPath || "").trim() || "*";
  const baseMsg = trigger.message || {};
  const eventStore = runtime.getGlobal<EventStore | undefined>("eventStore");
  if (!eventStore || typeof eventStore.subscribe !== "function") {
    throw new Error(`Watcher trigger "${trigger.id}" failed: eventStore is not available`);
  }

  const emitChange = (meta: EventStoreChangeMeta, row: Record<string, unknown>): void => {
    const msg = structuredClone(baseMsg) as Record<string, unknown>;
    msg.payload = row;
    msg._trigger = { id: trigger.id, type: "watcher_event_falling", watchPath, source: meta.type, ts: new Date().toISOString() };
    runtime.send(trigger.id, msg as RuntimeMessage);
  };

  const unsubscribe = eventStore.subscribe((meta) => {
    if (meta.type !== "close" && meta.type !== "closeById") return;
    const rows = Array.isArray(meta.rows) ? meta.rows : meta.row ? [meta.row] : [];
    for (const row of rows) {
      if (!row || row.status !== "closed") continue;
      if (!matchWildcardText(watchPath, row.event_path)) continue;
      emitChange(meta, {
        id: row.id,
        event_path: row.event_path,
        start_ts: row.start_ts,
        end_ts: row.end_ts,
        status_before: "open",
        status_after: "closed",
        source: meta.type,
        event: row
      });
    }
  });

  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function startEventOpenTrigger(runtime: Runtime, trigger: ProgramTrigger): () => void {
  const watchPath = String(trigger.watchPath || "").trim() || "*";
  const baseMsg = trigger.message || {};
  const eventStore = runtime.getGlobal<EventStore | undefined>("eventStore");
  if (!eventStore || typeof eventStore.subscribe !== "function") {
    throw new Error(`Watcher trigger "${trigger.id}" failed: eventStore is not available`);
  }

  const emitChange = (meta: EventStoreChangeMeta, row: Record<string, unknown>): void => {
    const msg = structuredClone(baseMsg) as Record<string, unknown>;
    msg.payload = row;
    msg._trigger = { id: trigger.id, type: "watcher_event_open", watchPath, source: meta.type, ts: new Date().toISOString() };
    runtime.send(trigger.id, msg as RuntimeMessage);
  };

  const unsubscribe = eventStore.subscribe((meta) => {
    if (meta.type !== "open") return;
    const rows = Array.isArray(meta.rows) ? meta.rows : meta.row ? [meta.row] : [];
    for (const row of rows) {
      if (!row || row.status !== "open") continue;
      if (!matchWildcardText(watchPath, row.event_path)) continue;
      emitChange(meta, {
        id: row.id,
        event_path: row.event_path,
        start_ts: row.start_ts,
        end_ts: row.end_ts,
        status_before: "closed",
        status_after: "open",
        source: meta.type,
        event: row
      });
    }
  });

  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function resolveTriggerConfig(node: ProgramFlowNode, templateById: Map<string, ProgramTriggerTemplate>): ProgramTrigger {
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

export function startTriggers(
  runtime: Runtime,
  triggerNodes: ProgramFlowNode[] = [],
  triggerTemplates: ProgramTriggerTemplate[] = [],
  legacyTriggers: unknown[] = []
): Array<() => void> {
  const stops: Array<() => void> = [];
  const templateById = new Map(triggerTemplates.map((item) => [String(item.id || "").trim(), item]));
  const derivedTriggers = triggerNodes.length > 0 ? triggerNodes.map((node) => resolveTriggerConfig(node, templateById)) : (legacyTriggers as ProgramTrigger[]);

  for (const trigger of derivedTriggers) {
    if (!trigger.id) throw new Error("Trigger must have an id");
    if (trigger.enabled === false) continue;
    if (trigger.type === "interval") {
      stops.push(startIntervalTrigger(runtime, trigger));
      continue;
    }
    if (trigger.type === "watcher_set") {
      stops.push(startWatcherTrigger(runtime, trigger, "set"));
      continue;
    }
    if (trigger.type === "watcher_valuechange") {
      stops.push(startWatcherTrigger(runtime, trigger, "valuechange"));
      continue;
    }
    if (trigger.type === "watcher_event_falling" || trigger.type === "watcher_event_close") {
      stops.push(startEventFallingTrigger(runtime, trigger));
      continue;
    }
    if (trigger.type === "watcher_event_open") {
      stops.push(startEventOpenTrigger(runtime, trigger));
      continue;
    }
    throw new Error(`Unsupported trigger type "${String(trigger.type)}"`);
  }

  return stops;
}
