import { useEffect, useMemo, useRef, useState } from "react";
import { Box, CircularProgress, FormControlLabel, Paper, Switch } from "@mui/material";
import type { EventTemplateDefinition, FlowDefinition, FlowLink, FlowVariableDefinition, NodePosition, ScriptTemplateDefinition, TriggerTemplateDefinition } from "../../types/program";

export type FlowPaletteItem =
  | { type: "existing-node"; nodeId: string }
  | { type: "builtin-trigger"; triggerType: "interval" | "watcher_set" | "watcher_valuechange" | "watcher_event_open" | "watcher_event_close"; label: string }
  | { type: "builtin-action"; actionType: "debug"; label: string }
  | { type: "script-template"; templateId: string; label: string }
  | { type: "event-template-open"; templateId: string; label: string }
  | { type: "event-template-close"; templateId: string; label: string };

interface FlowManagerProps {
  flows?: FlowDefinition[];
  selectedFlowId?: string;
  activeFlowVariables?: FlowVariableDefinition[];
  triggerIds: string[];
  triggerTemplates: TriggerTemplateDefinition[];
  actionIds: string[];
  eventNodeIds?: string[];
  scriptTemplates: ScriptTemplateDefinition[];
  eventTemplates: EventTemplateDefinition[];
  nodeLabels?: Record<string, string>;
  nodeSubtitles?: Record<string, string>;
  nodeOutputs?: Record<string, Array<{ id: string; label: string }>>;
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onAddLink: (link: FlowLink) => void;
  onUpdateLink: (index: number, patch: Partial<FlowLink>) => void;
  onRemoveLink: (index: number) => void;
  onRemoveNodeFromFlow?: (nodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDuplicateNodes?: (nodeIds: string[], basePosition?: NodePosition) => void;
  onTriggerNodeDoubleClick?: (triggerId: string) => void;
  onActionNodeDoubleClick?: (actionId: string) => void;
  onEventNodeDoubleClick?: (nodeId: string) => void;
  onNodePositionDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onConnectNodes?: (fromId: string, toId: string, fromPort: string) => void;
  onDropPaletteItem?: (item: FlowPaletteItem, position: NodePosition) => void;
  onSelectFlow?: (flowId: string) => void;
  onAddFlow?: () => void;
  onDuplicateFlow?: (flowId: string) => void;
  onRemoveFlow?: (flowId: string) => void;
  onUpdateFlow?: (flowId: string, patch: Partial<FlowDefinition>) => void;
}

type FlowNodeKind = "trigger" | "action" | "event";

type FlowEditorNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  subtitle?: string;
  outputs: Array<{ id: string; label: string }>;
  fillColor: string;
  borderColor: string;
  textColor: string;
};

type FlowNodeStatusItem = {
  level: "idle" | "running" | "success" | "warn" | "error";
  text?: string;
  position?: "top" | "bottom";
  ts?: string;
};

type FlowNodeProfilingItem = {
  nodeId: string;
  queueLength: number;
  inflight: number;
  droppedCount: number;
  avgQueueWaitMs: number | null;
  avgExecMs: number | null;
  updatedAt: string;
};

type PaletteItem = {
  key: string;
  section: "watchers" | "timed" | "actions" | "events";
  label: string;
  subtitle: string;
  fillColor: string;
  borderColor: string;
  payload: FlowPaletteItem;
};

function getNodeKindMeta(kind: FlowNodeKind) {
  if (kind === "action") {
    return {
      fillColor: "#01806b",
      borderColor: "#14f4b4",
      textColor: "#ffffff"
    };
  }
  if (kind === "event") {
    return {
      fillColor: "#3366e8",
      borderColor: "#8ab4ff",
      textColor: "#ffffff"
    };
  }
  return {
    fillColor: "#4b5563",
    borderColor: "#22d3ee",
    textColor: "#ffffff"
  };
}

function getNodeOutputs(
  nodeId: string,
  kind: FlowNodeKind,
  configuredOutputs?: Record<string, Array<{ id: string; label: string }>>
): Array<{ id: string; label: string }> {
  if (kind === "action") {
    const outputs = configuredOutputs?.[nodeId];
    if (Array.isArray(outputs) && outputs.length > 0) return outputs;
  }
  if (kind === "event" && (nodeId.startsWith("event.open.") || nodeId.startsWith("event.close."))) {
    return [
      { id: "onSuccess", label: "SUCCESS" },
      { id: "onFail", label: "FAIL" }
    ];
  }
  return [{ id: "default", label: "OUT" }];
}

export default function FlowManager({
  triggerIds,
  actionIds,
  eventNodeIds = [],
  scriptTemplates,
  eventTemplates,
  nodeLabels = {},
  nodeSubtitles = {},
  nodeOutputs = {},
  links,
  nodePositions,
  zoom,
  onZoomChange,
  onAddLink,
  onRemoveLink,
  onDeleteNodes,
  onDuplicateNodes,
  onTriggerNodeDoubleClick,
  onActionNodeDoubleClick,
  onEventNodeDoubleClick,
  onNodePositionDragStart,
  onNodePositionChange,
  onConnectNodes,
  onDropPaletteItem,
  flows = [],
  selectedFlowId = "",
  activeFlowVariables = [],
  onSelectFlow,
  onAddFlow,
  onDuplicateFlow,
  onRemoveFlow,
  onUpdateFlow
}: FlowManagerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, FlowNodeStatusItem[]>>({});
  const [statusMonitorEnabled, setStatusMonitorEnabled] = useState(false);
  const [statusMonitorLoaded, setStatusMonitorLoaded] = useState(false);
  const [nodeProfilings, setNodeProfilings] = useState<Record<string, FlowNodeProfilingItem>>({});
  const [profilingEnabled, setProfilingEnabled] = useState(false);
  const [profilingLoaded, setProfilingLoaded] = useState(false);
  const lastStatusRevisionRef = useRef<number>(-1);
  const lastProfilingRevisionRef = useRef<number>(-1);

  const allNodes = useMemo(
    () => [
      ...triggerIds.map((id) => ({ id, kind: "trigger" as const })),
      ...actionIds.map((id) => ({ id, kind: "action" as const })),
      ...eventNodeIds.map((id) => ({ id, kind: "event" as const }))
    ],
    [triggerIds, actionIds, eventNodeIds]
  );

  const diagramNodes = useMemo<FlowEditorNode[]>(
    () =>
      allNodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        label: (nodeLabels[node.id] || node.id).trim() || node.id,
        subtitle: (nodeSubtitles[node.id] || "").trim() || (nodeLabels[node.id] || node.id).trim() || node.id,
        outputs: getNodeOutputs(node.id, node.kind, nodeOutputs),
        ...getNodeKindMeta(node.kind)
      })),
    [allNodes, nodeLabels, nodeOutputs, nodeSubtitles]
  );

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    items.push({
      key: "builtin-trigger:interval",
      section: "timed",
      label: "Timed Trigger",
      subtitle: "Built-in interval trigger",
      fillColor: "#4b5563",
      borderColor: "#22d3ee",
      payload: { type: "builtin-trigger", triggerType: "interval", label: "Timed Trigger" }
    });

    [
      { type: "watcher_set" as const, label: "Watcher Set", subtitle: "Built-in attribute set watcher" },
      { type: "watcher_valuechange" as const, label: "Watcher Value Change", subtitle: "Built-in attribute value change watcher" },
      { type: "watcher_event_open" as const, label: "Watcher Event Open", subtitle: "Built-in event open watcher" },
      { type: "watcher_event_close" as const, label: "Watcher Event Close", subtitle: "Built-in event close watcher" }
    ].forEach((item) => {
      items.push({
        key: `builtin-trigger:${item.type}`,
        section: "watchers",
        label: item.label,
        subtitle: item.subtitle,
        fillColor: "#4b5563",
        borderColor: "#22d3ee",
        payload: { type: "builtin-trigger", triggerType: item.type, label: item.label }
      });
    });

    items.push({
      key: "builtin-action:debug",
      section: "actions",
      label: "Debug",
      subtitle: "Built-in debug action",
      fillColor: "#475569",
      borderColor: "#94a3b8",
      payload: { type: "builtin-action", actionType: "debug", label: "Debug" }
    });

    for (const template of scriptTemplates) {
      items.push({
        key: `script-template:${template.id}`,
        section: "actions",
        label: template.name,
        subtitle: template.id,
        fillColor: "#01806b",
        borderColor: "#14f4b4",
        payload: { type: "script-template", templateId: template.id, label: template.name }
      });
    }

    for (const template of eventTemplates) {
      items.push({
        key: `event-template-open:${template.id}`,
        section: "events",
        label: `OPEN ${template.id}`,
        subtitle: template.eventPathTemplate || template.id,
        fillColor: "#3366e8",
        borderColor: "#8ab4ff",
        payload: { type: "event-template-open", templateId: template.id, label: `OPEN ${template.id}` }
      });
      items.push({
        key: `event-template-close:${template.id}`,
        section: "events",
        label: `CLOSE ${template.id}`,
        subtitle: template.eventPathTemplate || template.id,
        fillColor: "#3366e8",
        borderColor: "#8ab4ff",
        payload: { type: "event-template-close", templateId: template.id, label: `CLOSE ${template.id}` }
      });
    }

    return items;
  }, [eventTemplates, scriptTemplates]);

  const syncToIframe = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        source: "kufayeka-flow:message",
        type: "sync",
        payload: {
          nodes: diagramNodes,
          links,
          nodePositions,
          paletteItems,
          zoom: zoom ?? 0.5,
          flows: flows.map((flow) => ({
            id: flow.id,
            name: flow.name,
            description: flow.description || "",
            enabled: flow.enabled !== false,
            nodeCount: (flow.nodes || []).length,
            variableCount: (flow.variables || []).length
          })),
          selectedFlowId,
          activeFlowConfig: {
            id: selectedFlowId,
            variables: activeFlowVariables,
            ...(flows.find((flow) => flow.id === selectedFlowId) || {})
          }
        }
      },
      "*"
    );
  };

  const syncNodeStatusesToIframe = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        source: "kufayeka-flow:message",
        type: "node-status-sync",
        payload: {
          nodeStatuses
        }
      },
      "*"
    );
  };

  const syncNodeProfilingsToIframe = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        source: "kufayeka-flow:message",
        type: "node-profiling-sync",
        payload: {
          nodeProfilings
        }
      },
      "*"
    );
  };

  useEffect(() => {
    syncToIframe();
  }, [activeFlowVariables, diagramNodes, flows, iframeReady, links, nodePositions, paletteItems, selectedFlowId, zoom]);

  useEffect(() => {
    if (!iframeReady) return;
    syncNodeStatusesToIframe();
  }, [iframeReady, nodeStatuses]);

  useEffect(() => {
    if (!iframeReady) return;
    syncNodeProfilingsToIframe();
  }, [iframeReady, nodeProfilings]);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/runtime/node-status/config");
        const data = (await res.json()) as { enabled?: boolean };
        if (!res.ok || cancelled) return;
        setStatusMonitorEnabled(data.enabled === true);
      } catch {
        if (!cancelled) setStatusMonitorEnabled(false);
      } finally {
        if (!cancelled) setStatusMonitorLoaded(true);
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const res = await fetch("/api/runtime/node-profiling/config");
        const data = (await res.json()) as { enabled?: boolean };
        if (!res.ok || cancelled) return;
        setProfilingEnabled(data.enabled === true);
      } catch {
        if (!cancelled) setProfilingEnabled(false);
      } finally {
        if (!cancelled) setProfilingLoaded(true);
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!statusMonitorEnabled) {
      setNodeStatuses({});
      lastStatusRevisionRef.current = -1;
      return;
    }

    const eventSource = new EventSource("/api/runtime-events/node-status");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          enabled?: boolean;
          revision?: number;
          nodeId?: string;
          status?: FlowNodeStatusItem[];
          items?: Record<string, FlowNodeStatusItem[]>;
        };
        if (payload.enabled === false) {
          setNodeStatuses({});
          return;
        }
        const revision = Number(payload.revision ?? 0);
        if (revision === lastStatusRevisionRef.current) return;
        lastStatusRevisionRef.current = revision;

        if (payload.items && typeof payload.items === "object") {
          setNodeStatuses(payload.items);
          return;
        }

        if (payload.nodeId) {
          setNodeStatuses((current) => {
            const next = { ...current };
            if (Array.isArray(payload.status) && payload.status.length > 0) {
              next[payload.nodeId as string] = payload.status;
            } else {
              delete next[payload.nodeId as string];
            }
            return next;
          });
        }
      } catch {
        // ignore malformed events
      }
    };

    eventSource.onerror = () => {
      // browser EventSource will reconnect automatically
    };

    return () => {
      eventSource.close();
    };
  }, [statusMonitorEnabled]);

  useEffect(() => {
    if (!profilingEnabled) {
      setNodeProfilings({});
      lastProfilingRevisionRef.current = -1;
      return;
    }

    const eventSource = new EventSource("/api/runtime-events/node-profiling");

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          enabled?: boolean;
          revision?: number;
          nodeId?: string;
          profiling?: FlowNodeProfilingItem;
          items?: Record<string, FlowNodeProfilingItem>;
        };
        if (payload.enabled === false) {
          setNodeProfilings({});
          return;
        }
        const revision = Number(payload.revision ?? 0);
        if (revision === lastProfilingRevisionRef.current) return;
        lastProfilingRevisionRef.current = revision;

        if (payload.items && typeof payload.items === "object") {
          setNodeProfilings(payload.items);
          return;
        }

        if (payload.nodeId) {
          setNodeProfilings((current) => {
            const next = { ...current };
            if (payload.profiling && typeof payload.profiling === "object") {
              next[payload.nodeId as string] = payload.profiling;
            } else {
              delete next[payload.nodeId as string];
            }
            return next;
          });
        }
      } catch {
        // ignore malformed events
      }
    };

    eventSource.onerror = () => {
      // browser EventSource will reconnect automatically
    };

    return () => {
      eventSource.close();
    };
  }, [profilingEnabled]);

  const handleToggleStatusMonitor = async (enabled: boolean) => {
    setStatusMonitorEnabled(enabled);
    if (!enabled) {
      setNodeStatuses({});
      lastStatusRevisionRef.current = -1;
    }
    try {
      const res = await fetch("/api/runtime/node-status/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ enabled })
      });
      const data = (await res.json()) as { enabled?: boolean };
      if (!res.ok) {
        throw new Error("Failed to update monitor mode");
      }
      setStatusMonitorEnabled(data.enabled === true);
      if (data.enabled !== true) {
        setNodeStatuses({});
        lastStatusRevisionRef.current = -1;
      }
    } catch {
      setStatusMonitorEnabled((current) => !enabled);
    }
  };

  const handleToggleProfiling = async (enabled: boolean) => {
    setProfilingEnabled(enabled);
    if (!enabled) {
      setNodeProfilings({});
      lastProfilingRevisionRef.current = -1;
    }
    try {
      const res = await fetch("/api/runtime/node-profiling/config", {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ enabled })
      });
      const data = (await res.json()) as { enabled?: boolean };
      if (!res.ok) {
        throw new Error("Failed to update profiling mode");
      }
      setProfilingEnabled(data.enabled === true);
      if (data.enabled !== true) {
        setNodeProfilings({});
        lastProfilingRevisionRef.current = -1;
      }
    } catch {
      setProfilingEnabled((current) => !enabled);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | {
            source?: string;
            type?: string;
            payload?: Record<string, unknown>;
          }
        | undefined;
      if (!data || data.source !== "kufayeka-flow:event") return;

      if (data.type === "ready") {
        setIframeReady(true);
        syncToIframe();
        return;
      }

      if (data.type === "zoom-change") {
        const nextZoom = Number(data.payload?.zoom ?? zoom ?? 0.5);
        onZoomChange?.(nextZoom);
        return;
      }

      if (data.type === "node-drag-start") {
        onNodePositionDragStart?.();
        return;
      }

      if (data.type === "nodes-position-change") {
        const positions = (data.payload?.positions as Record<string, NodePosition>) || {};
        Object.entries(positions).forEach(([nodeId, position]) => {
          if (!position || typeof position.x !== "number" || typeof position.y !== "number") return;
          onNodePositionChange?.(nodeId, position);
        });
        return;
      }

      if (data.type === "connect-nodes") {
        const fromId = String(data.payload?.fromId || "");
        const toId = String(data.payload?.toId || "");
        const fromPort = String(data.payload?.fromPort || "default");
        if (!fromId || !toId) return;
        if (onConnectNodes) onConnectNodes(fromId, toId, fromPort);
        else onAddLink({ from: fromId, to: toId, fromPort, enabled: true });
        return;
      }

      if (data.type === "drop-palette-item") {
        const item = data.payload?.item as PaletteItem["payload"] | undefined;
        const position = data.payload?.position as NodePosition | undefined;
        if (!item || !position) return;
        onDropPaletteItem?.(item, position);
        return;
      }

      if (data.type === "duplicate-nodes") {
        const nodeIds = Array.isArray(data.payload?.nodeIds)
          ? (data.payload?.nodeIds as string[])
          : [];
        const basePosition = (data.payload?.basePosition as NodePosition | null | undefined) ?? undefined;
        if (nodeIds.length > 0) onDuplicateNodes?.(nodeIds, basePosition);
        return;
      }

      if (data.type === "delete-nodes") {
        const nodeIds = Array.isArray(data.payload?.nodeIds)
          ? (data.payload?.nodeIds as string[])
          : [];
        if (nodeIds.length > 0) onDeleteNodes?.(nodeIds);
        return;
      }

      if (data.type === "remove-link") {
        const index = Number(data.payload?.index ?? -1);
        if (index >= 0) onRemoveLink(index);
        return;
      }

      if (data.type === "node-double-click") {
        const nodeId = String(data.payload?.nodeId || "");
        const kind = String(data.payload?.kind || "");
        if (!nodeId) return;
        if (kind === "trigger") onTriggerNodeDoubleClick?.(nodeId);
        else if (kind === "action") onActionNodeDoubleClick?.(nodeId);
        else onEventNodeDoubleClick?.(nodeId);
        return;
      }

      if (data.type === "select-flow") {
        const flowId = String(data.payload?.flowId || "");
        if (flowId) onSelectFlow?.(flowId);
        return;
      }

      if (data.type === "add-flow") {
        onAddFlow?.();
        return;
      }

      if (data.type === "duplicate-flow") {
        const flowId = String(data.payload?.flowId || selectedFlowId);
        if (flowId) onDuplicateFlow?.(flowId);
        return;
      }

      if (data.type === "remove-flow") {
        const flowId = String(data.payload?.flowId || selectedFlowId);
        if (flowId) onRemoveFlow?.(flowId);
        return;
      }

      if (data.type === "update-flow") {
        const flowId = String(data.payload?.flowId || selectedFlowId);
        const patch = (data.payload?.patch as Partial<FlowDefinition> | undefined) || undefined;
        if (flowId && patch) onUpdateFlow?.(flowId, patch);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    onActionNodeDoubleClick,
    onAddLink,
    onConnectNodes,
    onDeleteNodes,
    onDropPaletteItem,
    onAddFlow,
    onDuplicateFlow,
    onDuplicateNodes,
    onEventNodeDoubleClick,
    onNodePositionChange,
    onNodePositionDragStart,
    onRemoveFlow,
    onRemoveLink,
    onSelectFlow,
    onTriggerNodeDoubleClick,
    onUpdateFlow,
    onZoomChange,
    selectedFlowId,
    zoom
  ]);

  return (
    <Box sx={{ width: "100%", height: "calc(100vh - 120px)", position: "relative", borderRadius: 1, overflow: "hidden", border: "1px solid #dbe4ee", background: "#fff" }}>
      <Paper
        elevation={0}
        sx={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 2,
          px: 1.25,
          py: 0.5,
          borderRadius: 2,
          border: "1px solid #dbe4ee",
          background: "rgba(255,255,255,0.92)"
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <FormControlLabel
            sx={{ m: 0 }}
            control={
              <Switch
                size="small"
                checked={statusMonitorEnabled}
                onChange={(_, checked) => void handleToggleStatusMonitor(checked)}
                disabled={!statusMonitorLoaded}
              />
            }
            label="Monitor Status"
          />
          <FormControlLabel
            sx={{ m: 0 }}
            control={
              <Switch
                size="small"
                checked={profilingEnabled}
                onChange={(_, checked) => void handleToggleProfiling(checked)}
                disabled={!profilingLoaded}
              />
            }
            label="Profiling"
          />
        </Box>
      </Paper>
      {!iframeReady && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            zIndex: 1,
            background: "linear-gradient(180deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.94) 100%)"
          }}
        >
          <CircularProgress size={24} />
          <Box sx={{ fontSize: 14, color: "#334155", fontWeight: 600 }}>Loading Flow Editor</Box>
        </Box>
      )}
      <iframe
        ref={iframeRef}
        title="Kufayeka Flow Editor"
        src="/flow-editor/index.html"
        onLoad={() => {
          setIframeReady(true);
          window.setTimeout(() => {
            syncToIframe();
          }, 0);
        }}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "#fff" }}
      />
    </Box>
  );
}
