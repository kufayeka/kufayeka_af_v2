import type {
  FlowDefinition,
  FlowLink,
  FlowVariableDefinition,
  Program,
  TriggerDefinition,
  TriggerTemplateType
} from "../../types/program";

export const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  activeFlowId: "flow_main",
  flowDefinitions: [
    {
      id: "flow_main",
      name: "Main Flow",
      description: "",
      enabled: true,
      variables: [],
      nodes: [],
      links: [],
      nodePositions: {}
    }
  ],
  eventTemplates: [],
  triggerTemplates: [],
  triggers: [],
  scriptTemplates: [],
  flows: {
    id: "flow_main",
    name: "Main Flow",
    enabled: true,
    variables: [],
    activeFlowId: "flow_main",
    nodes: [],
    links: [],
    nodePositions: {}
  },
  assets: { assets: [], attributeTemplates: [] }
};

export type TriggerTypeLike = TriggerDefinition["type"] | TriggerTemplateType;

export function makeRandomToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 4)}`;
}

export function getEventActionOpenNodeId(id: string): string {
  return `event.open.${id}`;
}

export function getEventActionCloseNodeId(id: string): string {
  return `event.close.${id}`;
}

export function getBaseEventActionIdFromNode(nodeId: string): string {
  return nodeId.startsWith("event.open.")
    ? nodeId.slice("event.open.".length)
    : nodeId.startsWith("event.close.")
      ? nodeId.slice("event.close.".length)
      : nodeId;
}

export function getNextIncrementalLabel(base: string, usedLabels: string[]): string {
  const normalizedBase = base.trim() || "Node";
  let index = 1;
  let candidate = `${normalizedBase} - ${index}`;
  const used = new Set(usedLabels.map((item) => item.trim().toLowerCase()).filter(Boolean));
  while (used.has(candidate.trim().toLowerCase())) {
    index += 1;
    candidate = `${normalizedBase} - ${index}`;
  }
  return candidate;
}

export function getTriggerBaseLabel(type: TriggerTypeLike): string {
  if (type === "interval") return "Interval Trigger";
  if (type === "watcher_set") return "Watcher Set";
  if (type === "watcher_valuechange") return "Watcher Value Change";
  if (type === "watcher_event_open") return "Watcher Event Open";
  if (type === "watcher_event_close") return "Watcher Event Close";
  if (type === "cron") return "Cron Trigger";
  return "Watcher Event Falling";
}

export function getActiveFlow(program: Program): FlowDefinition {
  const flowDefinitions = Array.isArray(program.flowDefinitions) ? program.flowDefinitions : [];
  const activeFlowId = String(program.activeFlowId ?? program.flows?.activeFlowId ?? "").trim();
  return (
    flowDefinitions.find((flow) => flow.id === activeFlowId) ||
    flowDefinitions[0] || {
      id: "flow_main",
      name: "Main Flow",
      description: "",
      enabled: true,
      variables: [],
      nodes: [],
      links: [],
      nodePositions: {}
    }
  );
}

export function hydrateActiveFlow(program: Program, requestedFlowId?: string): Program {
  const flowDefinitions = Array.isArray(program.flowDefinitions) ? program.flowDefinitions : [];
  const activeFlow =
    flowDefinitions.find((flow) => flow.id === requestedFlowId) ||
    flowDefinitions.find((flow) => flow.id === program.activeFlowId) ||
    flowDefinitions[0] || {
      id: "flow_main",
      name: "Main Flow",
      description: "",
      enabled: true,
      variables: [],
      nodes: [],
      links: [],
      nodePositions: {}
    };
  return {
    ...program,
    activeFlowId: activeFlow.id,
    flows: {
      id: activeFlow.id,
      name: activeFlow.name,
      description: activeFlow.description || "",
      enabled: activeFlow.enabled !== false,
      variables: Array.isArray(activeFlow.variables) ? structuredClone(activeFlow.variables) : [],
      activeFlowId: activeFlow.id,
      nodes: Array.isArray(activeFlow.nodes) ? structuredClone(activeFlow.nodes) : [],
      links: Array.isArray(activeFlow.links) ? structuredClone(activeFlow.links) : [],
      nodePositions: structuredClone(activeFlow.nodePositions || {})
    }
  };
}

export function updateActiveFlowInProgram(
  program: Program,
  updater: (flow: FlowDefinition) => FlowDefinition
): Program {
  const activeFlow = getActiveFlow(program);
  const nextFlow = updater(structuredClone(activeFlow));
  const nextFlowDefinitions = (program.flowDefinitions || []).map((flow) =>
    flow.id === activeFlow.id ? nextFlow : flow
  );
  return hydrateActiveFlow(
    {
      ...program,
      flowDefinitions: nextFlowDefinitions
    },
    nextFlow.id
  );
}

export function defaultFlowVariable(order: number): FlowVariableDefinition {
  return {
    name: `flowVar${order}`,
    order,
    description: "",
    source: "static_string",
    staticValue: "",
    attributePath: ""
  };
}

function isShortGeneratedId(value: string, prefix: string): boolean {
  return new RegExp(`^${prefix}_[a-z0-9]{8}$`, "i").test(String(value || ""));
}

function remapNodeIdInLinks(links: FlowLink[], fromId: string, toId: string): FlowLink[] {
  return links.map((link) => ({
    ...link,
    from: link.from === fromId ? toId : link.from,
    to: link.to === fromId ? toId : link.to
  }));
}

export function migrateProgramIdentity(program: Program): Program {
  let next = structuredClone(program);
  const triggerIdMap = new Map<string, { nextId: string; label: string }>();

  next.triggers = next.triggers.map((trigger, index) => {
    const nextId = isShortGeneratedId(trigger.id, "trg") ? trigger.id : makeRandomToken("trg");
    const nextLabel = trigger.label?.trim() || `${getTriggerBaseLabel(trigger.type)} - ${index + 1}`;
    triggerIdMap.set(trigger.id, { nextId, label: nextLabel });
    return {
      ...trigger,
      id: nextId,
      label: nextLabel
    };
  });

  const eventRefMap = new Map<string, string>();
  next.flowDefinitions = (next.flowDefinitions || []).map((flow) => {
    let nextLinks = [...(flow.links || [])];
    const nextPositions = { ...(flow.nodePositions || {}) };
    const nextNodes = (flow.nodes || []).map((node, index) => {
      if (node.kind === "trigger") {
        const mapped = triggerIdMap.get(node.id);
        if (!mapped) return node;
        nextLinks = remapNodeIdInLinks(nextLinks, node.id, mapped.nextId);
        if (nextPositions[node.id] && node.id !== mapped.nextId) {
          nextPositions[mapped.nextId] = nextPositions[node.id];
          delete nextPositions[node.id];
        }
        return {
          ...node,
          id: mapped.nextId,
          refId: mapped.nextId,
          label: node.label?.trim() || mapped.label || ""
        };
      }
      if (node.kind === "action") {
        const nextId = isShortGeneratedId(node.id, "act") ? node.id : makeRandomToken("act");
        if (nextId !== node.id) {
          nextLinks = remapNodeIdInLinks(nextLinks, node.id, nextId);
          if (nextPositions[node.id]) {
            nextPositions[nextId] = nextPositions[node.id];
            delete nextPositions[node.id];
          }
        }
        return {
          ...node,
          id: nextId,
          refId: nextId,
          label: node.label?.trim() || `Action - ${index + 1}`,
          config: {
            ...(node.config || {}),
            outputs: Array.isArray((node.config as Record<string, unknown> | undefined)?.outputs)
              ? (node.config as Record<string, unknown>).outputs
              : ["out"]
          }
        };
      }
      if (node.kind === "event_open" || node.kind === "event_close") {
        const currentRef = node.refId || node.id;
        const nextRef = eventRefMap.get(currentRef) || makeRandomToken("evt");
        eventRefMap.set(currentRef, nextRef);
        const nextId = node.kind === "event_open" ? getEventActionOpenNodeId(nextRef) : getEventActionCloseNodeId(nextRef);
        if (nextId !== node.id) {
          nextLinks = remapNodeIdInLinks(nextLinks, node.id, nextId);
          if (nextPositions[node.id]) {
            nextPositions[nextId] = nextPositions[node.id];
            delete nextPositions[node.id];
          }
        }
        return {
          ...node,
          id: nextId,
          refId: nextRef,
          label: node.label?.trim() || `Event - ${index + 1}`
        };
      }
      return node;
    });
    return {
      ...flow,
      nodes: nextNodes,
      links: nextLinks,
      nodePositions: nextPositions
    };
  });

  return hydrateActiveFlow(next, next.activeFlowId);
}
