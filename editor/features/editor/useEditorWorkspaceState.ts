import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { buildEventActionBindingsFromTemplate, deriveEventNodeSummaries } from "../../domains/event/model";
import {
  defaultFlowVariable,
  EMPTY_PROGRAM,
  getActiveFlow,
  getBaseEventActionIdFromNode,
  getEventActionCloseNodeId,
  getEventActionOpenNodeId,
  getNextIncrementalLabel,
  getTriggerBaseLabel,
  hydrateActiveFlow,
  makeRandomToken,
  migrateProgramIdentity,
  updateActiveFlowInProgram
} from "../../domains/flow/model";
import { historyReducer, type ProgramUpdater } from "../../domains/program/history";
import { collectLatestActionScripts } from "../../domains/program/io";
import { deriveScriptNodeSummaries } from "../../domains/script/model";
import {
  normalizeProgram,
  parseMaybeJson,
  renderEventTemplatePathBuilder,
  removeNodeFromLinks,
  renameNodePositionKey,
  renameNodeInLinks,
  upsertById
} from "../../lib/programUtils";
import type {
  AssetFrameworkDefinition,
  EventNodeSummary,
  EventTemplateDefinition,
  FlowDefinition,
  FlowNodeDefinition,
  Program,
  ScriptNodeSummary,
  ScriptTemplateDefinition,
  ScriptOutputDefinition,
  TriggerDefinition,
  TriggerTemplateType,
  TriggerTemplateDefinition,
  NodePosition
} from "../../types/program";
import type { FlowPaletteItem } from "../../components/managers/FlowManager";
import type { EditorInspectorTarget } from "./workspaceTypes";
import { createWorkspacePersistenceHandlers } from "./workspacePersistence";
import { createWorkspaceFlowHandlers } from "./workspaceFlowHandlers";
import { createWorkspaceInspectorHandlers } from "./workspaceInspectorHandlers";
import { createWorkspaceEntityHandlers } from "./workspaceEntityHandlers";
import {
  buildActiveFlowVariableNames,
  buildEventWatchPathOptions,
  buildFlowActionIds,
  buildFlowEventNodeIds,
  buildFlowNodeLabels,
  buildFlowNodeOutputs,
  buildFlowNodeSubtitles,
  buildFlowTriggerIds,
  buildWatchPathOptions
} from "./workspaceSelectors";

export function useEditorWorkspaceState() {
  const [tab, setTab] = useState(0);
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: EMPTY_PROGRAM,
    future: []
  });
  const [selectedTriggerTemplateId, setSelectedTriggerTemplateId] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [selectedScriptTemplateId, setSelectedScriptTemplateId] = useState("");
  const [selectedEventActionId, setSelectedEventActionId] = useState("");
  const [selectedEventTemplateId, setSelectedEventTemplateId] = useState("");
  const [selectedFlowId, setSelectedFlowId] = useState("flow_main");
  const [inspectorTarget, setInspectorTarget] = useState<EditorInspectorTarget | null>(null);
  const [flowZoom, setFlowZoom] = useState(0.5);
  const [, setStatusText] = useState("Loading...");
  const [toast, setToast] = useState<{ open: boolean; message: string; severity: "success" | "info" | "warning" | "error" }>({
    open: false,
    message: "",
    severity: "info"
  });
  const latestActionScriptsRef = useRef<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const program = history.present;
  const activeFlow = getActiveFlow(program);
  const flowNodes = program.flows.nodes || [];
  const derivedActions = useMemo(() => deriveScriptNodeSummaries(flowNodes), [flowNodes]);
  const derivedEventActions = useMemo(() => deriveEventNodeSummaries(flowNodes), [flowNodes]);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const notify = (message: string, severity: "success" | "info" | "warning" | "error" = "info") => {
    setStatusText(message);
    setToast({ open: true, message, severity });
  };

  const setStatus = (message: string) => {
    const lowered = message.toLowerCase();
    if (message === "Program loaded") {
      setStatusText(message);
      return;
    }
    if (lowered.includes("error") || lowered.includes("failed")) {
      notify(message, "error");
      return;
    }
    if (lowered.includes("blocked") || lowered.includes("cannot") || lowered.includes("multiple")) {
      notify(message, "warning");
      return;
    }
    if (lowered.includes("saved") || lowered.includes("downloaded") || lowered.includes("imported") || lowered.includes("created") || lowered.includes("duplicated") || lowered.includes("pasted") || lowered.includes("removed")) {
      notify(message, "success");
      return;
    }
    notify(message, "info");
  };

  const loadProgramIntoEditor = (next: Program, toastMessage?: string) => {
    const hydrated = hydrateActiveFlow(next, next.activeFlowId);
    latestActionScriptsRef.current = collectLatestActionScripts(hydrated);
    dispatch({ type: "INIT", program: hydrated });
    setSelectedFlowId(hydrated.activeFlowId || "flow_main");
    setSelectedTriggerTemplateId(hydrated.triggerTemplates?.[0]?.id ?? "");
    setSelectedActionId((hydrated.flows.nodes || []).find((node) => node.kind === "action")?.id ?? "");
    setSelectedScriptTemplateId(hydrated.scriptTemplates?.[0]?.id ?? "");
    setSelectedEventActionId((hydrated.flows.nodes || []).find((node) => node.kind === "event_open")?.refId ?? "");
    setSelectedEventTemplateId(hydrated.eventTemplates?.[0]?.id ?? "");
    setInspectorTarget(null);
    if (toastMessage) setStatus(toastMessage);
    else setStatusText("Program loaded");
  };

  const applyProgramUpdate = (updater: ProgramUpdater) => {
    dispatch({
      type: "APPLY",
      updater
    });
  };

  const applyProgramNoHistory = (updater: ProgramUpdater) => {
    dispatch({
      type: "APPLY_NO_HISTORY",
      updater
    });
  };

  const applyActiveFlowUpdate = (updater: (flow: FlowDefinition) => FlowDefinition) => {
    applyProgramUpdate((prev) => updateActiveFlowInProgram(prev, updater));
  };

  const {
    downloadProgramJson,
    importProgramJson,
    saveProgram
  } = createWorkspacePersistenceHandlers({
    program,
    selectedFlowId,
    latestActionScriptsRef,
    loadProgramIntoEditor,
    setStatus,
    setTab
  });

  const {
    addFlowDefinition,
    addLink,
    duplicateFlowDefinition,
    duplicateNodesInFlow,
    handleDropPaletteItem: handleFlowDropPaletteItem,
    removeFlowDefinition,
    removeLink,
    removeNodeFromFlow,
    switchActiveFlow,
    updateFlowDefinition,
    updateLink,
    updateNodePosition
  } = createWorkspaceFlowHandlers({
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
  });

  const {
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
  } = createWorkspaceEntityHandlers({
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
  });

  useEffect(() => {
    fetch("/api/program")
      .then((res) => res.json())
      .then((data: { program?: Program }) => {
        const next = migrateProgramIdentity(normalizeProgram(data.program ?? EMPTY_PROGRAM));
        loadProgramIntoEditor(next);
      })
      .catch((error: Error) => {
        setStatus(`Load error: ${error.message}`);
      });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isInputLike =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest(".monaco-editor");
      if (isInputLike) return;

      const isMeta = event.ctrlKey || event.metaKey;
      if (!isMeta) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: "UNDO" });
        return;
      }

      if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        dispatch({ type: "REDO" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const addTriggerTemplateWithType = (type: TriggerTemplateType): void => {
    const id = makeRandomToken("trigger_template");
    const defaultWatchPath =
      type === "watcher_set" || type === "watcher_valuechange"
        ? "*.*.*"
        : type === "watcher_event_open" || type === "watcher_event_close"
          ? "*"
          : "";
    const name = getNextIncrementalLabel(
      getTriggerBaseLabel(type),
      (program.triggerTemplates || []).map((item) => item.name || "")
    );
    const next: TriggerTemplateDefinition = {
      id,
      name,
      description: "",
      type,
      enabled: true,
      intervalMs: 1000,
      activeFrom: "",
      activeTo: "",
      watchPath: defaultWatchPath,
      message: { payload: 0 }
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      triggerTemplates: [...(prev.triggerTemplates || []), next]
    }));
    setSelectedTriggerTemplateId(id);
  };

  const flowNodeLabels = useMemo(() => buildFlowNodeLabels(program), [program]);
  const flowNodeSubtitles = useMemo(() => buildFlowNodeSubtitles(program), [program]);
  const flowNodeOutputs = useMemo(() => buildFlowNodeOutputs(program), [program]);
  const flowTriggerIds = useMemo(() => buildFlowTriggerIds(program), [program]);
  const flowActionIds = useMemo(() => buildFlowActionIds(program), [program]);
  const flowEventNodeIds = useMemo(() => buildFlowEventNodeIds(program), [program]);
  const activeFlowVariableNames = useMemo(() => buildActiveFlowVariableNames(activeFlow), [activeFlow]);
  const watchPathOptions = useMemo(() => buildWatchPathOptions(program), [program]);
  const eventWatchPathOptions = useMemo(() => buildEventWatchPathOptions(program), [program]);

  const updateTriggerTemplatePayload = (id: string, rawPayload: string): void => {
    const template = (program.triggerTemplates || []).find((item) => item.id === id);
    if (!template) return;
    updateTriggerTemplate(id, {
      message: { ...template.message, payload: parseMaybeJson(rawPayload) }
    });
  };

  const updateAssets = (
    updater: AssetFrameworkDefinition | ((assets: AssetFrameworkDefinition) => AssetFrameworkDefinition)
  ): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      assets: typeof updater === "function" ? updater(prev.assets) : updater
    }));
  };

  const deleteNodesFromFlow = (nodeIds: string[]): void => {
    const uniqueIds = Array.from(new Set(nodeIds));
    const nodesById = new Map((program.flows.nodes || []).map((node) => [node.id, node] as const));
    const actionIds = uniqueIds.filter((id) => nodesById.get(id)?.kind === "action");
    const eventNodeIds = uniqueIds.filter((id) => {
      const kind = nodesById.get(id)?.kind;
      return kind === "event_open" || kind === "event_close";
    });
    const eventActionIds = Array.from(
      new Set(
        eventNodeIds
          .map((id) => nodesById.get(id)?.refId)
          .filter(Boolean) as string[]
      )
    );
    const triggerIds = uniqueIds.filter((id) => nodesById.get(id)?.kind === "trigger");

    actionIds.forEach((id) => delete latestActionScriptsRef.current[id]);

    applyProgramUpdate((prev) => {
      const nextPositions = { ...(prev.flows.nodePositions || {}) };
      uniqueIds.forEach((id) => delete nextPositions[id]);
      const remainingNodes = (prev.flows.nodes || []).filter((node) => {
        if (uniqueIds.includes(node.id)) return false;
        return true;
      });
      remainingNodes.forEach((node) => {
        if (!nextPositions[node.id]) return;
      });
      return updateActiveFlowInProgram(prev, (flow) => ({
          ...flow,
          nodes: remainingNodes,
          links: flow.links.filter((link) => {
            if (uniqueIds.includes(link.from) || uniqueIds.includes(link.to)) return false;
            return true;
          }),
          nodePositions: nextPositions
        }));
    });

    if (inspectorTarget?.kind === "action" && actionIds.includes(inspectorTarget.id)) setInspectorTarget(null);
    if (inspectorTarget?.kind === "event" && eventActionIds.includes(inspectorTarget.id)) setInspectorTarget(null);
    if (selectedActionId && actionIds.includes(selectedActionId)) setSelectedActionId("");
    if (selectedEventActionId && eventActionIds.includes(selectedEventActionId)) setSelectedEventActionId("");
    if (triggerIds.length > 0 || actionIds.length > 0 || eventNodeIds.length > 0) {
      setStatus(`Removed ${actionIds.length} script node(s), ${eventNodeIds.length} event node(s), ${triggerIds.length} trigger placement(s)`);
    }
  };

  const handleDropPaletteItem = (item: FlowPaletteItem, position: NodePosition): void => {
    handleFlowDropPaletteItem(item, position, createActionFromTemplateInFlow, createEventNodeFromTemplateInFlow);
  };

  const {
    handleCloseInspector,
    handleOpenEventTemplateManager,
    handleOpenScriptTemplateManager,
    handleRenameInspectorNode,
    handleUpdateInspectorNode
  } = createWorkspaceInspectorHandlers({
    nodes: program.flows.nodes || [],
    applyActiveFlowUpdate,
    renameAction,
    renameEventAction,
    updateAction,
    updateEventAction,
    setSelectedScriptTemplateId,
    setSelectedEventTemplateId,
    setInspectorTarget,
    setTab
  });

  const handleProgramNameChange = (next: string) => {
    applyProgramUpdate((prev) => ({
      ...prev,
      meta: { ...prev.meta, name: next }
    }));
  };

  const handleUndo = () => dispatch({ type: "UNDO" });
  const handleRedo = () => dispatch({ type: "REDO" });
  const handleOpenImport = () => importInputRef.current?.click();
  const handleNodePositionDragStart = () => dispatch({ type: "PUSH_SNAPSHOT" });
  const handleTriggerNodeDoubleClick = (triggerId: string) => setInspectorTarget({ kind: "trigger", id: triggerId });
  const handleActionNodeDoubleClick = (actionId: string) => {
    setSelectedActionId(actionId);
    setInspectorTarget({ kind: "action", id: actionId });
  };
  const handleEventNodeDoubleClick = (nodeId: string) => {
    const eventActionId = getBaseEventActionIdFromNode(nodeId);
    setSelectedEventActionId(eventActionId);
    setInspectorTarget({ kind: "event", id: nodeId });
  };
  const handleConnectNodes = (fromId: string, toId: string, fromPort?: string) => {
    addLink({ from: fromId, to: toId, fromPort, enabled: true });
  };
  const handleToastClose = () => setToast((prev) => ({ ...prev, open: false }));

  return {
    activeFlow,
    activeFlowVariableNames,
    addAction,
    addEventAction,
    addEventActionFromTemplate,
    addEventTemplate,
    addFlowDefinition,
    addLink,
    addScriptTemplate,
    canRedo,
    canUndo,
    deleteNodesFromFlow,
    derivedActions,
    derivedEventActions,
    downloadProgramJson,
    duplicateAction,
    duplicateEventAction,
    duplicateEventTemplate,
    duplicateFlowDefinition,
    duplicateNodesInFlow,
    eventWatchPathOptions,
    flowActionIds,
    flowEventNodeIds,
    flowNodeLabels,
    flowNodeOutputs,
    flowNodeSubtitles,
    flowTriggerIds,
    flowZoom,
    handleActionNodeDoubleClick,
    handleCloseInspector,
    handleConnectNodes,
    handleEventNodeDoubleClick,
    handleNodePositionDragStart,
    handleOpenEventTemplateManager,
    handleOpenImport,
    handleOpenScriptTemplateManager,
    handleProgramNameChange,
    handleRedo,
    handleRenameInspectorNode,
    handleToastClose,
    handleTriggerNodeDoubleClick,
    handleUndo,
    handleUpdateInspectorNode,
    handleDropPaletteItem,
    importInputRef,
    importProgramJson,
    inspectorTarget,
    program,
    removeAction,
    removeEventAction,
    removeEventTemplate,
    removeFlowDefinition,
    removeLink,
    removeNodeFromFlow,
    removeScriptTemplate,
    renameAction,
    renameEventAction,
    saveProgram,
    selectedActionId,
    selectedEventActionId,
    selectedEventTemplateId,
    selectedFlowId,
    selectedScriptTemplateId,
    setFlowZoom,
    setSelectedActionId,
    setSelectedEventActionId,
    setSelectedEventTemplateId,
    setSelectedScriptTemplateId,
    setStatus,
    setTab,
    switchActiveFlow,
    tab,
    toast,
    updateAction,
    updateAssets,
    updateEventAction,
    updateEventTemplate,
    updateFlowDefinition,
    updateLink,
    updateNodePosition,
    updateScriptTemplate,
    watchPathOptions
  };
}

export type EditorWorkspaceState = ReturnType<typeof useEditorWorkspaceState>;
