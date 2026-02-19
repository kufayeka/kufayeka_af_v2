const TemplateRegistry = require("../templates/TemplateRegistry");
const registerBuiltinTemplates = require("../templates/registerBuiltinTemplates");
const { nodeDefinitions, wires } = require("./definitions");

function registerCustomTemplates(registry) {
  // Tempat define template custom buatan kamu sendiri.
  registry.define("logger", (config = {}) => {
    const label = config.label || "logger";
    return (msg, send) => {
      console.log(`[${label}]`, msg.payload);
      send(msg);
    };
  });
}

function registerNodes(runtime) {
  const registry = new TemplateRegistry();
  registerBuiltinTemplates(registry);
  registerCustomTemplates(registry);

  for (const nodeDef of nodeDefinitions) {
    if (nodeDef.handler) {
      runtime.addNode(nodeDef.id, nodeDef.handler);
      continue;
    }

    if (nodeDef.template) {
      const handler = registry.create(nodeDef.template, nodeDef.config || {});
      runtime.addNode(nodeDef.id, handler);
      continue;
    }

    throw new Error(
      `Node "${nodeDef.id}" harus punya handler atau template`
    );
  }
}

function registerWires(runtime) {
  for (const [from, to] of wires) {
    runtime.wire(from, to);
  }
}

module.exports = {
  registerNodes,
  registerWires,
};
