import type { MutableRefObject } from "react";
import type { FlowPaletteItem } from "../../components/managers/FlowManager";
import {
  getBaseEventActionIdFromNode,
  getEventActionCloseNodeId,
  getEventActionOpenNodeId,
  getNextIncrementalLabel,
  getTriggerBaseLabel,
  hydrateActiveFlow,
  makeRandomToken,
  updateActiveFlowInProgram
} from "../../domains/flow/model";
import type {
  FlowDefinition,
  FlowLink,
  FlowNodeDefinition,
  NodePosition,
  Program,
  TriggerTemplateDefinition
} from "../../types/program";
import type { EditorInspectorTarget } from "./workspaceTypes";

interface WorkspaceFlowHandlersArgs {
  program: Program;
  flowNodes: FlowNodeDefinition[];
  latestActionScriptsRef: MutableRefObject<Record<string, string>>;
  applyProgramUpdate: (updater: (program: Program) => Program) => void;
  applyProgramNoHistory: (updater: (program: Program) => Program) => void;
  applyActiveFlowUpdate: (updater: (flow: FlowDefinition) => FlowDefinition) => void;
  setSelectedFlowId: (value: string) => void;
  setSelectedActionId: (value: string) => void;
  setSelectedEventActionId: (value: string) => void;
  setSelectedTriggerTemplateId: (value: string) => void;
  setInspectorTarget: (value: EditorInspectorTarget | null) => void;
  setStatus: (message: string) => void;
  setTab: (value: number) => void;
}

export function createWorkspaceFlowHandlers({
  program,
  flowNodes,
  latestActionScriptsRef,
  applyProgramUpdate,
  applyProgramNoHistory,
  applyActiveFlowUpdate,
  setSelectedFlowId,
  setSelectedActionId,
  setSelectedEventActionId,
  setSelectedTriggerTemplateId,
  setInspectorTarget,
  setStatus,
  setTab
}: WorkspaceFlowHandlersArgs) {
  const switchActiveFlow = (flowId: string) => {
    const nextFlow = (program.flowDefinitions || []).find((flow) => flow.id === flowId);
    setSelectedFlowId(flowId);
    applyProgramNoHistory((prev) => hydrateActiveFlow(prev, flowId));
    setInspectorTarget(null);
    setSelectedActionId((nextFlow?.nodes || []).find((node) => node.kind === "action")?.id ?? "");
    setSelectedEventActionId((nextFlow?.nodes || []).find((node) => node.kind === "event_open")?.refId ?? "");
  };

  const addFlowDefinition = (): void => {
    const nextId = makeRandomToken("flow");
    applyProgramUpdate((prev) => {
      const nextFlow: FlowDefinition = {
        id: nextId,
        name: getNextIncrementalLabel("Flow", (prev.flowDefinitions || []).map((item) => item.name || "")),
        description: "",
        enabled: true,
        variables: [],
        nodes: [],
        links: [],
        nodePositions: {}
      };
      return hydrateActiveFlow(
        {
          ...prev,
          activeFlowId: nextId,
          flowDefinitions: [...(prev.flowDefinitions || []), nextFlow]
        },
        nextId
      );
    });
    setSelectedFlowId(nextId);
  };

  const duplicateFlowDefinition = (flowId: string): void => {
    const nextId = makeRandomToken("flow");
    applyProgramUpdate((prev) => {
      const source = (prev.flowDefinitions || []).find((item) => item.id === flowId);
      if (!source) return prev;
      const remap = new Map<string, string>();
      const nextNodes = (source.nodes || []).map((node) => {
        if (node.kind === "trigger") {
          const nextNodeId = makeRandomToken("trg");
          remap.set(node.id, nextNodeId);
          return { ...structuredClone(node), id: nextNodeId, refId: nextNodeId, label: node.label || "" };
        }
        if (node.kind === "action") {
          const nextNodeId = makeRandomToken("act");
          remap.set(node.id, nextNodeId);
          latestActionScriptsRef.current[nextNodeId] = String(((node.config || {}) as Record<string, unknown>).script || "");
          return { ...structuredClone(node), id: nextNodeId, refId: nextNodeId, label: node.label || "" };
        }
        const nextRef = makeRandomToken("evt");
        const nextNodeId = node.kind === "event_open" ? getEventActionOpenNodeId(nextRef) : getEventActionCloseNodeId(nextRef);
        remap.set(node.id, nextNodeId);
        return { ...structuredClone(node), id: nextNodeId, refId: nextRef };
      });
      const nextPositions = Object.fromEntries(
        Object.entries(source.nodePositions || {}).map(([nodeId, pos]) => [
          remap.get(nodeId) || nodeId,
          { x: pos.x + 80, y: pos.y + 80 }
        ])
      );
      const nextLinks = (source.links || []).map((link) => ({
        ...structuredClone(link),
        from: remap.get(link.from) || link.from,
        to: remap.get(link.to) || link.to
      }));
      const nextFlow: FlowDefinition = {
        ...structuredClone(source),
        id: nextId,
        name: getNextIncrementalLabel(source.name || "Flow", (prev.flowDefinitions || []).map((item) => item.name || "")),
        nodes: nextNodes,
        links: nextLinks,
        nodePositions: nextPositions
      };
      return hydrateActiveFlow(
        {
          ...prev,
          activeFlowId: nextId,
          flowDefinitions: [...(prev.flowDefinitions || []), nextFlow]
        },
        nextId
      );
    });
    setSelectedFlowId(nextId);
  };

  const removeFlowDefinition = (flowId: string): void => {
    applyProgramUpdate((prev) => {
      const allFlows = prev.flowDefinitions || [];
      if (allFlows.length <= 1) return prev;
      const remaining = allFlows.filter((flow) => flow.id !== flowId);
      const nextActiveId = prev.activeFlowId === flowId ? remaining[0]?.id || "flow_main" : prev.activeFlowId;
      return hydrateActiveFlow(
        {
          ...prev,
          activeFlowId: nextActiveId,
          flowDefinitions: remaining
        },
        nextActiveId
      );
    });
  };

  const updateFlowDefinition = (flowId: string, patch: Partial<FlowDefinition>): void => {
    applyProgramUpdate((prev) => {
      const nextFlowDefinitions = (prev.flowDefinitions || []).map((flow) =>
        flow.id === flowId
          ? {
              ...flow,
              ...patch,
              variables: Array.isArray(patch.variables) ? patch.variables : flow.variables
            }
          : flow
      );
      return hydrateActiveFlow(
        {
          ...prev,
          flowDefinitions: nextFlowDefinitions
        },
        flowId
      );
    });
  };

  const createTriggerNodeFromTemplateInFlow = (templateId: string, position: NodePosition): void => {
    const template = (program.triggerTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    const id = makeRandomToken("trg");
    const label = getNextIncrementalLabel(
      template.name || getTriggerBaseLabel(template.type),
      flowNodes.filter((item) => item.kind === "trigger").map((item) => item.label || "")
    );
    const nextNode: FlowNodeDefinition = {
      id,
      label,
      subtitle: template.name || label,
      kind: "trigger",
      refId: id,
      enabled: true,
      templateId: template.id,
      config: {
        description: template.description || "",
        type: template.type,
        watchPath: template.watchPath || "",
        intervalMs: template.intervalMs,
        activeFrom: template.activeFrom || "",
        activeTo: template.activeTo || "",
        message: structuredClone(template.message || { payload: 0 })
      }
    };
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), nextNode],
      nodePositions: { ...(flow.nodePositions || {}), [id]: position }
    }));
    setSelectedTriggerTemplateId(template.id);
    setTab(1);
    setStatus(`Trigger node created from template "${template.name}"`);
  };

  const createBuiltInTriggerNodeInFlow = (
    triggerType: "interval" | "watcher_set" | "watcher_valuechange" | "watcher_event_open" | "watcher_event_close",
    position: NodePosition
  ): void => {
    const id = makeRandomToken("trg");
    const defaultWatchPath =
      triggerType === "watcher_set" || triggerType === "watcher_valuechange"
        ? "*.*.*"
        : triggerType === "watcher_event_open" || triggerType === "watcher_event_close"
          ? "*"
          : "";
    const label = getNextIncrementalLabel(
      getTriggerBaseLabel(triggerType),
      flowNodes.filter((item) => item.kind === "trigger").map((item) => item.label || "")
    );
    const nextNode: FlowNodeDefinition = {
      id,
      label,
      subtitle: getTriggerBaseLabel(triggerType),
      kind: "trigger",
      refId: id,
      enabled: true,
      templateId: "",
      config: {
        description: "",
        type: triggerType,
        watchPath: defaultWatchPath,
        intervalMs: 1000,
        activeFrom: "",
        activeTo: "",
        message: { payload: 0 }
      }
    };
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), nextNode],
      nodePositions: { ...(flow.nodePositions || {}), [id]: position }
    }));
    setStatus(`Trigger node created: ${label}`);
  };

  const createBuiltInDebugActionInFlow = (position: NodePosition): void => {
    const id = makeRandomToken("act");
    const label = getNextIncrementalLabel(
      "Debug",
      flowNodes.filter((item) => item.kind === "action").map((item) => item.label || "")
    );
    const nextNode: FlowNodeDefinition = {
      id,
      label,
      subtitle: "Built-in Debug",
      kind: "action",
      refId: id,
      enabled: true,
      templateId: "",
      config: {
        description: "Built-in debug action",
        script: "helpers.log(msg);\nsend(msg);",
        outputs: ["out"],
        templateBindingOverrides: {},
        eventTemplateId: "",
        eventTemplateOverrides: {}
      }
    };
    latestActionScriptsRef.current[id] = String((nextNode.config as Record<string, unknown>).script || "");
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), nextNode],
      nodePositions: { ...(flow.nodePositions || {}), [id]: position }
    }));
    setSelectedActionId(id);
    setInspectorTarget({ kind: "action", id });
    setStatus(`Action node created: ${label}`);
  };

  const addLink = (link: FlowLink): void => {
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: [...(flow.links || []), link]
    }));
  };

  const updateLink = (index: number, patch: Partial<FlowLink>): void => {
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: (flow.links || []).map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    }));
  };

  const removeLink = (index: number): void => {
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: (flow.links || []).filter((_item, itemIndex) => itemIndex !== index)
    }));
  };

  const updateNodePosition = (nodeId: string, position: { x: number; y: number }): void => {
    applyProgramNoHistory((prev) =>
      updateActiveFlowInProgram(prev, (flow) => ({
        ...flow,
        nodePositions: { ...(flow.nodePositions || {}), [nodeId]: position }
      }))
    );
  };

  const removeNodeFromFlow = (nodeId: string): void => {
    applyProgramUpdate((prev) => {
      const nextPositions = { ...(prev.flows.nodePositions || {}) };
      delete nextPositions[nodeId];
      return updateActiveFlowInProgram(prev, (flow) => ({
        ...flow,
        nodes: (flow.nodes || []).filter((item) => item.id !== nodeId),
        links: flow.links.filter((link) => link.from !== nodeId && link.to !== nodeId),
        nodePositions: nextPositions
      }));
    });
  };

  const duplicateNodesInFlow = (nodeIds: string[], basePosition?: NodePosition): void => {
    const uniqueIds = Array.from(new Set(nodeIds));
    if (uniqueIds.length === 0) return;
    const nextNodes: FlowNodeDefinition[] = [];
    const nextPositions: Record<string, NodePosition> = {};
    const duplicatedNodeMap = new Map<string, string>();
    let actionCount = 0;
    let eventCount = 0;
    let triggerCount = 0;
    const nodesById = new Map((program.flows.nodes || []).map((node) => [node.id, node] as const));

    uniqueIds.forEach((nodeId, index) => {
      const offset = 40 * (index + 1);
      const action = nodesById.get(nodeId);
      if (action?.kind === "action") {
        const nextId = makeRandomToken("act");
        const position = program.flows.nodePositions?.[nodeId];
        nextNodes.push({
          ...structuredClone(action),
          id: nextId,
          refId: nextId,
          label: getNextIncrementalLabel(action.label || "Action", flowNodes.map((item) => item.label || ""))
        });
        duplicatedNodeMap.set(nodeId, nextId);
        latestActionScriptsRef.current[nextId] = String(((action.config || {}) as Record<string, unknown>).script || "");
        if (basePosition) nextPositions[nextId] = { x: basePosition.x + offset, y: basePosition.y + offset };
        else if (position) nextPositions[nextId] = { x: position.x + offset, y: position.y + offset };
        actionCount += 1;
        return;
      }

      if (action?.kind === "trigger") {
        const nextId = makeRandomToken("trg");
        const position = program.flows.nodePositions?.[nodeId];
        nextNodes.push({
          ...structuredClone(action),
          id: nextId,
          refId: nextId,
          label: getNextIncrementalLabel(action.label || "Trigger", flowNodes.map((item) => item.label || ""))
        });
        duplicatedNodeMap.set(nodeId, nextId);
        if (basePosition) nextPositions[nextId] = { x: basePosition.x + offset, y: basePosition.y + offset };
        else if (position) nextPositions[nextId] = { x: position.x + offset, y: position.y + offset };
        triggerCount += 1;
        return;
      }

      if (action?.kind === "event_open" || action?.kind === "event_close") {
        const nextRefId = makeRandomToken("evt");
        const nextId = action.kind === "event_open" ? getEventActionOpenNodeId(nextRefId) : getEventActionCloseNodeId(nextRefId);
        const position = program.flows.nodePositions?.[nodeId];
        nextNodes.push({
          ...structuredClone(action),
          id: nextId,
          refId: nextRefId,
          label: getNextIncrementalLabel(action.label || (action.kind === "event_open" ? "Open Event" : "Close Event"), flowNodes.map((item) => item.label || ""))
        });
        duplicatedNodeMap.set(nodeId, nextId);
        if (basePosition) nextPositions[nextId] = { x: basePosition.x + offset, y: basePosition.y + offset };
        else if (position) nextPositions[nextId] = { x: position.x + offset, y: position.y + offset };
        eventCount += 1;
      }
    });

    if (nextNodes.length === 0) {
      setStatus("No nodes available to paste.");
      return;
    }

    applyProgramUpdate((prev) =>
      updateActiveFlowInProgram(prev, (flow) => ({
        ...flow,
        nodes: [...(flow.nodes || []), ...nextNodes],
        links: [
          ...flow.links,
          ...flow.links
            .filter((link) => duplicatedNodeMap.has(link.from) && duplicatedNodeMap.has(link.to))
            .map((link) => ({
              ...link,
              from: duplicatedNodeMap.get(link.from) || link.from,
              to: duplicatedNodeMap.get(link.to) || link.to
            }))
        ],
        nodePositions: {
          ...(flow.nodePositions || {}),
          ...nextPositions
        }
      }))
    );
    setStatus(`Pasted ${triggerCount} trigger node(s), ${actionCount} script node(s), and ${eventCount} event node(s)`);
  };

  const handleDropPaletteItem = (
    item: FlowPaletteItem,
    position: NodePosition,
    createActionFromTemplateInFlow: (templateId: string, position: NodePosition) => void,
    createEventNodeFromTemplateInFlow: (templateId: string, kind: "event_open" | "event_close", position: NodePosition) => void
  ): void => {
    if (item.type === "existing-node") {
      updateNodePosition(item.nodeId, position);
      return;
    }
    if (item.type === "builtin-trigger") {
      createBuiltInTriggerNodeInFlow(item.triggerType, position);
      return;
    }
    if (item.type === "builtin-action") {
      createBuiltInDebugActionInFlow(position);
      return;
    }
    if (item.type === "script-template") {
      createActionFromTemplateInFlow(item.templateId, position);
      return;
    }
    if (item.type === "event-template-open") {
      createEventNodeFromTemplateInFlow(item.templateId, "event_open", position);
      return;
    }
    if (item.type === "event-template-close") {
      createEventNodeFromTemplateInFlow(item.templateId, "event_close", position);
    }
  };

  return {
    addFlowDefinition,
    addLink,
    createBuiltInDebugActionInFlow,
    createBuiltInTriggerNodeInFlow,
    createTriggerNodeFromTemplateInFlow,
    duplicateFlowDefinition,
    duplicateNodesInFlow,
    handleDropPaletteItem,
    removeFlowDefinition,
    removeLink,
    removeNodeFromFlow,
    switchActiveFlow,
    updateFlowDefinition,
    updateLink,
    updateNodePosition
  };
}
