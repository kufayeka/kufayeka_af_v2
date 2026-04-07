import Runtime from "../Runtime";
import type { ProgramRuntimeComposition } from "../composition/RuntimeComposition";
import type {
  EventActionBinding,
  RuntimeNodeHandler,
} from "../core/runtimeTypes";
import type {
  ProgramAction,
  ProgramEventAction,
  ProgramFlowNode,
  ProgramLink,
} from "./ProgramFlowContracts";

function createActionHandler(
  action: ProgramAction,
  composition: ProgramRuntimeComposition
): RuntimeNodeHandler {
  if (action.type === "script") {
    return composition.services.action.createScriptHandler(action as any, {
      templateById: composition.scriptTemplatesById as any,
      flowById: composition.flowDefinitionsById as any,
    });
  }
  throw new Error(`Unsupported action type "${action.type}"`);
}

function readNodeConfig(node: ProgramFlowNode): Record<string, unknown> {
  return node.config && typeof node.config === "object"
    ? (node.config as Record<string, unknown>)
    : {};
}

function buildNodeConfigById(nodes: ProgramFlowNode[]): Record<string, Record<string, unknown>> {
  const nodeConfigById: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    nodeConfigById[node.id] = readNodeConfig(node);
  }
  return nodeConfigById;
}

function validateUniqueNodeIds(nodes: ProgramFlowNode[]): void {
  const seenNodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id) throw new Error("Flow node must have an id");
    if (seenNodeIds.has(node.id)) {
      const flowId = String((node.config as Record<string, unknown> | undefined)?.__flowId || "").trim();
      throw new Error(`Duplicate flow node id "${node.id}" detected${flowId ? ` in flow "${flowId}"` : ""}`);
    }
    seenNodeIds.add(node.id);
  }
}

function registerDisabledNode(runtime: Runtime, node: ProgramFlowNode): void {
  runtime.addNode(node.id, async (_msg, _send) => {});
}

function registerTriggerNode(runtime: Runtime, node: ProgramFlowNode): void {
  runtime.addNode(node.id, async (msg, send) => {
    send(msg);
  });
}

function createScriptActionDefinition(node: ProgramFlowNode): ProgramAction {
  const config = readNodeConfig(node);
  return {
    id: node.id,
    type: "script",
    templateId: node.templateId,
    eventTemplateId: String(config.eventTemplateId || ""),
    eventTemplateOverrides:
      config.eventTemplateOverrides && typeof config.eventTemplateOverrides === "object"
        ? (config.eventTemplateOverrides as Record<string, unknown>)
        : {},
    script: String(config.script || ""),
    config,
    templateBindingOverrides:
      config.templateBindingOverrides && typeof config.templateBindingOverrides === "object"
        ? (config.templateBindingOverrides as Record<string, unknown>)
        : {},
  };
}

function registerScriptActionNode(
  runtime: Runtime,
  node: ProgramFlowNode,
  composition: ProgramRuntimeComposition
): void {
  const action = createScriptActionDefinition(node);
  const handler = createActionHandler(action, composition);
  runtime.addNode(node.id, handler);
}

function createEventActionDefinition(node: ProgramFlowNode): ProgramEventAction {
  const config = readNodeConfig(node);
  return {
    id: String(node.refId || node.id),
    enabled: true,
    label: node.label || "",
    description: String(config.description || ""),
    templateId: node.templateId || "",
    templateOverrides:
      config.templateOverrides && typeof config.templateOverrides === "object"
        ? (config.templateOverrides as Record<string, unknown>)
        : {},
    bindings:
      config.bindings && typeof config.bindings === "object"
        ? (config.bindings as Record<string, EventActionBinding>)
        : {},
    openNotes: String(config.openNotes || ""),
    closeNotes: String(config.closeNotes || ""),
  };
}

function registerEventActionNode(
  runtime: Runtime,
  node: ProgramFlowNode,
  composition: ProgramRuntimeComposition
): void {
  const action = createEventActionDefinition(node);
  const mode = node.kind === "event_open" ? "open" : "close";
  const handler = composition.services.action.createEventHandler(action, mode, {
    eventTemplateById: composition.eventTemplatesById,
  });
  runtime.addNode(node.id, handler);
}

function registerSingleFlowNode(
  runtime: Runtime,
  node: ProgramFlowNode,
  composition: ProgramRuntimeComposition
): void {
  if (node.enabled === false) {
    registerDisabledNode(runtime, node);
    return;
  }

  if (node.kind === "trigger") {
    registerTriggerNode(runtime, node);
    return;
  }

  if (node.kind === "action") {
    registerScriptActionNode(runtime, node, composition);
    return;
  }

  if (node.kind === "event_open" || node.kind === "event_close") {
    registerEventActionNode(runtime, node, composition);
    return;
  }

  registerDisabledNode(runtime, node);
}

export function registerFlowNodes(
  runtime: Runtime,
  nodes: unknown[] = [],
  composition: ProgramRuntimeComposition
): void {
  const typedNodes = nodes as ProgramFlowNode[];
  const nodeConfigById = buildNodeConfigById(typedNodes);
  validateUniqueNodeIds(typedNodes);

  for (const node of typedNodes) {
    registerSingleFlowNode(runtime, node, composition);
  }

  composition.flowNodeConfigById = nodeConfigById;
  runtime.setGlobal("flowNodeConfigById", nodeConfigById);
}

export function registerLinks(runtime: Runtime, links: unknown[] = []): void {
  for (const rawLink of links) {
    const link = rawLink as ProgramLink;
    if (!link.from || !link.to) throw new Error("Link must include both from and to");
    if (link.enabled === false) continue;
    runtime.wire(link.from, link.to, link.fromPort || "default");
  }
}
