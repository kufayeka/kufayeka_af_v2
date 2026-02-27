import fs from "node:fs";
import path from "node:path";
import Runtime from "./Runtime";
import createScriptActionHandler from "./createScriptActionHandler";
import { normalizeAssetSection } from "./assetFramework";
import { ensureAssetStorage } from "./assetStorage";
import { ensureEventStore } from "./eventStore";
import type { ProgramDefinition, RuntimeMessage, RuntimeNodeContext, RuntimeNodeHandler } from "./types";

interface ProgramAction {
  id: string;
  enabled?: boolean;
  type: string;
  templateId?: string;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, unknown>;
}

interface ProgramLink {
  from: string;
  to: string;
  enabled?: boolean;
}

interface ProgramTrigger {
  id: string;
  type:
    | "interval"
    | "watcher_set"
    | "watcher_valuechange";
  enabled?: boolean;
  intervalMs?: number;
  message?: Record<string, unknown>;
  watchPath?: string;
}

export function loadProgramFromFile(programPath: string): { absolutePath: string; program: ProgramDefinition } {
  const absolutePath = path.resolve(programPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const data = JSON.parse(raw) as ProgramDefinition;
  return { absolutePath, program: data };
}

function createActionHandler(action: ProgramAction, context: Record<string, unknown> = {}): RuntimeNodeHandler {
  if (action.type === "script") {
    return createScriptActionHandler(action as any, context as any);
  }
  throw new Error(`Unsupported action type "${action.type}"`);
}

function registerActions(runtime: Runtime, actions: unknown[] = []): void {
  const scriptTemplates = runtime.getGlobal("scriptTemplates", []);
  const templateById = new Map(
    (Array.isArray(scriptTemplates) ? scriptTemplates : []).map((template) => [String((template as { id?: unknown }).id || ""), template])
  );

  for (const rawAction of actions) {
    const action = rawAction as ProgramAction;
    if (!action.id) throw new Error("Action must have an id");
    if (action.enabled === false) {
      runtime.addNode(action.id, async (_msg, _send) => {});
      continue;
    }
    const handler = createActionHandler(action, { templateById });
    runtime.addNode(action.id, handler);
  }
}

function registerLinks(runtime: Runtime, links: unknown[] = []): void {
  for (const rawLink of links) {
    const link = rawLink as ProgramLink;
    if (!link.from || !link.to) throw new Error("Link must include both from and to");
    if (link.enabled === false) continue;
    runtime.wire(link.from, link.to);
  }
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

  const computeSignature = (change: Record<string, unknown>): string => {
    const valueJson = JSON.stringify(change.value ?? null);
    return `${valueJson}::${String(change.ts ?? "")}`;
  };

  const changeKey = (change: Record<string, unknown>): string => {
    return `${String(change.assetId || "")}:${String(change.attributeName || "")}`;
  };

  const emitChange = (change: Record<string, unknown>, source: "subscribe" | "poll"): void => {
    const msg = structuredClone(baseMsg) as Record<string, unknown>;
    msg.payload = change;
    msg._trigger = { id: trigger.id, type: "watcher", watchPath, source, ts: new Date().toISOString() };
    runtime.send(trigger.id, msg as RuntimeMessage);
  };

  const matchesWatcherPath = (change: Record<string, unknown>): boolean => {
    return String(change.kind || "") === "attribute" && matchWildcardPath(watchPath, String(change.path || ""));
  };

  return {
    typedStore,
    lastSeenByKey,
    computeSignature,
    changeKey,
    emitChange,
    matchesWatcherPath,
  };
}

function startWatcherTrigger(runtime: Runtime, trigger: ProgramTrigger, mode: WatcherMode): () => void {
  const helpers = buildWatcherHelpers(runtime, trigger);
  const {
    typedStore,
    lastSeenByKey,
    computeSignature,
    changeKey,
    emitChange,
    matchesWatcherPath,
  } = helpers;

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

  if (mode === "valuechange") {
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

  throw new Error(`Unsupported watcher mode "${String(mode)}"`);
}

function startTriggers(runtime: Runtime, triggers: unknown[] = []): Array<() => void> {
  const stops: Array<() => void> = [];
  for (const rawTrigger of triggers) {
    const trigger = rawTrigger as ProgramTrigger;
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
    throw new Error(`Unsupported trigger type "${String(trigger.type)}"`);
  }
  return stops;
}

export function startProgram(runtime: Runtime, program: ProgramDefinition): () => void {
  const assets = normalizeAssetSection(program.assets || {});
  const assetStorage = ensureAssetStorage(runtime, assets);
  ensureEventStore(runtime);
  assetStorage.replace(assets);
  runtime.setGlobal("scriptTemplates", Array.isArray(program.scriptTemplates) ? program.scriptTemplates : []);
  registerActions(runtime, program.actions || []);
  registerLinks(runtime, (program.flows && program.flows.links) || []);
  const stops = startTriggers(runtime, program.triggers || []);

  return () => {
    for (const stop of stops) stop();
  };
}
