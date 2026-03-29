import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Divider,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography
} from "@mui/material";
import TriggerManager from "../components/managers/TriggerManager";
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
  EventTemplateDefinition,
  FlowNodeDefinition,
  FlowLink,
  Program,
  ScriptNodeSummary,
  ScriptTemplateDefinition,
  EventNodeSummary,
  TriggerDefinition,
  NodePosition
} from "../types/program";
import type { FlowPaletteItem } from "../components/managers/FlowDiagram";

const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  eventTemplates: [],
  triggers: [],
  scriptTemplates: [],
  flows: { nodes: [], links: [] },
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
  const [tab, setTab] = useState(2);
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: EMPTY_PROGRAM,
    future: []
  });
  const [selectedTriggerId, setSelectedTriggerId] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [selectedEventActionId, setSelectedEventActionId] = useState("");
  const [selectedEventTemplateId, setSelectedEventTemplateId] = useState("");
  const [inspectorTarget, setInspectorTarget] = useState<{ kind: "action" | "event"; id: string } | null>(null);
  const [flowZoom, setFlowZoom] = useState(0.5);
  const [status, setStatus] = useState("Loading...");
  const latestActionScriptsRef = useRef<Record<string, string>>({});

  const program = history.present;
  const flowNodes = program.flows.nodes || [];
  const derivedActions = useMemo(() => deriveScriptNodeSummaries(flowNodes), [flowNodes]);
  const derivedEventActions = useMemo(() => deriveEventNodeSummaries(flowNodes), [flowNodes]);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

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

  useEffect(() => {
    fetch("/api/program")
      .then((res) => res.json())
      .then((data: { program?: Program }) => {
        const next = normalizeProgram(data.program ?? EMPTY_PROGRAM);
        latestActionScriptsRef.current = Object.fromEntries(
          deriveScriptNodeSummaries(next.flows.nodes || []).map((action) => [action.id, action.script || ""])
        );
        dispatch({ type: "INIT", program: next });
        setSelectedTriggerId(next.triggers[0]?.id ?? "");
        setSelectedActionId((next.flows.nodes || []).find((node) => node.kind === "action")?.id ?? "");
        setSelectedEventActionId((next.flows.nodes || []).find((node) => node.kind === "event_open")?.refId ?? "");
        setSelectedEventTemplateId(next.eventTemplates?.[0]?.id ?? "");
        setStatus("Program loaded");
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

  const saveProgram = async () => {
    const programForSave: Program = {
      ...program,
      assets: {
        ...program.assets,
        assets: (program.assets?.assets || []).map((asset) => ({
          ...asset,
          // Workspace save must not persist runtime attribute values.
          attributes: {}
        }))
      },
      flows: {
        ...(program.flows || { links: [] }),
        nodes: ((program.flows?.nodes || []) as FlowNodeDefinition[]).map((node) =>
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
    };

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

  const buildProgramForExport = (): Program => ({
    ...program,
    flows: {
      ...(program.flows || { links: [] }),
      nodes: ((program.flows?.nodes || []) as FlowNodeDefinition[]).map((node) =>
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
  });

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

  const addTriggerWithType = (type: TriggerDefinition["type"]): void => {
    const id =
      type !== "interval"
        ? `trigger.watch_${Date.now()}`
        : `trigger.tick_${Date.now()}`;
    const defaultWatchPath =
      type === "watcher_set" || type === "watcher_valuechange"
        ? "*.*.*"
        : type === "watcher_event_falling"
          ? "*"
          : "";
    const next: TriggerDefinition = {
      id,
      label: "",
      type,
      enabled: true,
      intervalMs: 1000,
      watchPath: defaultWatchPath,
      message: { payload: 0 }
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: [...prev.triggers, next],
      flows: {
        ...prev.flows,
        nodes: [
          ...(prev.flows.nodes || []),
          {
            id,
            kind: "trigger",
            refId: id,
            label: "",
            enabled: true,
            config: {
              type,
              watchPath: defaultWatchPath,
              intervalMs: 1000,
              cronExpression: "",
              timezone: "",
              activeFrom: "",
              activeTo: ""
            }
          }
        ]
      }
    }));
    setSelectedTriggerId(id);
  };

  const addAction = (parentPath?: string): void => {
    const safeParent = (parentPath || "scripts.group")
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(".");
    const id = `${safeParent}.action_${Date.now()}`;
    const nextNode: FlowNodeDefinition = {
      id,
      label: "",
      kind: "action",
      refId: id,
      enabled: true,
      templateId: "",
      config: {
        description: "",
        script: "send(msg);",
        templateBindingOverrides: {},
        eventTemplateId: "",
        eventTemplateOverrides: {}
      }
    };
    latestActionScriptsRef.current[id] = "send(msg);";
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: { ...prev.flows, nodes: [...(prev.flows.nodes || []), nextNode] }
    }));
    setSelectedActionId(id);
  };

  const createActionFromTemplateInFlow = (templateId: string, position: NodePosition): void => {
    const template = program.scriptTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const baseName = (template.name || template.id || "script")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const id = `flow.scripts.${baseName || "script"}_${Date.now()}`;
    const nextNode: FlowNodeDefinition = {
      id,
      label: template.name || "",
      kind: "action",
      refId: id,
      enabled: true,
      templateId: template.id,
      config: {
        description: template.description || "",
        script: template.script || "send(msg);",
        templateBindingOverrides: {}
      }
    };
    latestActionScriptsRef.current[id] = String((nextNode.config as Record<string, unknown>).script || "");
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [...(prev.flows.nodes || []), nextNode],
        nodePositions: { ...(prev.flows.nodePositions || {}), [id]: position }
      }
    }));
    setSelectedActionId(id);
    setInspectorTarget({ kind: "action", id });
    setStatus(`Script node created from template "${template.name}"`);
  };

  const addEventAction = (): void => {
    const id = `events.group.event_${Date.now()}`;
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [
          ...(prev.flows.nodes || []),
          {
            id: openNodeId,
            label: `OPEN ${id}`,
            kind: "event_open",
            refId: id,
            enabled: true,
            templateId: "",
            config: { description: "", bindings: {}, templateOverrides: {}, openNotes: "" }
          },
          {
            id: closeNodeId,
            label: `CLOSE ${id}`,
            kind: "event_close",
            refId: id,
            enabled: true,
            templateId: "",
            config: { description: "", bindings: {}, templateOverrides: {}, closeNotes: "" }
          }
        ]
      }
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

    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [
          ...(prev.flows.nodes || []),
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
      }
    }));
    setSelectedEventActionId(candidateId);
    setStatus(`Event action duplicated: ${candidateId}`);
  };

  const addEventActionFromTemplate = (templateId: string): void => {
    const template = (program.eventTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    const id = `events.group.${templateId}_${Date.now()}`;
    const bindings = Object.fromEntries(
      collectTemplateVariables(template).map((key) => [key, defaultEventBindingForVariable(key)])
    );
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [
          ...(prev.flows.nodes || []),
          {
            id: openNodeId,
            label: `OPEN ${template.id}`,
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
            label: `CLOSE ${template.id}`,
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
      }
    }));
    setSelectedEventActionId(id);
  };

  const createEventActionFromTemplateInFlow = (templateId: string, position: NodePosition): void => {
    const template = (program.eventTemplates || []).find((item) => item.id === templateId);
    if (!template) return;
    const id = `flow.events.${templateId.replace(/[^a-zA-Z0-9]+/g, "_")}_${Date.now()}`;
    const bindings = Object.fromEntries(
      collectTemplateVariables(template).map((key) => [key, defaultEventBindingForVariable(key)])
    );
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    const openNode: FlowNodeDefinition = {
      id: openNodeId,
      kind: "event_open",
      refId: id,
      label: `OPEN ${template.id}`,
      enabled: true,
      templateId: template.id,
      config: {
        description: `Event node for template ${template.id}`,
        bindings,
        templateOverrides: {},
        openNotes: ""
      }
    };
    const closeNode: FlowNodeDefinition = {
      id: closeNodeId,
      kind: "event_close",
      refId: id,
      label: `CLOSE ${template.id}`,
      enabled: true,
      templateId: template.id,
      config: {
        description: `Event node for template ${template.id}`,
        bindings,
        templateOverrides: {},
        closeNotes: ""
      }
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [...(prev.flows.nodes || []), openNode, closeNode],
        nodePositions: {
          ...(prev.flows.nodePositions || {}),
          [openNodeId]: position,
          [closeNodeId]: { x: position.x, y: position.y + 110 }
        }
      }
    }));
    setSelectedEventActionId(id);
    setInspectorTarget({ kind: "event", id });
    setStatus(`Event node created from template "${template.id}"`);
  };

  const duplicateAction = (id: string): void => {
    const source = flowNodes.find((item) => item.kind === "action" && item.id === id);
    if (!source) return;
    const sourceTemplate = source.templateId
      ? program.scriptTemplates.find((item) => item.id === source.templateId)
      : null;
    if (sourceTemplate && sourceTemplate.allowTemplateReuse === false) {
      setStatus(`Duplicate blocked: template "${sourceTemplate.name}" does not allow template reuse`);
      return;
    }

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

    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [...(prev.flows.nodes || []), next]
      }
    }));
    setSelectedActionId(candidateId);
    setStatus(`Action duplicated: ${candidateId}`);
  };

  const removeTrigger = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((item) => item.id !== id),
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).filter((item) => item.id !== id),
        links: removeNodeFromLinks(prev.flows.links, id),
        nodePositions: (() => {
          const next = { ...(prev.flows.nodePositions || {}) };
          delete next[id];
          return next;
        })()
      }
    }));
    if (selectedTriggerId === id) setSelectedTriggerId("");
  };

  const removeAction = (id: string): void => {
    delete latestActionScriptsRef.current[id];
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).filter((item) => item.id !== id),
        links: removeNodeFromLinks(prev.flows.links, id),
        nodePositions: (() => {
          const next = { ...(prev.flows.nodePositions || {}) };
          delete next[id];
          return next;
        })()
      }
    }));
    if (selectedActionId === id) setSelectedActionId("");
    if (inspectorTarget?.kind === "action" && inspectorTarget.id === id) setInspectorTarget(null);
  };

  const removeEventAction = (id: string): void => {
    const openNodeId = getEventActionOpenNodeId(id);
    const closeNodeId = getEventActionCloseNodeId(id);
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).filter((item) => item.refId !== id),
        links: removeNodeFromLinks(removeNodeFromLinks(prev.flows.links, openNodeId), closeNodeId),
        nodePositions: (() => {
          const next = { ...(prev.flows.nodePositions || {}) };
          delete next[openNodeId];
          delete next[closeNodeId];
          return next;
        })()
      }
    }));
    if (selectedEventActionId === id) setSelectedEventActionId("");
    if (inspectorTarget?.kind === "event" && inspectorTarget.id === id) setInspectorTarget(null);
  };

  const renameTrigger = (oldId: string, newId: string): void => {
    setSelectedTriggerId(newId);
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: upsertById(prev.triggers, oldId, { id: newId }),
      flows: {
        ...prev.flows,
        links: renameNodeInLinks(prev.flows.links, oldId, newId),
        nodePositions: renameNodePositionKey(prev.flows.nodePositions, oldId, newId)
      }
    }));
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
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) =>
          node.id === oldId ? { ...node, id: newId, refId: newId } : node
        ),
        links: renameNodeInLinks(prev.flows.links, oldId, newId),
        nodePositions: renameNodePositionKey(prev.flows.nodePositions, oldId, newId)
      }
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
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) => {
          if (node.refId !== oldId) return node;
          return {
            ...node,
            id: node.kind === "event_open" ? nextOpen : nextClose,
            refId: normalizedNewId
          };
        }),
        links: renameNodeInLinks(
          renameNodeInLinks(prev.flows.links, oldOpen, nextOpen),
          oldClose,
          nextClose
        ),
        nodePositions: renameNodePositionKey(
          renameNodePositionKey(prev.flows.nodePositions, oldOpen, nextOpen),
          oldClose,
          nextClose
        )
      }
    }));
  };

  const flowNodeLabels = useMemo(
    () =>
      Object.fromEntries(
        (program.flows?.nodes || []).map((node) => [node.id, (node.label || node.id).trim() || node.id]) as Array<[string, string]>
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
    for (const trigger of program.triggers) {
      if (trigger.type !== "watcher_event_falling") continue;
      const pattern = String(trigger.watchPath || "").trim();
      if (!pattern) continue;
      options.add(pattern);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [program.triggers]);

  const updateTrigger = (id: string, patch: Partial<TriggerDefinition>): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: upsertById(prev.triggers, id, patch),
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) =>
          node.id === id && node.kind === "trigger"
            ? {
                ...node,
                label: Object.prototype.hasOwnProperty.call(patch, "label") ? patch.label ?? "" : node.label,
                enabled: Object.prototype.hasOwnProperty.call(patch, "enabled") ? patch.enabled !== false : node.enabled,
                config: {
                  ...(node.config || {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "type") ? { type: patch.type } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "watchPath") ? { watchPath: patch.watchPath ?? "" } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "intervalMs") ? { intervalMs: patch.intervalMs } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "cronExpression") ? { cronExpression: patch.cronExpression ?? "" } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "timezone") ? { timezone: patch.timezone ?? "" } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "activeFrom") ? { activeFrom: patch.activeFrom ?? "" } : {}),
                  ...(Object.prototype.hasOwnProperty.call(patch, "activeTo") ? { activeTo: patch.activeTo ?? "" } : {})
                }
              }
            : node
        )
      }
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
      if (
        nextTemplateId &&
        template &&
        template.allowTemplateReuse === false &&
        flowNodes.some((item) => item.kind === "action" && item.id !== id && item.templateId === nextTemplateId)
      ) {
        setStatus(`Template "${template.name}" is singleton and already used by another action`);
        return;
      }
      const currentConfig = (current.config || {}) as Record<string, unknown>;
      resolvedPatch.script = template ? template.script : patch.script ?? String(currentConfig.script ?? "");
      resolvedPatch.templateBindingOverrides =
        nextTemplateId
          ? (((currentConfig.templateBindingOverrides as Record<string, unknown>) || {}) as any)
          : {};
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
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) =>
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
                }
              }
            : node
        )
      }
    }));
  };

  const updateEventAction = (id: string, patch: Partial<EventNodeSummary>): void => {
    const currentOpen = flowNodes.find((item) => item.kind === "event_open" && item.refId === id);
    const currentClose = flowNodes.find((item) => item.kind === "event_close" && item.refId === id);
    if (!currentOpen || !currentClose) return;
    const resolvedPatch: Partial<EventNodeSummary> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "templateId")) {
      const currentConfig = (currentOpen.config || {}) as Record<string, unknown>;
      resolvedPatch.bindings = patch.templateId ? (((currentConfig.bindings as Record<string, unknown>) || {}) as any) : {};
    }
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) => {
          if (node.refId !== id || (node.kind !== "event_open" && node.kind !== "event_close")) return node;
          const isOpen = node.kind === "event_open";
          return {
            ...node,
            label: Object.prototype.hasOwnProperty.call(resolvedPatch, "label")
              ? `${isOpen ? "OPEN" : "CLOSE"} ${resolvedPatch.label || id}`
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
      }
    }));
  };

  const addScriptTemplate = (): void => {
    const id = `template.script_${Date.now()}`;
    const next: ScriptTemplateDefinition = {
      id,
      name: `Script Template ${program.scriptTemplates.length + 1}`,
      description: "",
      script: "send(msg);",
      allowTemplateReuse: true,
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
      applyProgramUpdate((prev) => ({
        ...prev,
        flows: {
          ...prev.flows,
          nodes: (prev.flows.nodes || []).map((node) =>
            (node.kind === "event_open" || node.kind === "event_close") && node.templateId === id
              ? { ...node, templateId: String(normalizedPatch.id || "") }
              : node
          )
        }
      }));
    }
  };

  const removeEventTemplate = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      eventTemplates: (prev.eventTemplates || []).filter((item) => item.id !== id),
      flows: {
        ...prev.flows,
        nodes: (prev.flows.nodes || []).map((node) =>
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
      }
    }));
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
    if (patch.allowTemplateReuse === false) {
      const usageCount = flowNodes.filter((node) => node.kind === "action" && node.templateId === id).length;
      if (usageCount > 1) {
        const templateName = program.scriptTemplates.find((item) => item.id === id)?.name || id;
        setStatus(`Cannot disable template reuse: template "${templateName}" is used by ${usageCount} actions`);
        return;
      }
    }
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
      const nextNodes = (prev.flows.nodes || []).map((node) =>
        node.kind === "action" && node.templateId === id
          ? {
              ...node,
              config: {
                ...(node.config || {}),
                script: updatedTemplate.script
              }
            }
          : node
      );
      for (const node of nextNodes) {
        if (node.kind !== "action" || node.templateId !== id) continue;
        latestActionScriptsRef.current[node.id] = String(((node.config || {}) as Record<string, unknown>).script || "");
      }
      return {
        ...prev,
        scriptTemplates: nextScriptTemplates,
        flows: {
          ...prev.flows,
          nodes: nextNodes
        }
      };
    });
  };

  const updateTriggerPayload = (id: string, rawPayload: string): void => {
    const trigger = program.triggers.find((item) => item.id === id);
    if (!trigger) return;
    updateTrigger(id, {
      message: { ...trigger.message, payload: parseMaybeJson(rawPayload) }
    });
  };

  const addLink = (link: FlowLink): void => {
    const exists = program.flows.links.some(
      (item) => item.from === link.from && item.to === link.to
    );
    if (exists) return;
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: { ...prev.flows, links: [...prev.flows.links, { ...link, enabled: link.enabled !== false }] }
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
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        links: prev.flows.links.map((link, idx) => (idx === index ? { ...link, ...patch } : link))
      }
    }));
  };

  const removeLink = (index: number): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      flows: { ...prev.flows, links: prev.flows.links.filter((_link, idx) => idx !== index) }
    }));
  };

  const updateNodePosition = (nodeId: string, position: { x: number; y: number }): void => {
    applyProgramNoHistory((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodePositions: { ...(prev.flows.nodePositions || {}), [nodeId]: position }
      }
    }));
  };

  const removeNodeFromFlow = (nodeId: string): void => {
    applyProgramUpdate((prev) => {
      const nextPositions = { ...(prev.flows.nodePositions || {}) };
      delete nextPositions[nodeId];
      return {
        ...prev,
        flows: {
          ...prev.flows,
          links: prev.flows.links.filter((link) => link.from !== nodeId && link.to !== nodeId),
          nodePositions: nextPositions
        }
      };
    });
  };

  const deleteNodesFromFlow = (nodeIds: string[]): void => {
    const uniqueIds = Array.from(new Set(nodeIds));
    const nodesById = new Map((program.flows.nodes || []).map((node) => [node.id, node] as const));
    const actionIds = uniqueIds.filter((id) => nodesById.get(id)?.kind === "action");
    const eventActionIds = Array.from(new Set(uniqueIds.map((id) => nodesById.get(id)?.refId).filter(Boolean) as string[]));
    const triggerIds = uniqueIds.filter((id) => nodesById.get(id)?.kind === "trigger");

    actionIds.forEach((id) => delete latestActionScriptsRef.current[id]);

    applyProgramUpdate((prev) => {
      const nextPositions = { ...(prev.flows.nodePositions || {}) };
      uniqueIds.forEach((id) => delete nextPositions[id]);
      const remainingNodes = (prev.flows.nodes || []).filter((node) => {
        if (uniqueIds.includes(node.id)) return false;
        if (eventActionIds.includes(node.refId) && (node.kind === "event_open" || node.kind === "event_close")) return false;
        return true;
      });
      remainingNodes.forEach((node) => {
        if (!nextPositions[node.id]) return;
      });
      return {
        ...prev,
        flows: {
          ...prev.flows,
          nodes: remainingNodes,
          links: prev.flows.links.filter((link) => {
            if (uniqueIds.includes(link.from) || uniqueIds.includes(link.to)) return false;
            if (eventActionIds.some((id) => [getEventActionOpenNodeId(id), getEventActionCloseNodeId(id)].includes(link.from))) return false;
            if (eventActionIds.some((id) => [getEventActionOpenNodeId(id), getEventActionCloseNodeId(id)].includes(link.to))) return false;
            return true;
          }),
          nodePositions: nextPositions
        }
      };
    });

    if (inspectorTarget?.kind === "action" && actionIds.includes(inspectorTarget.id)) setInspectorTarget(null);
    if (inspectorTarget?.kind === "event" && eventActionIds.includes(inspectorTarget.id)) setInspectorTarget(null);
    if (selectedActionId && actionIds.includes(selectedActionId)) setSelectedActionId("");
    if (selectedEventActionId && eventActionIds.includes(selectedEventActionId)) setSelectedEventActionId("");
    if (triggerIds.length > 0) setStatus(`Removed ${actionIds.length} script node(s), ${eventActionIds.length} event node(s), ${triggerIds.length} trigger placement(s)`);
  };

  const duplicateNodesInFlow = (nodeIds: string[], basePosition?: NodePosition): void => {
    const uniqueIds = Array.from(new Set(nodeIds));
    if (uniqueIds.length === 0) return;
    const timestamp = Date.now();
    const nextNodes: FlowNodeDefinition[] = [];
    const nextPositions: Record<string, NodePosition> = {};
    const duplicatedNodeMap = new Map<string, string>();
    let actionCount = 0;
    let eventCount = 0;
    const nodesById = new Map((program.flows.nodes || []).map((node) => [node.id, node] as const));

    uniqueIds.forEach((nodeId, index) => {
      const offset = 40 * (index + 1);
      const action = nodesById.get(nodeId);
      if (action?.kind === "action") {
        const nextId = `${nodeId}_copy_${timestamp + index}`;
        const position = program.flows.nodePositions?.[nodeId];
        nextNodes.push({
          ...structuredClone(action),
          id: nextId,
          refId: nextId,
          label: action.label ? `${action.label} Copy` : ""
        });
        duplicatedNodeMap.set(nodeId, nextId);
        latestActionScriptsRef.current[nextId] = String(((action.config || {}) as Record<string, unknown>).script || "");
        if (basePosition) nextPositions[nextId] = { x: basePosition.x + offset, y: basePosition.y + offset };
        else if (position) nextPositions[nextId] = { x: position.x + offset, y: position.y + offset };
        actionCount += 1;
        return;
      }

      if (action?.kind === "event_open" || action?.kind === "event_close") {
        const baseId = action.refId;
        if (nextNodes.some((item) => item.refId === `${baseId}_copy_${timestamp + index}`)) return;
        const sourceOpen = (program.flows.nodes || []).find((item) => item.kind === "event_open" && item.refId === baseId);
        const sourceClose = (program.flows.nodes || []).find((item) => item.kind === "event_close" && item.refId === baseId);
        if (!sourceOpen || !sourceClose) return;
        const nextId = `${baseId}_copy_${timestamp + index}`;
        nextNodes.push({
          ...structuredClone(sourceOpen),
          id: getEventActionOpenNodeId(nextId),
          refId: nextId,
          label: sourceOpen.label ? `${sourceOpen.label} Copy` : ""
        });
        nextNodes.push({
          ...structuredClone(sourceClose),
          id: getEventActionCloseNodeId(nextId),
          refId: nextId,
          label: sourceClose.label ? `${sourceClose.label} Copy` : ""
        });
        duplicatedNodeMap.set(getEventActionOpenNodeId(baseId), getEventActionOpenNodeId(nextId));
        duplicatedNodeMap.set(getEventActionCloseNodeId(baseId), getEventActionCloseNodeId(nextId));
        const openPos = program.flows.nodePositions?.[getEventActionOpenNodeId(baseId)];
        const closePos = program.flows.nodePositions?.[getEventActionCloseNodeId(baseId)];
        if (basePosition) {
          nextPositions[getEventActionOpenNodeId(nextId)] = { x: basePosition.x + offset, y: basePosition.y + offset };
          nextPositions[getEventActionCloseNodeId(nextId)] = { x: basePosition.x + offset, y: basePosition.y + offset + 110 };
        } else {
          if (openPos) nextPositions[getEventActionOpenNodeId(nextId)] = { x: openPos.x + offset, y: openPos.y + offset };
          if (closePos) nextPositions[getEventActionCloseNodeId(nextId)] = { x: closePos.x + offset, y: closePos.y + offset };
        }
        eventCount += 1;
      }
    });

    if (nextNodes.length === 0) {
      setStatus("Only script/event nodes can be pasted right now.");
      return;
    }

    applyProgramUpdate((prev) => ({
      ...prev,
      flows: {
        ...prev.flows,
        nodes: [...(prev.flows.nodes || []), ...nextNodes],
        links: [
          ...prev.flows.links,
          ...prev.flows.links
            .filter((link) => duplicatedNodeMap.has(link.from) && duplicatedNodeMap.has(link.to))
            .map((link) => ({
              ...link,
              from: duplicatedNodeMap.get(link.from) || link.from,
              to: duplicatedNodeMap.get(link.to) || link.to
            }))
        ],
        nodePositions: {
          ...(prev.flows.nodePositions || {}),
          ...nextPositions
        }
      }
    }));
    setStatus(`Pasted ${actionCount} script node(s) and ${eventCount} event node(s)`);
  };

  const handleDropPaletteItem = (item: FlowPaletteItem, position: NodePosition): void => {
    if (item.type === "existing-node") {
      updateNodePosition(item.nodeId, position);
      return;
    }
    if (item.type === "script-template") {
      createActionFromTemplateInFlow(item.templateId, position);
      return;
    }
    if (item.type === "event-template") {
      createEventActionFromTemplateInFlow(item.templateId, position);
    }
  };

  const headerActions = useMemo(
    () => (
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button disabled={!canUndo} variant="outlined" onClick={() => dispatch({ type: "UNDO" })}>
          Undo
        </Button>
        <Button disabled={!canRedo} variant="outlined" onClick={() => dispatch({ type: "REDO" })}>
          Redo
        </Button>
        <Button variant="contained" onClick={saveProgram}>
          Save JSON
        </Button>
        <Button variant="outlined" onClick={downloadProgramJson}>
          Download JSON
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
          <Typography variant="caption" sx={{ color: "#475569", minWidth: 170, textAlign: "right" }}>
            {status}
          </Typography>
          {headerActions}
        </Toolbar>
        <Divider />
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab label="Asset Manager" />
          <Tab label="Trigger Manager" />
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
          <TriggerManager
            triggers={program.triggers}
            watchPathOptions={watchPathOptions}
            eventWatchPathOptions={eventWatchPathOptions}
            selectedTriggerId={selectedTriggerId}
            onSelectTrigger={setSelectedTriggerId}
            onAddTrigger={addTriggerWithType}
            onRemoveTrigger={removeTrigger}
            onRenameTrigger={renameTrigger}
            onUpdateTrigger={updateTrigger}
            onUpdateTriggerPayload={updateTriggerPayload}
          />
        )}
        {tab === 2 && (
          <FlowManager
            triggerIds={flowTriggerIds}
            actionIds={flowActionIds}
            eventNodeIds={flowEventNodeIds}
            scriptTemplates={program.scriptTemplates}
            eventTemplates={program.eventTemplates || []}
            nodeLabels={flowNodeLabels}
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
            onActionNodeDoubleClick={(actionId) => {
              setSelectedActionId(actionId);
              setInspectorTarget({ kind: "action", id: actionId });
            }}
            onEventNodeDoubleClick={(nodeId) => {
              const eventActionId = getBaseEventActionIdFromNode(nodeId);
              setSelectedEventActionId(eventActionId);
              setInspectorTarget({ kind: "event", id: eventActionId });
            }}
            onNodePositionDragStart={() => dispatch({ type: "PUSH_SNAPSHOT" })}
            onNodePositionChange={updateNodePosition}
            onConnectNodes={(fromId, toId, fromPort) => addLink({ from: fromId, to: toId, fromPort, enabled: true })}
            onDropPaletteItem={handleDropPaletteItem}
          />
        )}
        {tab === 3 && (
          <ActionManager
            actions={derivedActions}
            scriptTemplates={program.scriptTemplates}
            assets={program.assets}
            selectedActionId={selectedActionId}
            onSelectAction={setSelectedActionId}
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
        {tab === 4 && (
          <EventDesignerManager
            eventActions={derivedEventActions}
            eventTemplates={program.eventTemplates || []}
            assets={program.assets}
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
        {tab === 5 && <DbConnectionManager />}
        {tab === 6 && <EventManager />}
        {tab === 7 && <GlobalStoreManager onStatus={setStatus} />}
        {tab === 8 && <DocsManager />}
      </Box>

      <FlowNodeInspectorDrawer
        open={Boolean(inspectorTarget)}
        target={inspectorTarget}
        nodes={program.flows.nodes || []}
        scriptTemplates={program.scriptTemplates}
        eventTemplates={program.eventTemplates || []}
        assets={program.assets}
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
                ? { label: String(patch.label ?? "").replace(/^OPEN\s+|^CLOSE\s+/i, "") }
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
    </Box>
  );
}
