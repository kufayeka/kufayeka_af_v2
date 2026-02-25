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
  type: "interval" | "watcher";
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
  throw new Error(`Action type "${action.type}" tidak didukung`);
}

function registerActions(runtime: Runtime, actions: unknown[] = []): void {
  const scriptTemplates = runtime.getGlobal("scriptTemplates", []);
  const templateById = new Map(
    (Array.isArray(scriptTemplates) ? scriptTemplates : []).map((template) => [String((template as { id?: unknown }).id || ""), template])
  );

  for (const rawAction of actions) {
    const action = rawAction as ProgramAction;
    if (!action.id) throw new Error("Action wajib punya id");
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
    if (!link.from || !link.to) throw new Error("Link wajib punya from dan to");
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

function startWatcherTrigger(runtime: Runtime, trigger: ProgramTrigger): () => void {
  const watchPath = String(trigger.watchPath || "").trim() || "*.*.*";
  const baseMsg = trigger.message || {};
  const store = runtime.getGlobal("assetStorage");
  if (!store || typeof (store as { subscribe?: unknown }).subscribe !== "function") {
    throw new Error(`Trigger watcher "${trigger.id}" gagal: assetStorage belum tersedia`);
  }

  const unsubscribe = (store as { subscribe: (cb: (state: unknown, meta: any) => void) => () => void }).subscribe((_state, meta) => {
    const changes = Array.isArray(meta?.change?.changes) ? meta.change.changes : [];
    if (changes.length === 0) return;
    for (const change of changes) {
      if (!change || change.kind !== "attribute") continue;
      if (!matchWildcardPath(watchPath, String(change.path))) continue;
      const msg = structuredClone(baseMsg) as Record<string, unknown>;
      msg.payload = change;
      msg._trigger = { id: trigger.id, type: "watcher", watchPath, ts: new Date().toISOString() };
      runtime.send(trigger.id, msg as RuntimeMessage);
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
    if (!trigger.id) throw new Error("Trigger wajib punya id");
    if (trigger.enabled === false) continue;
    if (trigger.type === "interval") {
      stops.push(startIntervalTrigger(runtime, trigger));
      continue;
    }
    if (trigger.type === "watcher") {
      stops.push(startWatcherTrigger(runtime, trigger));
      continue;
    }
    throw new Error(`Trigger type "${String(trigger.type)}" tidak didukung`);
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
