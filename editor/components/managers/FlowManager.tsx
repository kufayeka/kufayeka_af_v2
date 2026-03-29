import { useEffect, useMemo, useRef, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import type { EventTemplateDefinition, FlowLink, NodePosition, ScriptTemplateDefinition } from "../../types/program";

export type FlowPaletteItem =
  | { type: "existing-node"; nodeId: string }
  | { type: "script-template"; templateId: string; label: string }
  | { type: "event-template-open"; templateId: string; label: string }
  | { type: "event-template-close"; templateId: string; label: string };

interface FlowManagerProps {
  triggerIds: string[];
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

type PaletteItem = {
  key: string;
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
  onDropPaletteItem
}: FlowManagerProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeReady, setIframeReady] = useState(false);

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

  const placedIds = useMemo(() => new Set(Object.keys(nodePositions || {})), [nodePositions]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const node of diagramNodes) {
      if (node.kind !== "trigger") continue;
      if (placedIds.has(node.id)) continue;
      items.push({
        key: `trigger:${node.id}`,
        label: node.label,
        subtitle: node.id,
        fillColor: node.fillColor,
        borderColor: node.borderColor,
        payload: { type: "existing-node", nodeId: node.id }
      });
    }

    for (const template of scriptTemplates) {
      items.push({
        key: `script-template:${template.id}`,
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
        label: `OPEN ${template.id}`,
        subtitle: template.eventPathTemplate || template.id,
        fillColor: "#3366e8",
        borderColor: "#8ab4ff",
        payload: { type: "event-template-open", templateId: template.id, label: `OPEN ${template.id}` }
      });
      items.push({
        key: `event-template-close:${template.id}`,
        label: `CLOSE ${template.id}`,
        subtitle: template.eventPathTemplate || template.id,
        fillColor: "#3366e8",
        borderColor: "#8ab4ff",
        payload: { type: "event-template-close", templateId: template.id, label: `CLOSE ${template.id}` }
      });
    }

    return items;
  }, [diagramNodes, eventTemplates, placedIds, scriptTemplates]);

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
          zoom: zoom ?? 0.5
        }
      },
      "*"
    );
  };

  useEffect(() => {
    syncToIframe();
  }, [diagramNodes, iframeReady, links, nodePositions, paletteItems, zoom]);

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
    onDuplicateNodes,
    onEventNodeDoubleClick,
    onNodePositionChange,
    onNodePositionDragStart,
    onRemoveLink,
    onTriggerNodeDoubleClick,
    onZoomChange,
    zoom
  ]);

  return (
    <Box sx={{ width: "100%", height: "calc(100vh - 120px)", position: "relative", borderRadius: 1, overflow: "hidden", border: "1px solid #dbe4ee", background: "#fff" }}>
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
