const fs = require("node:fs");
const path = require("node:path");
const createScriptActionHandler = require("./createScriptActionHandler");
const { normalizeAssetSection } = require("./assetFramework");
const { ensureAssetStorage } = require("./assetStorage");

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

    throw new Error(`Trigger type "${trigger.type}" tidak didukung`);
  }
  return stops;
}

function startProgram(runtime, program) {
  const assetStorage = ensureAssetStorage(runtime, normalizeAssetSection(program.assets || {}));
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
