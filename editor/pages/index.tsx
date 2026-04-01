import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Divider,
  Snackbar,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography
} from "@mui/material";
import ActionManager from "../components/managers/ActionManager";
import EventDesignerManager from "../components/managers/EventDesignerManager";
import FlowManager from "../components/managers/FlowManager";
import FlowNodeInspectorDrawer from "../components/managers/FlowNodeInspectorDrawer";
import AssetManager from "../components/managers/AssetManager";
import EventManager from "../components/managers/EventManager";
import DocsManager from "../components/managers/DocsManager";
import GlobalStoreManager from "../components/managers/GlobalStoreManager";
import DbConnectionManager from "../components/managers/DbConnectionManager";
import {
  normalizeProgram,
  parseMaybeJson,
  renderEventTemplatePathBuilder,
  removeNodeFromLinks,
  renameNodePositionKey,
  renameNodeInLinks,
  upsertById
} from "../lib/programUtils";
import type {
  AssetFrameworkDefinition,
  EventActionBindingDefinition,
  EventTemplateDefinition,
  EventTemplateInputBindingDefinition,
  FlowDefinition,
  FlowNodeDefinition,
  FlowLink,
  FlowVariableDefinition,
  Program,
  ScriptNodeSummary,
  ScriptTemplateDefinition,
  EventNodeSummary,
  ScriptOutputDefinition,
  TriggerDefinition,
  TriggerTemplateDefinition,
  TriggerTemplateType,
  NodePosition
} from "../types/program";
import type { FlowPaletteItem } from "../components/managers/FlowManager";

const EMPTY_PROGRAM: Program = {
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
  flows: { id: "flow_main", name: "Main Flow", enabled: true, variables: [], activeFlowId: "flow_main", nodes: [], links: [], nodePositions: {} },
  assets: { assets: [], attributeTemplates: [] }
};

const getEventActionOpenNodeId = (id: string): string => `event.open.${id}`;
const getEventActionCloseNodeId = (id: string): string => `event.close.${id}`;
const getBaseEventActionIdFromNode = (nodeId: string): string =>
  nodeId.startsWith("event.open.")
    ? nodeId.slice("event.open.".length)
    : nodeId.startsWith("event.close.")
      ? nodeId.slice("event.close.".length)
      : nodeId;

const makeRandomToken = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 4)}`;

const getNextIncrementalLabel = (base: string, usedLabels: string[]): string => {
  const normalizedBase = base.trim() || "Node";
  let index = 1;
  let candidate = `${normalizedBase} - ${index}`;
  const used = new Set(usedLabels.map((item) => item.trim().toLowerCase()).filter(Boolean));
  while (used.has(candidate.trim().toLowerCase())) {
    index += 1;
    candidate = `${normalizedBase} - ${index}`;
  }
  return candidate;
};

const getTriggerBaseLabel = (type: TriggerTypeLike): string => {
  if (type === "interval") return "Interval Trigger";
  if (type === "watcher_set") return "Watcher Set";
  if (type === "watcher_valuechange") return "Watcher Value Change";
  if (type === "watcher_event_open") return "Watcher Event Open";
  if (type === "watcher_event_close") return "Watcher Event Close";
  if (type === "cron") return "Cron Trigger";
  return "Watcher Event Falling";
};

type TriggerTypeLike = TriggerDefinition["type"] | TriggerTemplateType;

const getActiveFlow = (program: Program): FlowDefinition => {
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
};

const hydrateActiveFlow = (program: Program, requestedFlowId?: string): Program => {
  const flowDefinitions = Array.isArray(program.flowDefinitions) ? program.flowDefinitions : [];
  const activeFlow =
    flowDefinitions.find((flow) => flow.id === requestedFlowId) ||
    flowDefinitions.find((flow) => flow.id === program.activeFlowId) ||
    flowDefinitions[0] ||
    {
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
};

const updateActiveFlowInProgram = (program: Program, updater: (flow: FlowDefinition) => FlowDefinition): Program => {
  const activeFlow = getActiveFlow(program);
  const nextFlow = updater(structuredClone(activeFlow));
  const nextFlowDefinitions = (program.flowDefinitions || []).map((flow) => (flow.id === activeFlow.id ? nextFlow : flow));
  return hydrateActiveFlow(
    {
      ...program,
      flowDefinitions: nextFlowDefinitions
    },
    nextFlow.id
  );
};

const defaultFlowVariable = (order: number): FlowVariableDefinition => ({
  name: `flowVar${order}`,
  order,
  description: "",
  source: "static_string",
  staticValue: "",
  attributePath: ""
});

const isShortGeneratedId = (value: string, prefix: string): boolean =>
  new RegExp(`^${prefix}_[a-z0-9]{8}$`, "i").test(String(value || ""));

const remapNodeIdInLinks = (links: FlowLink[], fromId: string, toId: string): FlowLink[] =>
  links.map((link) => ({
    ...link,
    from: link.from === fromId ? toId : link.from,
    to: link.to === fromId ? toId : link.to
  }));

const migrateProgramIdentity = (program: Program): Program => {
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
        return { ...node, id: mapped.nextId, refId: mapped.nextId, label: node.label?.trim() || mapped.label || "" };
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
};

const deriveScriptNodeSummaries = (nodes: FlowNodeDefinition[]): ScriptNodeSummary[] =>
  nodes
    .filter((node) => node.kind === "action")
    .map((node) => ({
      id: node.id,
      label: node.label ?? "",
      type: "script",
      enabled: node.enabled !== false,
      description: String((node.config as Record<string, unknown> | undefined)?.description ?? ""),
      templateId: node.templateId ?? "",
      templateBindingOverrides:
        (((node.config as Record<string, unknown> | undefined)?.templateBindingOverrides as Record<string, unknown>) || {}) as any,
      eventTemplateId: String((node.config as Record<string, unknown> | undefined)?.eventTemplateId ?? ""),
      eventTemplateOverrides:
        (((node.config as Record<string, unknown> | undefined)?.eventTemplateOverrides as Record<string, unknown>) || {}) as any,
      script: String((node.config as Record<string, unknown> | undefined)?.script ?? "")
    }));

const deriveEventNodeSummaries = (nodes: FlowNodeDefinition[]): EventNodeSummary[] => {
  const grouped = new Map<string, { open?: FlowNodeDefinition; close?: FlowNodeDefinition }>();
  nodes.forEach((node) => {
    if (node.kind !== "event_open" && node.kind !== "event_close") return;
    const key = node.refId;
    const entry = grouped.get(key) || {};
    if (node.kind === "event_open") entry.open = node;
    if (node.kind === "event_close") entry.close = node;
    grouped.set(key, entry);
  });
  return Array.from(grouped.entries()).map(([id, entry]) => {
    const openConfig = (entry.open?.config || {}) as Record<string, unknown>;
    const closeConfig = (entry.close?.config || {}) as Record<string, unknown>;
    return {
      id,
      label: (entry.open?.label || entry.close?.label || "").replace(/^OPEN\s+|^CLOSE\s+/i, ""),
      enabled: (entry.open?.enabled ?? entry.close?.enabled) !== false,
      description: String(openConfig.description ?? closeConfig.description ?? ""),
      templateId: entry.open?.templateId || entry.close?.templateId || "",
      templateOverrides: (openConfig.templateOverrides || closeConfig.templateOverrides || {}) as any,
      bindings: (openConfig.bindings || closeConfig.bindings || {}) as any,
      openNotes: String(openConfig.openNotes ?? ""),
      closeNotes: String(closeConfig.closeNotes ?? "")
    };
  });
};

const collectTemplateVariables = (template: EventTemplateDefinition | undefined): string[] => {
  if (!template) return [];
  if ((template.bindings || []).length > 0) {
    return (template.bindings || []).map((item) => item.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  const keys = new Set<string>();
  const collectFromString = (input: string | undefined) => {
    for (const match of String(input || "").matchAll(/\{([^}]+)\}/g)) {
      const key = String(match[1] || "").trim();
      if (key) keys.add(key);
    }
  };
  (template.eventPathBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.closePatternBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.assetPaths || []).forEach((item) => {
    if (item.source === "variable" && item.key) keys.add(item.key);
  });
  Object.values(template.contextBindings || {}).forEach((binding) => {
    if (binding.source === "variable" && binding.key) keys.add(binding.key);
    if (binding.source === "attribute" && binding.pathTemplate) collectFromString(binding.pathTemplate);
  });
  (template.contextFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  (template.captureFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  if (template.timeSource?.open?.source === "variable" && template.timeSource.open.key) keys.add(template.timeSource.open.key);
  if (template.timeSource?.close?.source === "variable" && template.timeSource.close.key) keys.add(template.timeSource.close.key);
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
};

const defaultEventBindingForVariable = (name: string) => {
  if (name.toLowerCase().includes("asset")) return { source: "asset" as const, attributePath: "" };
  if (name.toLowerCase().includes("time") || name === "timestamp") return { source: "msg_path" as const, attributePath: "ts" };
  return { source: "msg_path" as const, attributePath: `payload.${name}` };
};

const eventTemplateBindingToActionBinding = (
  binding: EventTemplateInputBindingDefinition
): EventActionBindingDefinition => {
  const fallback = defaultEventBindingForVariable(binding.name);
  const source = binding.source || fallback.source;
  if (source === "asset" || source === "attribute" || source === "flow_variable" || source === "msg_path") {
    return {
      source,
      attributePath:
        typeof binding.defaultValue === "string"
          ? binding.defaultValue
          : fallback.attributePath ?? ""
    };
  }
  if (source === "static_boolean") {
    return {
      source,
      staticValue: binding.defaultValue === true
    };
  }
  if (source === "static_number") {
    return {
      source,
      staticValue: Number(binding.defaultValue ?? 0)
    };
  }
  return {
    source,
    staticValue: binding.defaultValue ?? ""
  };
};

const buildEventActionBindingsFromTemplate = (
  template: EventTemplateDefinition
): Record<string, EventActionBindingDefinition> => {
  const explicit = new Map(
    (template.bindings || [])
      .filter((item) => String(item.name || "").trim())
      .map((item) => [String(item.name).trim(), eventTemplateBindingToActionBinding(item)])
  );
  for (const key of collectTemplateVariables(template)) {
    if (!explicit.has(key)) explicit.set(key, defaultEventBindingForVariable(key));
  }
  return Object.fromEntries(explicit);
};

type ProgramUpdater = (program: Program) => Program;

interface HistoryState {
  past: Program[];
  present: Program;
  future: Program[];
}

type HistoryAction =
  | { type: "INIT"; program: Program }
  | { type: "APPLY"; updater: ProgramUpdater }
  | { type: "APPLY_NO_HISTORY"; updater: ProgramUpdater }
  | { type: "PUSH_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" };

const MAX_HISTORY = 40;
const MAX_HISTORY_JSON_BYTES = 24 * 1024 * 1024;

function estimateProgramBytes(program: Program): number {
  try {
    return JSON.stringify(program).length;
  } catch {
    return 0;
  }
}

function trimHistorySnapshots(snapshots: Program[]): Program[] {
  let trimmed = snapshots.slice(Math.max(0, snapshots.length - MAX_HISTORY));
  if (trimmed.length <= 1) return trimmed;

  const sizes = trimmed.map((item) => estimateProgramBytes(item));
  let totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  while (trimmed.length > 1 && totalBytes > MAX_HISTORY_JSON_BYTES) {
    totalBytes -= sizes.shift() || 0;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "INIT") {
    return { past: [], present: action.program, future: [] };
  }

  if (action.type === "APPLY") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      past: nextPast,
      present: next,
      future: []
    };
  }

  if (action.type === "APPLY_NO_HISTORY") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    return { ...state, present: next };
  }

  if (action.type === "PUSH_SNAPSHOT") {
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      ...state,
      past: nextPast,
      future: []
    };
  }

  if (action.type === "UNDO") {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future]
    };
  }

  if (action.type === "REDO") {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    const nextPast = trimHistorySnapshots([...state.past, state.present]);
    return {
      past: nextPast,
      present: next,
      future: state.future.slice(1)
    };
  }

  return state;
}

export default function HomePage() {
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
  const [inspectorTarget, setInspectorTarget] = useState<{ kind: "trigger" | "action" | "event"; id: string } | null>(null);
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
    latestActionScriptsRef.current = Object.fromEntries(
      deriveScriptNodeSummaries(hydrated.flows.nodes || []).map((action) => [action.id, action.script || ""])
    );
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

  const switchActiveFlow = (flowId: string) => {
    const nextFlow = (program.flowDefinitions || []).find((flow) => flow.id === flowId);
    setSelectedFlowId(flowId);
    applyProgramNoHistory((prev) => hydrateActiveFlow(prev, flowId));
    setInspectorTarget(null);
    setSelectedActionId((nextFlow?.nodes || []).find((node) => node.kind === "action")?.id ?? "");
    setSelectedEventActionId((nextFlow?.nodes || []).find((node) => node.kind === "event_open")?.refId ?? "");
  };

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

  const saveProgram = async () => {
    const activeFlowIdForSave = program.activeFlowId || program.flows.activeFlowId || selectedFlowId;
    const syncedFlowDefinitions = (program.flowDefinitions || []).map((flow) =>
      flow.id === activeFlowIdForSave
        ? {
            ...flow,
            nodes: ((flow.nodes || []) as FlowNodeDefinition[]).map((node) =>
              node.kind === "action"
                ? {
                    ...node,
                    config: {
                      ...(node.config || {}),
                      script:
                        latestActionScriptsRef.current[node.id] !== undefined
                          ? latestActionScriptsRef.current[node.id]
                          : String((node.config as Record<string, unknown> | undefined)?.script ?? "")
                    }
                  }
                : node
            )
          }
        : flow
    );
    const programForSave: Program = hydrateActiveFlow({
      ...program,
      flowDefinitions: syncedFlowDefinitions,
      assets: {
        ...program.assets,
        assets: (program.assets?.assets || []).map((asset) => ({
          ...asset,
          // Workspace save must not persist runtime attribute values.
          attributes: {}
        }))
      }
    }, activeFlowIdForSave);

    try {
      const res = await fetch("/api/program", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program: programForSave })
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setStatus(`Save error: ${data.error ?? "unknown error"}`);
        return;
      }
      const data = (await res.json()) as {
        path?: string;
        runtimeSynced?: boolean;
        runtimeError?: string;
      };
      if (data.runtimeSynced === false) {
        setStatus(
          `Saved file only (${data.path ?? "programs/main.af.json"}), runtime sync failed: ${data.runtimeError ?? "unknown error"}`
        );
      } else {
        setStatus(`Saved to ${data.path ?? "programs/main.af.json"} (runtime synced)`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Save error: ${message}`);
    }
  };

  const buildProgramForExport = (): Program => {
    const activeFlowIdForExport = program.activeFlowId || program.flows.activeFlowId || selectedFlowId;
    const syncedFlowDefinitions = (program.flowDefinitions || []).map((flow) =>
      flow.id === activeFlowIdForExport
        ? {
            ...flow,
            nodes: ((flow.nodes || []) as FlowNodeDefinition[]).map((node) =>
              node.kind === "action"
                ? {
                    ...node,
                    config: {
                      ...(node.config || {}),
                      script:
                        latestActionScriptsRef.current[node.id] !== undefined
                          ? latestActionScriptsRef.current[node.id]
                          : String((node.config as Record<string, unknown> | undefined)?.script ?? "")
                    }
                  }
                : node
            )
          }
        : flow
    );
    return hydrateActiveFlow({
      ...program,
      flowDefinitions: syncedFlowDefinitions
    }, activeFlowIdForExport);
  };

  const downloadProgramJson = (): void => {
    try {
      const programForExport = buildProgramForExport();
      const json = JSON.stringify(programForExport, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const filenameBase = (program.meta.name || "program")
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const filename = `${filenameBase || "program"}.af.json`;

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Download error: ${message}`);
    }
  };

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

  const importProgramJson = async (file: File): Promise<void> => {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Program;
      const normalized = migrateProgramIdentity(normalizeProgram(parsed));
      loadProgramIntoEditor(normalized, `Imported program from ${file.name}`);
      setTab(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Import error: ${message}`);
    }
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

  const addAction = (parentPath?: string): void => {
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
            ? template.outputs
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((item) => item.name)
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
    const idSet = new Set(flowNodes.filter((item) => item.kind === "event_open" || item.kind === "event_close").map((item) => item.refId));
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
        links: renameNodeInLinks(
          renameNodeInLinks(flow.links, oldOpen, nextOpen),
          oldClose,
          nextClose
        ),
        nodePositions: renameNodePositionKey(
          renameNodePositionKey(flow.nodePositions, oldOpen, nextOpen),
          oldClose,
          nextClose
        )
      }));
  };

  const flowNodeLabels = useMemo(
    () =>
      Object.fromEntries(
        (program.flows?.nodes || []).map((node) => [node.id, (node.label || node.id).trim() || node.id]) as Array<[string, string]>
      ),
    [program.flows?.nodes]
  );

  const flowNodeSubtitles = useMemo(
    () =>
      Object.fromEntries(
        (program.flows?.nodes || []).map((node) => {
          const templateLabel =
            node.kind === "action"
              ? program.scriptTemplates.find((item) => item.id === node.templateId)?.name
              : node.kind === "event_open" || node.kind === "event_close"
                ? (program.eventTemplates || []).find((item) => item.id === node.templateId)?.id
                : (program.triggerTemplates || []).find((item) => item.id === node.templateId)?.name ||
                  getTriggerBaseLabel((node.config as Record<string, unknown> | undefined)?.type as TriggerDefinition["type"] || "interval");
          return [node.id, String(node.subtitle || templateLabel || node.label || node.id)];
        }) as Array<[string, string]>
      ),
    [program.eventTemplates, program.flows?.nodes, program.scriptTemplates, program.triggerTemplates]
  );

  const flowNodeOutputs = useMemo(
    () =>
      Object.fromEntries(
        (program.flows?.nodes || [])
          .filter((node) => node.kind === "action")
          .map((node) => {
            const templateOutputs = program.scriptTemplates.find((template) => template.id === node.templateId)?.outputs;
            const outputs = Array.isArray((node.config as Record<string, unknown> | undefined)?.outputs)
              ? (((node.config as Record<string, unknown>).outputs as unknown[])
                  .map((item) => String(item || "").trim())
                  .filter(Boolean))
              : Array.isArray(templateOutputs) && templateOutputs.length > 0
                ? templateOutputs.slice().sort((a, b) => a.order - b.order).map((item) => item.name)
                : ["out"];
            return [
              node.id,
              outputs.map((label, index) => ({ id: label || `out${index + 1}`, label: label || `OUT ${index + 1}` }))
            ];
          }) as Array<[string, Array<{ id: string; label: string }>]>
      ),
    [program.flows?.nodes]
  );

  const flowTriggerIds = useMemo(
    () => (program.flows?.nodes || []).filter((node) => node.kind === "trigger").map((node) => node.id),
    [program.flows?.nodes]
  );

  const flowActionIds = useMemo(
    () => (program.flows?.nodes || []).filter((node) => node.kind === "action").map((node) => node.id),
    [program.flows?.nodes]
  );

  const flowEventNodeIds = useMemo(
    () =>
      (program.flows?.nodes || [])
        .filter((node) => node.kind === "event_open" || node.kind === "event_close")
        .map((node) => node.id),
    [program.flows?.nodes]
  );

  const activeFlowVariableNames = useMemo(
    () =>
      (activeFlow.variables || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((item) => item.name)
        .filter(Boolean),
    [activeFlow.variables]
  );

  const watchPathOptions = useMemo(() => {
    const byId = new Map(program.assets.assets.map((asset) => [asset.id, asset]));
    const templateById = new Map(
      program.assets.attributeTemplates.map((template) => [template.id, template])
    );

    const getAssetPath = (assetId: string): string => {
      const asset = byId.get(assetId);
      if (!asset) return "";
      const parts = [asset.name];
      let parentId = asset.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        parts.unshift(parent.name);
        parentId = parent.parentId;
      }
      return parts.join(".");
    };

    const paths = new Set<string>(["*.*.*"]);
    for (const asset of program.assets.assets) {
      const assetPath = getAssetPath(asset.id);
      if (!assetPath) continue;
      const attributes = new Set<string>(Object.keys(asset.attributes || {}));
      for (const templateId of asset.templateIds || []) {
        const template = templateById.get(templateId);
        if (!template) continue;
        for (const attr of template.attributes || []) {
          if (attr.enabled === false) continue;
          attributes.add(attr.name);
        }
      }
      for (const attributeName of attributes) {
        const full = `${assetPath}.${attributeName}`;
        paths.add(full);
        const segments = full.split(".");
        if (segments.length >= 2) {
          paths.add(`${segments.slice(0, -1).join(".")}.*`);
          paths.add(`${segments[0]}.*.${segments[segments.length - 1]}`);
        }
      }
    }
    return Array.from(paths).sort((a, b) => a.localeCompare(b));
  }, [program.assets]);

  const eventWatchPathOptions = useMemo(() => {
    const options = new Set<string>(["*"]);
    for (const template of program.triggerTemplates || []) {
      if (template.type !== "watcher_event_open" && template.type !== "watcher_event_close") continue;
      const pattern = String(template.watchPath || "").trim();
      if (!pattern) continue;
      options.add(pattern);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [program.triggerTemplates]);

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
      const template = nextTemplateId
        ? program.scriptTemplates.find((item) => item.id === nextTemplateId)
        : null;
      const currentConfig = (current.config || {}) as Record<string, unknown>;
      resolvedPatch.script = template ? template.script : patch.script ?? String(currentConfig.script ?? "");
      const templateOutputs =
        template?.outputs && template.outputs.length > 0
          ? template.outputs.slice().sort((a, b) => a.order - b.order).map((item) => item.name)
          : ["out"];
      resolvedPatch.templateBindingOverrides =
        nextTemplateId
          ? (((currentConfig.templateBindingOverrides as Record<string, unknown>) || {}) as any)
          : {};
      (resolvedPatch as Partial<ScriptNodeSummary> & { outputs?: string[] }).outputs = templateOutputs;
      latestActionScriptsRef.current[id] = String(resolvedPatch.script ?? "");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "eventTemplateId")) {
      const nextEventTemplateId = patch.eventTemplateId;
      const currentConfig = (current.config || {}) as Record<string, unknown>;
      resolvedPatch.eventTemplateOverrides =
        nextEventTemplateId
          ? (((currentConfig.eventTemplateOverrides as Record<string, unknown>) || {}) as any)
          : {};
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
                    : {})
                  ,
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
      const template = patch.templateId
        ? (program.eventTemplates || []).find((item) => item.id === patch.templateId)
        : null;
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
      normalizedPatch.closeOnOpenPatterns = (merged.closeOnOpenPatternBuilders || []).map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean);
    }
    if (Object.prototype.hasOwnProperty.call(merged, "closeChildrenOnClosePatternBuilders")) {
      normalizedPatch.closeChildrenOnClosePatterns = (merged.closeChildrenOnClosePatternBuilders || []).map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean);
    }
    applyProgramUpdate((prev) => ({
      ...prev,
      eventTemplates: (prev.eventTemplates || []).map((item) =>
        item.id === id ? { ...item, ...normalizedPatch } : item
      )
    }));
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "id")) {
      setSelectedEventTemplateId(String(normalizedPatch.id || ""));
      applyProgramUpdate((prev) => hydrateActiveFlow({
        ...prev,
        flowDefinitions: (prev.flowDefinitions || []).map((flow) => ({
          ...flow,
          nodes: (flow.nodes || []).map((node) =>
            (node.kind === "event_open" || node.kind === "event_close") && node.templateId === id
              ? { ...node, templateId: String(normalizedPatch.id || "") }
              : node
          )
        }))
      }, prev.activeFlowId));
    }
  };

  const removeEventTemplate = (id: string): void => {
    applyProgramUpdate((prev) => hydrateActiveFlow({
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
    }, prev.activeFlowId));
    if (selectedEventTemplateId === id) setSelectedEventTemplateId("");
  };

  const removeScriptTemplate = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      scriptTemplates: prev.scriptTemplates.filter((item) => item.id !== id)
    }));
  };

  const updateScriptTemplate = (
    id: string,
    patch: Partial<ScriptTemplateDefinition>
  ): void => {
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
      const hydrated = hydrateActiveFlow({
        ...prev,
        scriptTemplates: nextScriptTemplates,
        flowDefinitions: nextFlowDefinitions
      }, prev.activeFlowId);
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

  const updateTriggerTemplatePayload = (id: string, rawPayload: string): void => {
    const template = (program.triggerTemplates || []).find((item) => item.id === id);
    if (!template) return;
    updateTriggerTemplate(id, {
      message: { ...template.message, payload: parseMaybeJson(rawPayload) }
    });
  };

  const addLink = (link: FlowLink): void => {
    const exists = program.flows.links.some(
      (item) =>
        item.from === link.from &&
        item.to === link.to &&
        String(item.fromPort || "default") === String(link.fromPort || "default")
    );
    if (exists) return;
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: [...flow.links, { ...link, enabled: link.enabled !== false }]
    }));
  };

  const updateAssets = (
    updater: AssetFrameworkDefinition | ((assets: AssetFrameworkDefinition) => AssetFrameworkDefinition)
  ): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      assets: typeof updater === "function" ? updater(prev.assets) : updater
    }));
  };

  const updateLink = (index: number, patch: Partial<FlowLink>): void => {
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: flow.links.map((link, idx) => (idx === index ? { ...link, ...patch } : link))
    }));
  };

  const removeLink = (index: number): void => {
    applyActiveFlowUpdate((flow) => ({
      ...flow,
      links: flow.links.filter((_link, idx) => idx !== index)
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
        return;
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

  const handleDropPaletteItem = (item: FlowPaletteItem, position: NodePosition): void => {
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

  const headerActions = useMemo(
    () => (
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,.af.json,application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void importProgramJson(file);
          }}
        />
        <Button disabled={!canUndo} variant="outlined" onClick={() => dispatch({ type: "UNDO" })}>
          Undo
        </Button>
        <Button disabled={!canRedo} variant="outlined" onClick={() => dispatch({ type: "REDO" })}>
          Redo
        </Button>
        <Button variant="contained" onClick={saveProgram}>
          Save Program
        </Button>
        <Button variant="outlined" onClick={() => importInputRef.current?.click()}>
          Import Program (JSON)
        </Button>
        <Button variant="outlined" onClick={downloadProgramJson}>
          Export Program to JSON
        </Button>
      </Box>
    ),
    [canUndo, canRedo, program]
  );

  return (
    <Box sx={{ minHeight: "100vh", background: "linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%)" }}>
      <AppBar position="sticky" color="inherit" elevation={1}>
        <Toolbar variant="dense" sx={{ minHeight: "56px !important", gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap" }}>
            Asset Framework Editor
          </Typography>
          <TextField
            size="small"
            label="Program Name"
            value={program.meta.name}
            onChange={(e) =>
              applyProgramUpdate((prev) => ({
                ...prev,
                meta: { ...prev.meta, name: e.target.value }
              }))
            }
            sx={{ minWidth: 300, maxWidth: 520, flexGrow: 1 }}
          />
          {headerActions}
        </Toolbar>
        <Divider />
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label="Asset Manager" />
          <Tab label="Flow Manager" />
          <Tab label="Script Templates" />
          <Tab label="Event Templates" />
          <Tab label="DB Connection" />
          <Tab label="Event View" />
          <Tab label="Global Store" />
          <Tab label="Docs" />
        </Tabs>
      </AppBar>

      <Box sx={{ px: 1, py: 1 }}>
        {tab === 0 && (
          <AssetManager assets={program.assets} onChange={updateAssets} />
        )}
        {tab === 1 && (
          <FlowManager
            flows={program.flowDefinitions || []}
            selectedFlowId={program.activeFlowId || selectedFlowId}
            activeFlowVariables={activeFlow.variables || []}
            triggerIds={flowTriggerIds}
            triggerTemplates={program.triggerTemplates || []}
            actionIds={flowActionIds}
            eventNodeIds={flowEventNodeIds}
            scriptTemplates={program.scriptTemplates}
            eventTemplates={program.eventTemplates || []}
            nodeLabels={flowNodeLabels}
            nodeSubtitles={flowNodeSubtitles}
            nodeOutputs={flowNodeOutputs}
            links={program.flows.links}
            nodePositions={program.flows.nodePositions || {}}
            zoom={flowZoom}
            onZoomChange={setFlowZoom}
            onAddLink={addLink}
            onUpdateLink={updateLink}
            onRemoveLink={removeLink}
            onRemoveNodeFromFlow={removeNodeFromFlow}
            onDeleteNodes={deleteNodesFromFlow}
            onDuplicateNodes={duplicateNodesInFlow}
            onTriggerNodeDoubleClick={(triggerId) => {
              setInspectorTarget({ kind: "trigger", id: triggerId });
            }}
            onActionNodeDoubleClick={(actionId) => {
              setSelectedActionId(actionId);
              setInspectorTarget({ kind: "action", id: actionId });
            }}
            onEventNodeDoubleClick={(nodeId) => {
              const eventActionId = getBaseEventActionIdFromNode(nodeId);
              setSelectedEventActionId(eventActionId);
              setInspectorTarget({ kind: "event", id: nodeId });
            }}
            onNodePositionDragStart={() => dispatch({ type: "PUSH_SNAPSHOT" })}
            onNodePositionChange={updateNodePosition}
            onConnectNodes={(fromId, toId, fromPort) => addLink({ from: fromId, to: toId, fromPort, enabled: true })}
            onDropPaletteItem={handleDropPaletteItem}
            onSelectFlow={switchActiveFlow}
            onAddFlow={addFlowDefinition}
            onDuplicateFlow={duplicateFlowDefinition}
            onRemoveFlow={removeFlowDefinition}
            onUpdateFlow={updateFlowDefinition}
          />
        )}
        {tab === 2 && (
          <ActionManager
            actions={derivedActions}
            scriptTemplates={program.scriptTemplates}
            assets={program.assets}
            flowVariableNames={activeFlowVariableNames}
            selectedActionId={selectedActionId}
            selectedScriptTemplateId={selectedScriptTemplateId}
            onSelectAction={setSelectedActionId}
            onSelectScriptTemplate={setSelectedScriptTemplateId}
            onAddAction={addAction}
            onDuplicateAction={duplicateAction}
            onRemoveAction={removeAction}
            onRenameAction={renameAction}
            onUpdateAction={updateAction}
            onAddScriptTemplate={addScriptTemplate}
            onRemoveScriptTemplate={removeScriptTemplate}
            onUpdateScriptTemplate={updateScriptTemplate}
            templateOnly
          />
        )}
        {tab === 3 && (
          <EventDesignerManager
            eventActions={derivedEventActions}
            eventTemplates={program.eventTemplates || []}
            assets={program.assets}
            flowVariableNames={activeFlowVariableNames}
            selectedEventActionId={selectedEventActionId}
            selectedEventTemplateId={selectedEventTemplateId}
            onSelectEventAction={setSelectedEventActionId}
            onSelectEventTemplate={setSelectedEventTemplateId}
            onAddEventAction={addEventAction}
            onAddEventActionFromTemplate={addEventActionFromTemplate}
            onDuplicateEventAction={duplicateEventAction}
            onUpdateEventAction={updateEventAction}
            onRenameEventAction={renameEventAction}
            onRemoveEventAction={removeEventAction}
            onAddEventTemplate={addEventTemplate}
            onDuplicateEventTemplate={duplicateEventTemplate}
            onRemoveEventTemplate={removeEventTemplate}
            onUpdateEventTemplate={updateEventTemplate}
            templateOnly
          />
        )}
        {tab === 4 && <DbConnectionManager />}
        {tab === 5 && <EventManager />}
        {tab === 6 && <GlobalStoreManager onStatus={setStatus} />}
        {tab === 7 && <DocsManager />}
      </Box>

      <FlowNodeInspectorDrawer
        open={Boolean(inspectorTarget)}
        target={inspectorTarget}
        nodes={program.flows.nodes || []}
        scriptTemplates={program.scriptTemplates}
        eventTemplates={program.eventTemplates || []}
        assets={program.assets}
        watchPathOptions={watchPathOptions}
        eventWatchPathOptions={eventWatchPathOptions}
        flowVariableNames={activeFlowVariableNames}
        onOpenScriptTemplateManager={(templateId) => {
          setSelectedScriptTemplateId(templateId);
          setInspectorTarget(null);
          setTab(2);
        }}
        onOpenEventTemplateManager={(templateId) => {
          setSelectedEventTemplateId(templateId);
          setInspectorTarget(null);
          setTab(3);
        }}
        onClose={() => setInspectorTarget(null)}
        onRenameNode={(oldId, newId) => {
          const targetNode = (program.flows.nodes || []).find((node) => node.id === oldId);
          if (!targetNode) return;
          if (targetNode.kind === "action") {
            renameAction(oldId, newId);
            return;
          }
          if (targetNode.kind === "event_open" || targetNode.kind === "event_close") {
            renameEventAction(targetNode.refId, newId);
          }
        }}
        onUpdateNode={(id, patch) => {
          const targetNode = (program.flows.nodes || []).find((node) => node.id === id);
          if (!targetNode) return;
          if (targetNode.kind === "trigger") {
            const config = (patch.config || {}) as Record<string, unknown>;
            applyActiveFlowUpdate((flow) => ({
              ...flow,
              nodes: (flow.nodes || []).map((node) =>
                node.id === id && node.kind === "trigger"
                  ? {
                      ...node,
                      label: Object.prototype.hasOwnProperty.call(patch, "label") ? String(patch.label ?? "") : node.label,
                      enabled: Object.prototype.hasOwnProperty.call(patch, "enabled") ? patch.enabled !== false : node.enabled,
                      config: {
                        ...(node.config || {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "intervalMs") ? { intervalMs: Math.max(1, Number(config.intervalMs) || 1) } : {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "activeFrom") ? { activeFrom: String(config.activeFrom ?? "") } : {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "activeTo") ? { activeTo: String(config.activeTo ?? "") } : {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "watchPath") ? { watchPath: String(config.watchPath ?? "") } : {}),
                        ...(Object.prototype.hasOwnProperty.call(config, "message") ? { message: config.message } : {})
                      }
                    }
                  : node
              )
            }));
            return;
          }
          if (targetNode.kind === "action") {
            const config = (patch.config || {}) as Record<string, unknown>;
            updateAction(id, {
              ...(Object.prototype.hasOwnProperty.call(patch, "label") ? { label: patch.label } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "enabled") ? { enabled: patch.enabled } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "templateId") ? { templateId: patch.templateId } : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "script") ? { script: String(config.script ?? "") } : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "templateBindingOverrides")
                ? { templateBindingOverrides: (config.templateBindingOverrides as Record<string, any>) || {} }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "eventTemplateId")
                ? { eventTemplateId: String(config.eventTemplateId ?? "") }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "eventTemplateOverrides")
                ? { eventTemplateOverrides: (config.eventTemplateOverrides as Record<string, any>) || {} }
                : {})
            });
            return;
          }
          if (targetNode.kind === "event_open" || targetNode.kind === "event_close") {
            const config = (patch.config || {}) as Record<string, unknown>;
            updateEventAction(targetNode.refId, {
              ...(Object.prototype.hasOwnProperty.call(patch, "label")
                ? { label: String(patch.label ?? "") }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "enabled") ? { enabled: patch.enabled } : {}),
              ...(Object.prototype.hasOwnProperty.call(patch, "templateId") ? { templateId: patch.templateId } : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "description") ? { description: String(config.description ?? "") } : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "templateOverrides")
                ? { templateOverrides: (config.templateOverrides as Record<string, any>) || {} }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(config, "bindings")
                ? { bindings: (config.bindings as Record<string, any>) || {} }
                : {}),
              ...(targetNode.kind === "event_open" && Object.prototype.hasOwnProperty.call(config, "openNotes")
                ? { openNotes: String(config.openNotes ?? "") }
                : {}),
              ...(targetNode.kind === "event_close" && Object.prototype.hasOwnProperty.call(config, "closeNotes")
                ? { closeNotes: String(config.closeNotes ?? "") }
                : {})
            });
          }
        }}
      />
      <Snackbar
        open={toast.open}
        autoHideDuration={2800}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
