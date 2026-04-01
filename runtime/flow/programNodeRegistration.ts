import Runtime from "../Runtime";
import { RuntimeServiceRegistry } from "../composition/RuntimeServiceRegistry";
import type {
  EventActionBinding,
  RuntimeNodeHandler,
} from "../types";
import type {
  ProgramAction,
  ProgramEventAction,
  ProgramFlowDefinition,
  ProgramFlowNode,
  ProgramLink,
} from "./programFlowTypes";

function createActionHandler(
  action: ProgramAction,
  context: Record<string, unknown> = {}
): RuntimeNodeHandler {
  const services = context.services as RuntimeServiceRegistry | undefined;
  if (action.type === "script" && services) {
    return services.action.createScriptHandler(action as any, context as any);
  }
  throw new Error(`Unsupported action type "${action.type}"`);
}

export function registerFlowNodes(runtime: Runtime, nodes: unknown[] = []): void {
  const services = runtime.getGlobal<RuntimeServiceRegistry | null>("serviceRegistry", null);
  const scriptTemplates = runtime.getGlobal("scriptTemplates", []);
  const templateById = new Map(
    (Array.isArray(scriptTemplates) ? scriptTemplates : []).map((template) => [
      String((template as { id?: unknown }).id || ""),
      template,
    ])
  );
  const eventTemplateList = runtime.getGlobal("eventTemplates", []);
  const eventTemplateById = new Map(
    (Array.isArray(eventTemplateList) ? eventTemplateList : []).map((template) => [
      String((template as { id?: unknown }).id || ""),
      template as any,
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
              : {},
        },
        { templateById, flowById: flowDefinitionsById as any, services }
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
        closeNotes: String(node.config?.closeNotes || ""),
      };
      if (!services) throw new Error("Runtime service registry is not available");
      runtime.addNode(
        node.id,
        services.action.createEventHandler(
          item,
          node.kind === "event_open" ? "open" : "close",
          { eventTemplateById }
        )
      );
      continue;
    }
    runtime.addNode(node.id, async (_msg, _send) => {});
  }
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
