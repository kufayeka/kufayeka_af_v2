const fs = require("node:fs");
const path = require("node:path");
const createScriptActionHandler = require("./createScriptActionHandler");
const { normalizeAssetSection } = require("./assetFramework");
const { ensureAssetStorage } = require("./assetStorage");
const { ensureEventStore } = require("./eventStore");

function loadProgramFromFile(programPath) {
  const absolutePath = path.resolve(programPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const data = JSON.parse(raw);
  return { absolutePath, program: data };
}

function createActionHandler(action, context = {}) {
  if (action.type === "script") {
    return createScriptActionHandler(action, context);
  }

  throw new Error(`Action type "${action.type}" tidak didukung`);
}

function registerActions(runtime, actions = []) {
  const scriptTemplates = runtime.getGlobal("scriptTemplates", []);
  const templateById = new Map(
    (Array.isArray(scriptTemplates) ? scriptTemplates : []).map((template) => [template.id, template])
  );

  for (const action of actions) {
    if (!action.id) {
      throw new Error("Action wajib punya id");
    }
    if (action.enabled === false) {
      runtime.addNode(action.id, async (_msg, _send) => {});
      continue;
    }
    const handler = createActionHandler(action, { templateById });
    runtime.addNode(action.id, handler);
  }
}

function registerLinks(runtime, links = []) {
  for (const link of links) {
    if (!link.from || !link.to) {
      throw new Error("Link wajib punya from dan to");
    }
    if (link.enabled === false) {
      continue;
    }
    runtime.wire(link.from, link.to);
  }
}

function startIntervalTrigger(runtime, trigger) {
  const intervalMs = Math.max(1, Number(trigger.intervalMs) || 1000);
  const baseMsg = trigger.message || {};
  const timer = setInterval(() => {
    const msg = structuredClone(baseMsg);
    msg._trigger = {
      id: trigger.id,
      type: "interval",
      ts: new Date().toISOString(),
    };
    runtime.send(trigger.id, msg);
  }, intervalMs);

  return () => clearInterval(timer);
}

function splitPath(path) {
  return String(path || "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matchWildcardPath(pattern, value) {
  const p = splitPath(pattern);
  const v = splitPath(value);
  if (p.length !== v.length) return false;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i] !== "*" && p[i] !== v[i]) return false;
  }
  return true;
}

function startWatcherTrigger(runtime, trigger) {
  const watchPath = String(trigger.watchPath || "").trim() || "*.*.*";
  const baseMsg = trigger.message || {};
  const store = runtime.getGlobal("assetStorage");
  if (!store || typeof store.subscribe !== "function") {
    throw new Error(`Trigger watcher "${trigger.id}" gagal: assetStorage belum tersedia`);
  }

  const unsubscribe = store.subscribe((_state, meta) => {
    const changes = Array.isArray(meta?.change?.changes) ? meta.change.changes : [];
    if (changes.length === 0) return;

    for (const change of changes) {
      if (!change || change.kind !== "attribute") continue;
      if (!matchWildcardPath(watchPath, change.path)) continue;
      const msg = structuredClone(baseMsg);
      msg.payload = change;
      msg._trigger = {
        id: trigger.id,
        type: "watcher",
        watchPath,
        ts: new Date().toISOString()
      };
      runtime.send(trigger.id, msg);
    }
  });

  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}

function startTriggers(runtime, triggers = []) {
  const stops = [];
  for (const trigger of triggers) {
    if (!trigger.id) {
      throw new Error("Trigger wajib punya id");
    }
    if (trigger.enabled === false) {
      continue;
    }

    if (trigger.type === "interval") {
      stops.push(startIntervalTrigger(runtime, trigger));
      continue;
    }

    if (trigger.type === "watcher") {
      stops.push(startWatcherTrigger(runtime, trigger));
      continue;
    }

    throw new Error(`Trigger type "${trigger.type}" tidak didukung`);
  }
  return stops;
}

function startProgram(runtime, program) {
  const assetStorage = ensureAssetStorage(runtime, normalizeAssetSection(program.assets || {}));
  ensureEventStore(runtime);
  assetStorage.replace(normalizeAssetSection(program.assets || {}));
  runtime.setGlobal("scriptTemplates", Array.isArray(program.scriptTemplates) ? program.scriptTemplates : []);
  registerActions(runtime, program.actions || []);
  registerLinks(runtime, (program.flows && program.flows.links) || []);
  const stops = startTriggers(runtime, program.triggers || []);

  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}

module.exports = {
  loadProgramFromFile,
  startProgram,
};
