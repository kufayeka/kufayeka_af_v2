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

interface ProgramFlowDefinition {
  id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  variables?: Array<{
    name?: string;
    source?: string;
    staticValue?: unknown;
    attributePath?: string;
  }>;
  nodes?: ProgramFlowNode[];
  links?: ProgramLink[];
  nodePositions?: Record<string, unknown>;
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
    | "cron"
    | "watcher_set"
    | "watcher_valuechange"
    | "watcher_event_falling"
    | "watcher_event_open"
    | "watcher_event_close";
  enabled?: boolean;
  intervalMs?: number;
  activeFrom?: string;
  activeTo?: string;
  message?: Record<string, unknown>;
  watchPath?: string;
}

interface ProgramTriggerTemplate extends ProgramTrigger {
  name?: string;
  description?: string;
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

function resolveFlowVariableValue(
  variable: { source?: string; staticValue?: unknown; attributePath?: string },
  runtimeContext: Parameters<RuntimeNodeHandler>[2]
): unknown {
  const source = String(variable?.source || "static_string");
  const path = String(variable?.attributePath || "").trim();
  if (source === "asset") {
    if (!path) return null;
    const matches = runtimeContext.asset.query(path).filter((item) => item.kind === "asset");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }
  if (source === "attribute") {
    if (!path) return null;
    const matches = runtimeContext.asset.query(path).filter((item) => item.kind === "attribute");
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return matches;
  }
  if (source === "static_number") return Number(variable?.staticValue || 0);
  if (source === "static_boolean") return variable?.staticValue === true || String(variable?.staticValue).toLowerCase() === "true";
  if (source === "static_array") return Array.isArray(variable?.staticValue) ? variable?.staticValue : [];
  if (source === "static_object") return variable?.staticValue && typeof variable.staticValue === "object" ? variable.staticValue : {};
  return variable?.staticValue ?? "";
}

function buildProgramFlows(program: ProgramDefinition): ProgramFlowDefinition[] {
  if (Array.isArray(program.flowDefinitions) && program.flowDefinitions.length > 0) {
    return program.flowDefinitions as ProgramFlowDefinition[];
  }
  return [
    {
      id: String((program.flows as { id?: unknown } | undefined)?.id || "flow_main"),
      name: String((program.flows as { name?: unknown } | undefined)?.name || "Main Flow"),
      enabled: (program.flows as { enabled?: unknown } | undefined)?.enabled !== false,
      variables: Array.isArray((program.flows as { variables?: unknown } | undefined)?.variables)
        ? ((program.flows as { variables?: unknown[] }).variables as ProgramFlowDefinition["variables"])
        : [],
      nodes: Array.isArray(program.flows?.nodes) ? (program.flows?.nodes as ProgramFlowNode[]) : [],
      links: Array.isArray(program.flows?.links) ? (program.flows?.links as ProgramLink[]) : [],
      nodePositions:
        program.flows?.nodePositions && typeof program.flows.nodePositions === "object"
          ? (program.flows.nodePositions as Record<string, unknown>)
          : {}
    }
  ];
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
  const flowDefinitionsById = new Map(
    Object.entries(runtime.getGlobal<Record<string, ProgramFlowDefinition>>("flowDefinitionsById", {}))
  );

  const nodeConfigById: Record<string, Record<string, unknown>> = {};
  const seenNodeIds = new Set<string>();
  for (const rawNode of nodes) {
    const node = rawNode as ProgramFlowNode;
    if (!node.id) throw new Error("Flow node must have an id");
    if (seenNodeIds.has(node.id)) {
      const flowId = String((node.config as Record<string, unknown> | undefined)?.__flowId || "").trim();
      throw new Error(`Duplicate flow node id "${node.id}" detected${flowId ? ` in flow "${flowId}"` : ""}`);
    }
    seenNodeIds.add(node.id);
    nodeConfigById[node.id] =
      node.config && typeof node.config === "object"
        ? (node.config as Record<string, unknown>)
        : {};
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
        { templateById, flowById: flowDefinitionsById as any }
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
  runtime.setGlobal("flowNodeConfigById", nodeConfigById);
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
    msg._trigger = {
      id: trigger.id,
      type: "watcher_event_open",
      watchPath,
      source: meta.type,
      ts: new Date().toISOString()
    };
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

function resolveTriggerConfig(
  node: ProgramFlowNode,
  templateById: Map<string, ProgramTriggerTemplate>
): ProgramTrigger {
  const config = node.config && typeof node.config === "object" ? (node.config as Record<string, unknown>) : {};
  const template = node.templateId ? templateById.get(node.templateId) : undefined;
  return {
    id: node.id,
    enabled: node.enabled !== false && (template?.enabled !== false),
    type:
      String(config.type || template?.type || "interval") as ProgramTrigger["type"],
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

function startTriggers(
  runtime: Runtime,
  triggerNodes: ProgramFlowNode[] = [],
  triggerTemplates: ProgramTriggerTemplate[] = [],
  legacyTriggers: unknown[] = []
): Array<() => void> {
  const stops: Array<() => void> = [];
  const templateById = new Map(triggerTemplates.map((item) => [String(item.id || "").trim(), item]));
  const derivedTriggers =
    triggerNodes.length > 0
      ? triggerNodes.map((node) => resolveTriggerConfig(node, templateById))
      : (legacyTriggers as ProgramTrigger[]);

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

export function startProgram(runtime: Runtime, program: ProgramDefinition): () => void {
  const assets = normalizeAssetSection(program.assets || {});
  const assetStorage = ensureAssetStorage(runtime, assets);
  ensureEventStore(runtime);
  assetStorage.replace(assets);
  runtime.setGlobal("eventTemplates", normalizeEventTemplates(program.eventTemplates || []));
  runtime.setGlobal("scriptTemplates", Array.isArray(program.scriptTemplates) ? program.scriptTemplates : []);
  const programFlows = buildProgramFlows(program).filter((flow) => flow.enabled !== false);
  const flatNodes = programFlows.flatMap((flow) =>
    ((flow.nodes || []) as ProgramFlowNode[]).map((node) => ({
      ...node,
      config: {
        ...((node.config && typeof node.config === "object") ? node.config : {}),
        __flowId: flow.id
      }
    }))
  );
  const flatLinks = programFlows.flatMap((flow) => (flow.links || []) as ProgramLink[]);
  runtime.setGlobal(
    "flowDefinitionsById",
    Object.fromEntries(programFlows.map((flow) => [flow.id, flow]))
  );
  runtime.setGlobal(
    "resolveFlowVariables",
    (flowId: string, context: Parameters<RuntimeNodeHandler>[2]) => {
      const flow = programFlows.find((item) => item.id === flowId);
      if (!flow) return {};
      const resolved: Record<string, unknown> = {};
      for (const [index, variable] of (flow.variables || []).entries()) {
        const key = String(variable?.name || "").trim();
        if (!key) continue;
        resolved[key] = resolveFlowVariableValue((flow.variables || [])[index] || {}, context);
      }
      return resolved;
    }
  );
  registerFlowNodes(runtime, flatNodes);
  registerLinks(runtime, flatLinks);
  const triggerNodes = flatNodes.filter((node) => node.kind === "trigger");
  const stops = startTriggers(
    runtime,
    triggerNodes,
    Array.isArray(program.triggerTemplates) ? (program.triggerTemplates as ProgramTriggerTemplate[]) : [],
    program.triggers || []
  );

  return () => {
    for (const stop of stops) stop();
  };
}
