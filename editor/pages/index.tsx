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
import FlowManager from "../components/managers/FlowManager";
import AssetManager from "../components/managers/AssetManager";
import {
  normalizeProgram,
  parseMaybeJson,
  removeNodeFromLinks,
  renameNodePositionKey,
  renameNodeInLinks,
  upsertById
} from "../lib/programUtils";
import type {
  ActionDefinition,
  AssetFrameworkDefinition,
  FlowLink,
  Program,
  ScriptTemplateDefinition,
  TriggerDefinition
} from "../types/program";

const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  triggers: [],
  actions: [],
  scriptTemplates: [],
  flows: { links: [] },
  assets: { assets: [], attributeTemplates: [] }
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

const MAX_HISTORY = 200;

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "INIT") {
    return { past: [], present: action.program, future: [] };
  }

  if (action.type === "APPLY") {
    const next = action.updater(state.present);
    if (next === state.present) return state;
    const nextPast = [...state.past, state.present];
    return {
      past: nextPast.slice(Math.max(0, nextPast.length - MAX_HISTORY)),
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
    const nextPast = [...state.past, state.present];
    return {
      ...state,
      past: nextPast.slice(Math.max(0, nextPast.length - MAX_HISTORY)),
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
    return {
      past: [...state.past, state.present].slice(
        Math.max(0, state.past.length + 1 - MAX_HISTORY)
      ),
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
  const [selectedTriggerId, setSelectedTriggerId] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [flowZoom, setFlowZoom] = useState(0.5);
  const [status, setStatus] = useState("Loading...");
  const latestActionScriptsRef = useRef<Record<string, string>>({});

  const program = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const applyProgramUpdate = (updater: ProgramUpdater) => {
    dispatch({ type: "APPLY", updater });
  };

  const applyProgramNoHistory = (updater: ProgramUpdater) => {
    dispatch({ type: "APPLY_NO_HISTORY", updater });
  };

  useEffect(() => {
    fetch("/api/program")
      .then((res) => res.json())
      .then((data: { program?: Program }) => {
        const next = normalizeProgram(data.program ?? EMPTY_PROGRAM);
        latestActionScriptsRef.current = Object.fromEntries(
          next.actions.map((action) => [action.id, action.script || ""])
        );
        dispatch({ type: "INIT", program: next });
        setSelectedTriggerId(next.triggers[0]?.id ?? "");
        setSelectedActionId(next.actions[0]?.id ?? "");
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
      actions: program.actions.map((action) => ({
        ...action,
        script:
          latestActionScriptsRef.current[action.id] !== undefined
            ? latestActionScriptsRef.current[action.id]
            : action.script
      }))
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
    actions: program.actions.map((action) => ({
      ...action,
      script:
        latestActionScriptsRef.current[action.id] !== undefined
          ? latestActionScriptsRef.current[action.id]
          : action.script
    }))
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
      type === "watcher"
        ? `trigger.watch_${Date.now()}`
        : `trigger.tick_${Date.now()}`;
    const next: TriggerDefinition = {
      id,
      label: "",
      type,
      enabled: true,
      intervalMs: 1000,
      watchPath: type === "watcher" ? "*.*.*" : "",
      message: { payload: 0 }
    };
    applyProgramUpdate((prev) => ({ ...prev, triggers: [...prev.triggers, next] }));
    setSelectedTriggerId(id);
  };

  const addAction = (parentPath?: string): void => {
    const safeParent = (parentPath || "scripts.group")
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join(".");
    const id = `${safeParent}.action_${Date.now()}`;
    const next: ActionDefinition = {
      id,
      label: "",
      type: "script",
      enabled: true,
      description: "",
      script: "send(msg);"
    };
    latestActionScriptsRef.current[id] = next.script;
    applyProgramUpdate((prev) => ({ ...prev, actions: [...prev.actions, next] }));
    setSelectedActionId(id);
  };

  const removeTrigger = (id: string): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((item) => item.id !== id),
      flows: { ...prev.flows, links: removeNodeFromLinks(prev.flows.links, id) }
    }));
    if (selectedTriggerId === id) setSelectedTriggerId("");
  };

  const removeAction = (id: string): void => {
    delete latestActionScriptsRef.current[id];
    applyProgramUpdate((prev) => ({
      ...prev,
      actions: prev.actions.filter((item) => item.id !== id),
      flows: { ...prev.flows, links: removeNodeFromLinks(prev.flows.links, id) }
    }));
    if (selectedActionId === id) setSelectedActionId("");
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
    applyProgramUpdate((prev) => ({
      ...prev,
      actions: upsertById(prev.actions, oldId, { id: newId }),
      flows: {
        ...prev.flows,
        links: renameNodeInLinks(prev.flows.links, oldId, newId),
        nodePositions: renameNodePositionKey(prev.flows.nodePositions, oldId, newId)
      }
    }));
  };

  const flowNodeLabels = useMemo(
    () =>
      Object.fromEntries([
        ...program.triggers.map((item) => [item.id, (item.label || item.id).trim() || item.id]),
        ...program.actions.map((item) => [item.id, (item.label || item.id).trim() || item.id])
      ]),
    [program.actions, program.triggers]
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

  const updateTrigger = (id: string, patch: Partial<TriggerDefinition>): void => {
    applyProgramUpdate((prev) => ({
      ...prev,
      triggers: upsertById(prev.triggers, id, patch)
    }));
  };

  const updateAction = (id: string, patch: Partial<ActionDefinition>): void => {
    if (typeof patch.script === "string") {
      latestActionScriptsRef.current[id] = patch.script;
    }
    const resolvedPatch: Partial<ActionDefinition> = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "templateId")) {
      const nextTemplateId = patch.templateId;
      const template = nextTemplateId
        ? program.scriptTemplates.find((item) => item.id === nextTemplateId)
        : null;
      const current = program.actions.find((item) => item.id === id);
      resolvedPatch.script = template ? template.script : patch.script ?? current?.script ?? "";
      resolvedPatch.templateBindingOverrides = nextTemplateId ? current?.templateBindingOverrides || {} : {};
      latestActionScriptsRef.current[id] = resolvedPatch.script;
    }
    applyProgramUpdate((prev) => ({
      ...prev,
      actions: upsertById(prev.actions, id, resolvedPatch)
    }));
  };

  const addScriptTemplate = (): void => {
    const id = `template.script_${Date.now()}`;
    const next: ScriptTemplateDefinition = {
      id,
      name: `Script Template ${program.scriptTemplates.length + 1}`,
      description: "",
      script: "send(msg);",
      variableBindings: []
    };
    applyProgramUpdate((prev) => ({
      ...prev,
      scriptTemplates: [...prev.scriptTemplates, next]
    }));
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
      const nextActions = prev.actions.map((action) =>
        action.templateId === id
          ? {
              ...action,
              script: updatedTemplate.script
            }
          : action
      );
      for (const action of nextActions) {
        latestActionScriptsRef.current[action.id] = action.script || "";
      }
      return {
        ...prev,
        scriptTemplates: nextScriptTemplates,
        actions: nextActions
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
          <Tab label="Trigger Manager" />
          <Tab label="Action Script Manager" />
          <Tab label="Flow Manager" />
          <Tab label="Asset Manager" />
        </Tabs>
      </AppBar>

      <Box sx={{ px: 1, py: 1 }}>
        {tab === 0 && (
          <TriggerManager
            triggers={program.triggers}
            watchPathOptions={watchPathOptions}
            selectedTriggerId={selectedTriggerId}
            onSelectTrigger={setSelectedTriggerId}
            onAddTrigger={addTriggerWithType}
            onRemoveTrigger={removeTrigger}
            onRenameTrigger={renameTrigger}
            onUpdateTrigger={updateTrigger}
            onUpdateTriggerPayload={updateTriggerPayload}
          />
        )}
        {tab === 1 && (
          <ActionManager
            actions={program.actions}
            scriptTemplates={program.scriptTemplates}
            assets={program.assets}
            selectedActionId={selectedActionId}
            onSelectAction={setSelectedActionId}
            onAddAction={addAction}
            onRemoveAction={removeAction}
            onRenameAction={renameAction}
            onUpdateAction={updateAction}
            onAddScriptTemplate={addScriptTemplate}
            onRemoveScriptTemplate={removeScriptTemplate}
            onUpdateScriptTemplate={updateScriptTemplate}
          />
        )}
        {tab === 2 && (
          <FlowManager
            triggerIds={program.triggers.map((item) => item.id)}
            actionIds={program.actions.map((item) => item.id)}
            nodeLabels={flowNodeLabels}
            links={program.flows.links}
            nodePositions={program.flows.nodePositions || {}}
            zoom={flowZoom}
            onZoomChange={setFlowZoom}
            onAddLink={addLink}
            onUpdateLink={updateLink}
            onRemoveLink={removeLink}
            onRemoveNodeFromFlow={removeNodeFromFlow}
            onActionNodeDoubleClick={(actionId) => {
              setSelectedActionId(actionId);
              setTab(1);
            }}
            onNodePositionDragStart={() => dispatch({ type: "PUSH_SNAPSHOT" })}
            onNodePositionChange={updateNodePosition}
            onConnectNodes={(fromId, toId) => addLink({ from: fromId, to: toId, enabled: true })}
          />
        )}
        {tab === 3 && <AssetManager assets={program.assets} onChange={updateAssets} />}
      </Box>
    </Box>
  );
}
