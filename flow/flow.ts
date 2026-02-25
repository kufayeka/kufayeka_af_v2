import Runtime from "../runtime/Runtime";
import TemplateRegistry from "../templates/TemplateRegistry";
import registerBuiltinTemplates from "../templates/registerBuiltinTemplates";
import { nodeDefinitions, wires } from "./definitions";

function registerCustomTemplates(registry: TemplateRegistry): void {
  registry.define("logger", (config = {}) => {
    const label = String(config.label || "logger");
    return (msg, send) => {
      console.log(`[${label}]`, msg.payload);
      send(msg);
    };
  });
}

export function registerNodes(runtime: Runtime): void {
  const registry = new TemplateRegistry();
  registerBuiltinTemplates(registry);
  registerCustomTemplates(registry);

  for (const nodeDef of nodeDefinitions) {
    if ("handler" in nodeDef) {
      runtime.addNode(nodeDef.id, nodeDef.handler);
      continue;
    }

    if ("template" in nodeDef) {
      const handler = registry.create(nodeDef.template, nodeDef.config || {});
      runtime.addNode(nodeDef.id, handler);
      continue;
    }
  }
}

export function registerWires(runtime: Runtime): void {
  for (const [from, to] of wires) {
    runtime.wire(from, to);
  }
}
