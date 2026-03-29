import fs from "node:fs";
import path from "node:path";
import Runtime from "./Runtime";
import createScriptActionHandler from "./createScriptActionHandler";
import createEventActionHandler from "./createEventActionHandler";
import { normalizeAssetSection } from "./assetFramework";
import { ensureAssetStorage } from "./assetStorage";
import { ensureEventStore } from "./eventStore";
import { normalizeEventTemplates } from "./eventTemplateRuntime";
import type { EventActionBinding, EventActionDefinition, EventStore, EventStoreChangeMeta, ProgramDefinition, RuntimeMessage, RuntimeNodeHandler } from "./types";

interface ProgramAction {
  id: string;
  enabled?: boolean;
  type: string;
  templateId?: string;
  eventTemplateId?: string;
  eventTemplateOverrides?: Record<string, unknown>;
  script?: string;
  config?: Record<string, unknown>;
  templateBindingOverrides?: Record<string, unknown>;
}

interface ProgramEventAction extends EventActionDefinition {}

interface ProgramFlowNode {
  id: string;
  kind: "trigger" | "action" | "event_open" | "event_close";
  refId?: string;
  label?: string;
  enabled?: boolean;
  templateId?: string;
  config?: Record<string, unknown>;
}

interface ProgramLink {
  from: string;
  to: string;
  fromPort?: string;
  enabled?: boolean;
}

interface ProgramTrigger {
  id: string;
  type:
    | "interval"
    | "watcher_set"
    | "watcher_valuechange"
    | "watcher_event_falling";
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

function registerFlowNodes(runtime: Runtime, nodes: unknown[] = []): void {
  const scriptTemplates = runtime.getGlobal("scriptTemplates", []);
  const templateById = new Map(
    (Array.isArray(scriptTemplates) ? scriptTemplates : []).map((template) => [String((template as { id?: unknown }).id || ""), template])
  );
  const eventTemplateList = runtime.getGlobal("eventTemplates", []);
  const eventTemplateById = new Map(
    (Array.isArray(eventTemplateList) ? eventTemplateList : []).map((template) => [
      String((template as { id?: unknown }).id || ""),
      template as any
    ])
  );

  for (const rawNode of nodes) {
    const node = rawNode as ProgramFlowNode;
    if (!node.id) throw new Error("Flow node must have an id");
    if (node.enabled === false) {
      runtime.addNode(node.id, async (_msg, _send) => {});
      continue;
    }
    if (node.kind === "trigger") {
      runtime.addNode(node.id, async (msg, send) => {
        send(msg);
      });
      continue;
    }
    if (node.kind === "action") {
      const handler = createActionHandler(
        {
          id: node.id,
          type: "script",
          templateId: node.templateId,
          eventTemplateId: String(node.config?.eventTemplateId || ""),
          eventTemplateOverrides:
            node.config?.eventTemplateOverrides && typeof node.config.eventTemplateOverrides === "object"
              ? (node.config.eventTemplateOverrides as Record<string, unknown>)
              : ({} as Record<string, unknown>),
          script: String(node.config?.script || ""),
          config:
            node.config && typeof node.config === "object"
              ? (node.config as Record<string, unknown>)
              : ({} as Record<string, unknown>),
          templateBindingOverrides:
            node.config?.templateBindingOverrides && typeof node.config.templateBindingOverrides === "object"
              ? (node.config.templateBindingOverrides as Record<string, unknown>)
              : {}
        },
        { templateById }
      );
      runtime.addNode(node.id, handler);
      continue;
    }
    if (node.kind === "event_open" || node.kind === "event_close") {
      const item: ProgramEventAction = {
        id: String(node.refId || node.id),
        enabled: true,
        label: node.label || "",
        description: String(node.config?.description || ""),
        templateId: node.templateId || "",
        templateOverrides:
          node.config?.templateOverrides && typeof node.config.templateOverrides === "object"
            ? (node.config.templateOverrides as Record<string, unknown>)
            : {},
        bindings:
          node.config?.bindings && typeof node.config.bindings === "object"
            ? (node.config.bindings as Record<string, EventActionBinding>)
            : ({} as Record<string, EventActionBinding>),
        openNotes: String(node.config?.openNotes || ""),
        closeNotes: String(node.config?.closeNotes || "")
      };
      runtime.addNode(
        node.id,
        createEventActionHandler(item, node.kind === "event_open" ? "open" : "close", { eventTemplateById })
      );
      continue;
    }
    runtime.addNode(node.id, async (_msg, _send) => {});
  }
}

function registerLinks(runtime: Runtime, links: unknown[] = []): void {
  for (const rawLink of links) {
    const link = rawLink as ProgramLink;
    if (!link.from || !link.to) throw new Error("Link must include both from and to");
    if (link.enabled === false) continue;
    runtime.wire(link.from, link.to, link.fromPort || "default");
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
    msg._trigger = {
      id: trigger.id,
      type: "watcher_event_falling",
      watchPath,
      source: meta.type,
      ts: new Date().toISOString()
    };
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
    if (trigger.type === "watcher_event_falling") {
      stops.push(startEventFallingTrigger(runtime, trigger));
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
  runtime.setGlobal("eventTemplates", normalizeEventTemplates(program.eventTemplates || []));
  runtime.setGlobal("scriptTemplates", Array.isArray(program.scriptTemplates) ? program.scriptTemplates : []);
  registerFlowNodes(runtime, (program.flows && program.flows.nodes) || []);
  registerLinks(runtime, (program.flows && program.flows.links) || []);
  const stops = startTriggers(runtime, program.triggers || []);

  return () => {
    for (const stop of stops) stop();
  };
}
