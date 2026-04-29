import type { MutableRefObject } from "react";
import { buildEventActionBindingsFromTemplate } from "../../domains/event/model";
import {
  getEventActionCloseNodeId,
  getEventActionOpenNodeId,
  getNextIncrementalLabel,
  hydrateActiveFlow,
  makeRandomToken
} from "../../domains/flow/model";
import {
  removeNodeFromLinks,
  renameNodeInLinks,
  renameNodePositionKey,
  renderEventTemplatePathBuilder,
  upsertById
} from "../../lib/programUtils";
import type {
  EventNodeSummary,
  EventTemplateDefinition,
  FlowDefinition,
  FlowNodeDefinition,
  NodePosition,
  Program,
  ScriptNodeSummary,
  ScriptTemplateDefinition,
  TriggerTemplateDefinition
} from "../../types/program";
import type { EditorInspectorTarget } from "./workspaceTypes";

interface WorkspaceEntityHandlersArgs {
  program: Program;
  flowNodes: FlowNodeDefinition[];
  latestActionScriptsRef: MutableRefObject<Record<string, string>>;
  inspectorTarget: EditorInspectorTarget | null;
  selectedActionId: string;
  selectedEventActionId: string;
  selectedEventTemplateId: string;
  selectedTriggerTemplateId: string;
  applyProgramUpdate: (updater: (program: Program) => Program) => void;
  applyActiveFlowUpdate: (updater: (flow: FlowDefinition) => FlowDefinition) => void;
  setInspectorTarget: (target: EditorInspectorTarget | null) => void;
  setSelectedActionId: (id: string) => void;
  setSelectedEventActionId: (id: string) => void;
  setSelectedEventTemplateId: (id: string) => void;
  setSelectedTriggerTemplateId: (id: string) => void;
  setStatus: (message: string) => void;
}

export function createWorkspaceEntityHandlers({
  program,
  flowNodes,
  latestActionScriptsRef,
  inspectorTarget,
  selectedActionId,
  selectedEventActionId,
  selectedEventTemplateId,
  selectedTriggerTemplateId,
  applyProgramUpdate,
  applyActiveFlowUpdate,
  setInspectorTarget,
  setSelectedActionId,
  setSelectedEventActionId,
  setSelectedEventTemplateId,
  setSelectedTriggerTemplateId,
  setStatus
}: WorkspaceEntityHandlersArgs) {
  const addAction = (_parentPath?: string): void => {
    const id = makeRandomToken("act");
    const label = getNextIncrementalLabel(
      "Action",
      flowNodes.filter((item) => item.kind === "action").map((item) => item.label || "")
    );
    const nextNode: FlowNodeDefinition = {
      id,
      label,
      kind: "action",
      refId: id,
      enabled: true,
      templateId: "",
      config: {
        description: "",
        script: "send(msg);",
        outputs: ["out"],
        templateBindingOverrides: {},
        eventTemplateId: "",
        eventTemplateOverrides: {}
      }
    };
    latestActionScriptsRef.current[id] = "send(msg);";
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), nextNode]
    }));
    setSelectedActionId(id);
  };

  const createActionFromTemplateInFlow = (templateId: string, position: NodePosition): void => {
    const template = program.scriptTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const id = makeRandomToken("act");
    const label = getNextIncrementalLabel(
      template.name || "Action",
      flowNodes.filter((item) => item.kind === "action").map((item) => item.label || "")
    );
    const nextNode: FlowNodeDefinition = {
      id,
      label,
      subtitle: template.name || label,
      kind: "action",
      refId: id,
      enabled: true,
      templateId: template.id,
      config: {
        description: template.description || "",
        script: template.script || "send(msg);",
        outputs:
          Array.isArray(template.outputs) && template.outputs.length > 0
            ? template.outputs.slice().sort((a, b) => a.order - b.order).map((item) => item.name)
            : ["out"],
        templateBindingOverrides: {}
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
    setStatus(`Script node created from template "${template.name}"`);
  };

  const addEventAction = (): void => {
    const id = makeRandomToken("evt");
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    const openLabel = getNextIncrementalLabel(
      "Open Event",
      flowNodes.filter((item) => item.kind === "event_open").map((item) => item.label || "")
    );
    const closeLabel = getNextIncrementalLabel(
      "Close Event",
      flowNodes.filter((item) => item.kind === "event_close").map((item) => item.label || "")
    );
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [
        ...(flow.nodes || []),
        {
          id: openNodeId,
          label: openLabel,
          kind: "event_open",
          refId: id,
          enabled: true,
          templateId: "",
          config: { description: "", bindings: {}, templateOverrides: {}, openNotes: "" }
        },
        {
          id: closeNodeId,
          label: closeLabel,
          kind: "event_close",
          refId: id,
          enabled: true,
          templateId: "",
          config: { description: "", bindings: {}, templateOverrides: {}, closeNotes: "" }
        }
      ]
    }));
    setSelectedEventActionId(id);
  };

  const duplicateEventAction = (id: string): void => {
    const sourceOpen = flowNodes.find((item) => item.kind === "event_open" && item.refId === id);
    const sourceClose = flowNodes.find((item) => item.kind === "event_close" && item.refId === id);
    if (!sourceOpen || !sourceClose) return;
    const segments = id.split(".").filter(Boolean);
    const leaf = segments.length > 0 ? segments[segments.length - 1] : id;
    const baseParent = segments.slice(0, -1).join(".");
    const copyLeaf = `${leaf}_copy`;
    let candidateId = baseParent ? `${baseParent}.${copyLeaf}` : copyLeaf;
    let seq = 2;
    const idSet = new Set(
      flowNodes.filter((item) => item.kind === "event_open" || item.kind === "event_close").map((item) => item.refId)
    );
    while (idSet.has(candidateId)) {
      candidateId = baseParent ? `${baseParent}.${copyLeaf}_${seq}` : `${copyLeaf}_${seq}`;
      seq += 1;
    }

    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [
        ...(flow.nodes || []),
        {
          ...structuredClone(sourceOpen),
          id: getEventActionOpenNodeId(candidateId),
          refId: candidateId,
          label: sourceOpen.label ? `${sourceOpen.label} (Copy)` : ""
        },
        {
          ...structuredClone(sourceClose),
          id: getEventActionCloseNodeId(candidateId),
          refId: candidateId,
          label: sourceClose.label ? `${sourceClose.label} (Copy)` : ""
        }
      ]
    }));
    setSelectedEventActionId(candidateId);
    setStatus(`Event action duplicated: ${candidateId}`);
  };

  const addEventActionFromTemplate = (templateId: string): void => {
    const template = (program.eventTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    const id = makeRandomToken("evt");
    const bindings = buildEventActionBindingsFromTemplate(template);
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [
        ...(flow.nodes || []),
        {
          id: openNodeId,
          label: getNextIncrementalLabel(template.id, flowNodes.map((item) => item.label || "")),
          subtitle: template.id,
          kind: "event_open",
          refId: id,
          enabled: true,
          templateId: template.id,
          config: {
            description: `Event action for template ${template.id}`,
            bindings,
            templateOverrides: {},
            openNotes: ""
          }
        },
        {
          id: closeNodeId,
          label: getNextIncrementalLabel(template.id, flowNodes.map((item) => item.label || "")),
          subtitle: template.id,
          kind: "event_close",
          refId: id,
          enabled: true,
          templateId: template.id,
          config: {
            description: `Event action for template ${template.id}`,
            bindings,
            templateOverrides: {},
            closeNotes: ""
          }
        }
      ]
    }));
    setSelectedEventActionId(id);
  };

  const createEventNodeFromTemplateInFlow = (
    templateId: string,
    eventKind: "event_open" | "event_close",
    position: NodePosition
  ): void => {
    const template = (program.eventTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    const id = makeRandomToken("evt");
    const bindings = buildEventActionBindingsFromTemplate(template);
    const nodeId = eventKind === "event_open" ? getEventActionOpenNodeId(id) : getEventActionCloseNodeId(id);
    const nextNode: FlowNodeDefinition = {
      id: nodeId,
      kind: eventKind,
      refId: id,
      label: getNextIncrementalLabel(template.id, flowNodes.map((item) => item.label || "")),
      subtitle: template.id,
      enabled: true,
      templateId: template.id,
      config: {
        description: `Event node for template ${template.id}`,
        bindings,
        templateOverrides: {},
        ...(eventKind === "event_open" ? { openNotes: "" } : { closeNotes: "" })
      }
    };
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), nextNode],
      nodePositions: {
        ...(flow.nodePositions || {}),
        [nodeId]: position
      }
    }));
    setSelectedEventActionId(id);
    setInspectorTarget({ kind: "event", id });
    setStatus(`${eventKind === "event_open" ? "Open" : "Close"} event node created from template "${template.id}"`);
  };

  const duplicateAction = (id: string): void => {
    const source = flowNodes.find((item) => item.kind === "action" && item.id === id);
    if (!source) return;

    const segments = source.id.split(".").filter(Boolean);
    const leaf = segments.length > 0 ? segments[segments.length - 1] : source.id;
    const baseParent = segments.slice(0, -1).join(".");
    const copyLeaf = `${leaf}_copy`;
    let candidateId = baseParent ? `${baseParent}.${copyLeaf}` : copyLeaf;
    let seq = 2;
    const idSet = new Set(flowNodes.filter((item) => item.kind === "action").map((item) => item.id));
    while (idSet.has(candidateId)) {
      candidateId = baseParent ? `${baseParent}.${copyLeaf}_${seq}` : `${copyLeaf}_${seq}`;
      seq += 1;
    }

    const next: FlowNodeDefinition = {
      ...structuredClone(source),
      id: candidateId,
      refId: candidateId,
      label: source.label ? `${source.label} (Copy)` : ""
    };
    latestActionScriptsRef.current[candidateId] = String(((next.config || {}) as Record<string, unknown>).script || "");

    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: [...(flow.nodes || []), next]
    }));
    setSelectedActionId(candidateId);
    setStatus(`Action duplicated: ${candidateId}`);
  };

  const removeTriggerTemplate = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggerTemplates: (prev.triggerTemplates || []).filter((item) => item.id !== id)
    }));
    if (selectedTriggerTemplateId === id) {
      setSelectedTriggerTemplateId((program.triggerTemplates || []).find((item) => item.id !== id)?.id || "");
    }
  };

  const removeAction = (id: string): void => {
    delete latestActionScriptsRef.current[id];
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).filter((item) => item.id !== id),
      links: removeNodeFromLinks(flow.links, id),
      nodePositions: (() => {
        const next = { ...(flow.nodePositions || {}) };
        delete next[id];
        return next;
      })()
    }));
    if (selectedActionId === id) setSelectedActionId("");
    if (inspectorTarget?.kind === "action" && inspectorTarget.id === id) setInspectorTarget(null);
  };

  const removeEventAction = (id: string): void => {
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).filter((item) => item.refId !== id),
      links: removeNodeFromLinks(removeNodeFromLinks(flow.links, openNodeId), closeNodeId),
      nodePositions: (() => {
        const next = { ...(flow.nodePositions || {}) };
        delete next[openNodeId];
        delete next[closeNodeId];
        return next;
      })()
    }));
    if (selectedEventActionId === id) setSelectedEventActionId("");
    if (inspectorTarget?.kind === "event" && inspectorTarget.id === id) setInspectorTarget(null);
  };

  const renameAction = (oldId: string, newId: string): void => {
    if (oldId !== newId) {
      const value = latestActionScriptsRef.current[oldId];
      delete latestActionScriptsRef.current[oldId];
      if (value !== undefined) latestActionScriptsRef.current[newId] = value;
    }
    setSelectedActionId(newId);
    if (inspectorTarget?.kind === "action" && inspectorTarget.id === oldId) {
      setInspectorTarget({ kind: "action", id: newId });
    }
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).map((node) =>
        node.id === oldId ? { ...node, id: newId, refId: newId } : node
      ),
      links: renameNodeInLinks(flow.links, oldId, newId),
      nodePositions: renameNodePositionKey(flow.nodePositions, oldId, newId)
    }));
  };

  const renameEventAction = (oldId: string, newId: string): void => {
    const normalizedNewId = newId.trim();
    if (!normalizedNewId) return;
    if (
      oldId !== normalizedNewId &&
      flowNodes.some(
        (item) => (item.kind === "event_open" || item.kind === "event_close") && item.refId === normalizedNewId
      )
    ) {
      setStatus(`Duplicate blocked: event action id "${normalizedNewId}" already exists`);
      return;
    }
    const oldOpen = getEventActionOpenNodeId(oldId);
    const oldClose = getEventActionCloseNodeId(oldId);
    const nextOpen = getEventActionOpenNodeId(normalizedNewId);
    const nextClose = getEventActionCloseNodeId(normalizedNewId);
    setSelectedEventActionId(normalizedNewId);
    if (inspectorTarget?.kind === "event" && inspectorTarget.id === oldId) {
      setInspectorTarget({ kind: "event", id: normalizedNewId });
    }
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).map((node) => {
        if (node.refId !== oldId) return node;
        return {
          ...node,
          id: node.kind === "event_open" ? nextOpen : nextClose,
          refId: normalizedNewId
        };
      }),
      links: renameNodeInLinks(renameNodeInLinks(flow.links, oldOpen, nextOpen), oldClose, nextClose),
      nodePositions: renameNodePositionKey(
        renameNodePositionKey(flow.nodePositions, oldOpen, nextOpen),
        oldClose,
        nextClose
      )
    }));
  };

  const updateTriggerTemplate = (id: string, patch: Partial<TriggerTemplateDefinition>): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggerTemplates: upsertById(prev.triggerTemplates || [], id, patch)
    }));
  };

  const updateAction = (id: string, patch: Partial<ScriptNodeSummary>): void => {
    const current = flowNodes.find((item) => item.kind === "action" && item.id === id);
    if (!current) return;
    if (typeof patch.script === "string") {
      latestActionScriptsRef.current[id] = patch.script;
    }
    const resolvedPatch: Partial<ScriptNodeSummary> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "templateId")) {
      const nextTemplateId = patch.templateId;
      const template = nextTemplateId ? program.scriptTemplates.find((item) => item.id === nextTemplateId) : null;
      const currentConfig = (current.config || {}) as Record<string, unknown>;
      resolvedPatch.script = template ? template.script : patch.script ?? String(currentConfig.script ?? "");
      const templateOutputs =
        template?.outputs && template.outputs.length > 0
          ? template.outputs.slice().sort((a, b) => a.order - b.order).map((item) => item.name)
          : ["out"];
      resolvedPatch.templateBindingOverrides =
        nextTemplateId ? (((currentConfig.templateBindingOverrides as Record<string, unknown>) || {}) as any) : {};
      (resolvedPatch as Partial<ScriptNodeSummary> & { outputs?: string[] }).outputs = templateOutputs;
      latestActionScriptsRef.current[id] = String(resolvedPatch.script ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "eventTemplateId")) {
      const nextEventTemplateId = patch.eventTemplateId;
      const currentConfig = (current.config || {}) as Record<string, unknown>;
      resolvedPatch.eventTemplateOverrides =
        nextEventTemplateId ? (((currentConfig.eventTemplateOverrides as Record<string, unknown>) || {}) as any) : {};
    }
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).map((node) =>
        node.id === id && node.kind === "action"
          ? {
              ...node,
              label: Object.prototype.hasOwnProperty.call(resolvedPatch, "label") ? resolvedPatch.label ?? "" : node.label,
              enabled: Object.prototype.hasOwnProperty.call(resolvedPatch, "enabled") ? resolvedPatch.enabled !== false : node.enabled,
              templateId:
                Object.prototype.hasOwnProperty.call(resolvedPatch, "templateId")
                  ? resolvedPatch.templateId ?? ""
                  : node.templateId,
              config: {
                ...(node.config || {}),
                ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "description")
                  ? { description: resolvedPatch.description ?? "" }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "script")
                  ? { script: resolvedPatch.script ?? "send(msg);" }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "templateBindingOverrides")
                  ? { templateBindingOverrides: resolvedPatch.templateBindingOverrides || {} }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "eventTemplateId")
                  ? { eventTemplateId: resolvedPatch.eventTemplateId ?? "" }
                  : {}),
                ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "eventTemplateOverrides")
                  ? { eventTemplateOverrides: resolvedPatch.eventTemplateOverrides || {} }
                  : {}),
                ...(((resolvedPatch as Partial<ScriptNodeSummary> & { outputs?: string[] }).outputs)
                  ? { outputs: (resolvedPatch as Partial<ScriptNodeSummary> & { outputs?: string[] }).outputs || ["out"] }
                  : {})
              }
            }
          : node
      )
    }));
  };

  const updateEventAction = (id: string, patch: Partial<EventNodeSummary>): void => {
    const currentOpen = flowNodes.find((item) => item.kind === "event_open" && item.refId === id);
    const currentClose = flowNodes.find((item) => item.kind === "event_close" && item.refId === id);
    if (!currentOpen && !currentClose) return;
    const resolvedPatch: Partial<EventNodeSummary> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "templateId")) {
      const template = patch.templateId ? (program.eventTemplates || []).find((item) => item.id === patch.templateId) : null;
      resolvedPatch.bindings = template ? buildEventActionBindingsFromTemplate(template) : {};
    }
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      nodes: (flow.nodes || []).map((node) => {
        if (node.refId !== id || (node.kind !== "event_open" && node.kind !== "event_close")) return node;
        const isOpen = node.kind === "event_open";
        return {
          ...node,
          label: Object.prototype.hasOwnProperty.call(resolvedPatch, "label")
            ? String(resolvedPatch.label ?? "")
            : node.label,
          enabled: Object.prototype.hasOwnProperty.call(resolvedPatch, "enabled") ? resolvedPatch.enabled !== false : node.enabled,
          templateId:
            Object.prototype.hasOwnProperty.call(resolvedPatch, "templateId")
              ? resolvedPatch.templateId ?? ""
              : node.templateId,
          config: {
            ...(node.config || {}),
            ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "description")
              ? { description: resolvedPatch.description ?? "" }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "templateOverrides")
              ? { templateOverrides: resolvedPatch.templateOverrides || {} }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(resolvedPatch, "bindings")
              ? { bindings: resolvedPatch.bindings || {} }
              : {}),
            ...(isOpen && Object.prototype.hasOwnProperty.call(resolvedPatch, "openNotes")
              ? { openNotes: resolvedPatch.openNotes ?? "" }
              : {}),
            ...(!isOpen && Object.prototype.hasOwnProperty.call(resolvedPatch, "closeNotes")
              ? { closeNotes: resolvedPatch.closeNotes ?? "" }
              : {})
          }
        };
      })
    }));
  };

  const addScriptTemplate = (): void => {
    const id = `template.script_${Date.now()}`;
    const next: ScriptTemplateDefinition = {
      id,
      name: `Script Template ${program.scriptTemplates.length + 1}`,
      description: "",
      script: "send(msg);",
      outputs: [{ name: "out", order: 1, description: "" }],
      variableBindings: []
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      scriptTemplates: [...prev.scriptTemplates, next]
    }));
  };

  const addEventTemplate = (): void => {
    const id = `template.event_${Date.now()}`;
    applyProgramUpdate((prev) => ({
      ...prev,
      eventTemplates: [
        ...(prev.eventTemplates || []),
        {
          id,
          enabled: true,
          allowParallel: true,
          concurrencyMode: "parallel",
          eventPathTemplate: "",
          closePatternTemplate: "",
          eventPathBuilder: [],
          closePatternBuilder: [],
          uniquePatternTemplate: "",
          uniquePatternBuilder: [],
          closeOnOpenPatterns: [],
          closeOnOpenPatternBuilders: [],
          requiredParentPattern: "",
          requiredParentBuilder: [],
          closeChildrenOnClosePatterns: [],
          closeChildrenOnClosePatternBuilders: [],
          bindings: [],
          assetPaths: [],
          snapshotTemplateId: "",
          severity: "other",
          contextBindings: {},
          contextFields: [],
          timeSource: {
            open: { source: "now" },
            close: { source: "now" }
          },
          capture: {
            onOpen: true,
            onClose: true
          },
          captureFields: []
        }
      ]
    }));
    setSelectedEventTemplateId(id);
  };

  const duplicateEventTemplate = (id: string): void => {
    const source = (program.eventTemplates || []).find((item) => item.id === id);
    if (!source) return;
    const copyBase = `${source.id}_copy`;
    let candidateId = copyBase;
    let seq = 2;
    const idSet = new Set((program.eventTemplates || []).map((item) => item.id));
    while (idSet.has(candidateId)) {
      candidateId = `${copyBase}_${seq}`;
      seq += 1;
    }

    const next: EventTemplateDefinition = {
      ...structuredClone(source),
      id: candidateId
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      eventTemplates: [...(prev.eventTemplates || []), next]
    }));
    setSelectedEventTemplateId(candidateId);
    setStatus(`Event template duplicated: ${candidateId}`);
  };

  const updateEventTemplate = (id: string, patch: Partial<EventTemplateDefinition>): void => {
    const current = (program.eventTemplates || []).find((item) => item.id === id);
    const merged = current ? { ...current, ...patch } : patch;
    const normalizedPatch: Partial<EventTemplateDefinition> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "id")) {
      const nextId = String(patch.id || "").trim();
      if (!nextId) return;
      if (nextId !== id && (program.eventTemplates || []).some((item) => item.id === nextId)) {
        setStatus(`Duplicate blocked: event template id "${nextId}" already exists`);
        return;
      }
      normalizedPatch.id = nextId;
    }
    if (Object.prototype.hasOwnProperty.call(merged, "eventPathBuilder")) {
      normalizedPatch.eventPathTemplate = renderEventTemplatePathBuilder(merged.eventPathBuilder);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "closePatternBuilder")) {
      normalizedPatch.closePatternTemplate = renderEventTemplatePathBuilder(merged.closePatternBuilder);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "uniquePatternBuilder")) {
      normalizedPatch.uniquePatternTemplate = renderEventTemplatePathBuilder(merged.uniquePatternBuilder);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "requiredParentBuilder")) {
      normalizedPatch.requiredParentPattern = renderEventTemplatePathBuilder(merged.requiredParentBuilder);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "closeOnOpenPatternBuilders")) {
      normalizedPatch.closeOnOpenPatterns = (merged.closeOnOpenPatternBuilders || [])
        .map((builder) => renderEventTemplatePathBuilder(builder))
        .filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "closeChildrenOnClosePatternBuilders")) {
      normalizedPatch.closeChildrenOnClosePatterns = (merged.closeChildrenOnClosePatternBuilders || [])
        .map((builder) => renderEventTemplatePathBuilder(builder))
        .filter(Boolean);
    }
    applyProgramUpdate((prev) => ({
      ...prev,
      eventTemplates: (prev.eventTemplates || []).map((item) =>
        item.id === id ? { ...item, ...normalizedPatch } : item
      )
    }));
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "id")) {
      setSelectedEventTemplateId(String(normalizedPatch.id || ""));
      applyProgramUpdate((prev) =>
        hydrateActiveFlow(
          {
            ...prev,
            flowDefinitions: (prev.flowDefinitions || []).map((flow) => ({
              ...flow,
              nodes: (flow.nodes || []).map((node) =>
                (node.kind === "event_open" || node.kind === "event_close") && node.templateId === id
                  ? { ...node, templateId: String(normalizedPatch.id || "") }
                  : node
              )
            }))
          },
          prev.activeFlowId
        )
      );
    }
  };

  const removeEventTemplate = (id: string): void => {
    applyProgramUpdate((prev) =>
      hydrateActiveFlow(
        {
          ...prev,
          eventTemplates: (prev.eventTemplates || []).filter((item) => item.id !== id),
          flowDefinitions: (prev.flowDefinitions || []).map((flow) => ({
            ...flow,
            nodes: (flow.nodes || []).map((node) =>
              node.kind === "action"
                ? {
                    ...node,
                    config:
                      ((node.config as Record<string, unknown> | undefined)?.eventTemplateId || "") === id
                        ? {
                            ...(node.config || {}),
                            eventTemplateId: "",
                            eventTemplateOverrides: {}
                          }
                        : node.config
                  }
                : node
            )
          }))
        },
        prev.activeFlowId
      )
    );
    if (selectedEventTemplateId === id) setSelectedEventTemplateId("");
  };

  const removeScriptTemplate = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      scriptTemplates: prev.scriptTemplates.filter((item) => item.id !== id)
    }));
  };

  const updateScriptTemplate = (id: string, patch: Partial<ScriptTemplateDefinition>): void => {
    applyProgramUpdate((prev) => {
      const nextScriptTemplates = upsertById(prev.scriptTemplates, id, patch);
      const updatedTemplate = nextScriptTemplates.find((item) => item.id === id);
      if (!updatedTemplate) {
        return {
          ...prev,
          scriptTemplates: nextScriptTemplates
        };
      }
      const shouldSyncScriptToNodes = Object.prototype.hasOwnProperty.call(patch, "script");
      if (!shouldSyncScriptToNodes) {
        return {
          ...prev,
          scriptTemplates: nextScriptTemplates
        };
      }
      const nextFlowDefinitions = (prev.flowDefinitions || []).map((flow) => ({
        ...flow,
        nodes: (flow.nodes || []).map((node) =>
          node.kind === "action" && node.templateId === id
            ? {
                ...node,
                config: {
                  ...(node.config || {}),
                  script: updatedTemplate.script
                }
              }
            : node
        )
      }));
      const hydrated = hydrateActiveFlow(
        {
          ...prev,
          scriptTemplates: nextScriptTemplates,
          flowDefinitions: nextFlowDefinitions
        },
        prev.activeFlowId
      );
      const nextNodes = hydrated.flows.nodes || [];
      for (const node of nextNodes) {
        if (node.kind !== "action" || node.templateId !== id) continue;
        latestActionScriptsRef.current[node.id] = String(((node.config || {}) as Record<string, unknown>).script || "");
      }
      return {
        ...hydrated,
        scriptTemplates: nextScriptTemplates
      };
    });
  };

  return {
    addAction,
    addEventAction,
    addEventActionFromTemplate,
    addEventTemplate,
    addScriptTemplate,
    createActionFromTemplateInFlow,
    createEventNodeFromTemplateInFlow,
    duplicateAction,
    duplicateEventAction,
    duplicateEventTemplate,
    removeAction,
    removeEventAction,
    removeEventTemplate,
    removeScriptTemplate,
    removeTriggerTemplate,
    renameAction,
    renameEventAction,
    updateAction,
    updateEventAction,
    updateEventTemplate,
    updateScriptTemplate,
    updateTriggerTemplate
  };
}
