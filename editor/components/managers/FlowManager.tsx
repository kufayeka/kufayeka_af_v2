import { useEffect, useMemo, useState } from "react";
import { Box, Paper, TextField, Typography } from "@mui/material";
import type { FlowLink, NodePosition } from "../../types/program";
import FlowDiagram from "./FlowDiagram";

interface FlowManagerProps {
  triggerIds: string[];
  actionIds: string[];
  eventNodeIds?: string[];
  nodeLabels?: Record<string, string>;
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onAddLink: (link: FlowLink) => void;
  onUpdateLink: (index: number, patch: Partial<FlowLink>) => void;
  onRemoveLink: (index: number) => void;
  onRemoveNodeFromFlow?: (nodeId: string) => void;
  onActionNodeDoubleClick?: (actionId: string) => void;
  onEventNodeDoubleClick?: (nodeId: string) => void;
  onNodePositionDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onConnectNodes?: (fromId: string, toId: string) => void;
}

export default function FlowManager({
  triggerIds,
  actionIds,
  eventNodeIds = [],
  nodeLabels = {},
  links,
  nodePositions,
  zoom,
  onZoomChange,
  onRemoveLink,
  onRemoveNodeFromFlow,
  onActionNodeDoubleClick,
  onEventNodeDoubleClick,
  onNodePositionDragStart,
  onNodePositionChange,
  onConnectNodes
}: FlowManagerProps) {
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(-1);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [search, setSearch] = useState("");

  const allNodes = useMemo(
    () => [
      ...triggerIds.map((id) => ({ id, kind: "trigger" as const })),
      ...actionIds.map((id) => ({ id, kind: "action" as const })),
      ...eventNodeIds.map((id) => ({ id, kind: "event" as const }))
    ],
    [triggerIds, actionIds, eventNodeIds]
  );

  const placedIds = useMemo(() => new Set(Object.keys(nodePositions || {})), [nodePositions]);
  const availableNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return allNodes.filter((node) => {
      if (placedIds.has(node.id)) return false;
      if (!keyword) return true;
      return `${node.id} ${node.kind}`.toLowerCase().includes(keyword);
    });
  }, [allNodes, placedIds, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (selectedNodeId) {
        onRemoveNodeFromFlow?.(selectedNodeId);
        setSelectedNodeId("");
        setSelectedLinkIndex(-1);
        event.preventDefault();
        return;
      }
      if (selectedLinkIndex >= 0) {
        onRemoveLink(selectedLinkIndex);
        setSelectedLinkIndex(-1);
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onRemoveLink, onRemoveNodeFromFlow, selectedLinkIndex, selectedNodeId]);

  return (
    <Box sx={{ width: "100%", height: "calc(100vh - 120px)", display: "grid", gridTemplateColumns: "320px 1fr", gap: 1 }}>
      <Paper variant="outlined" sx={{ p: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75 }}>
        <Typography variant="subtitle1">Available Nodes</Typography>
        <TextField
          size="small"
          label="Search Node"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Box sx={{ minHeight: 0, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 0.5, p: 0.5, display: "flex", flexDirection: "column", gap: 0.5, alignItems: "stretch" }}>
          {availableNodes.map((node) => (
            <Box
              key={node.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-flow-node", node.id);
                event.dataTransfer.setData("text/plain", node.id);
                event.dataTransfer.setData("application/x-flow-node-kind", node.kind);
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: 1,
                border: "1px solid",
                borderColor: node.kind === "action" ? "#14f4b4" : node.kind === "event" ? "#7dd3fc" : "#94a3b8",
                background: node.kind === "action" ? "#01806b" : node.kind === "event" ? "#1d4ed8" : "#676e6c",
                cursor: "grab",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                minHeight: 40,
                maxHeight: 40,
                width: "100%"
              }}
            >
              <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700, color: "#fff" }}>
                {(nodeLabels[node.id] || node.id).trim() || node.id}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: "monospace", color: "#dbeafe", ml: 1, opacity: 0.9 }}>
                {node.id}
              </Typography>
            </Box>
          ))}
          {availableNodes.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No available nodes.
            </Typography>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1, minHeight: 0, display: "grid", gridTemplateRows: "1fr" }}>
        <FlowDiagram
          triggerIds={triggerIds}
          actionIds={actionIds}
          eventNodeIds={eventNodeIds}
          nodeLabels={nodeLabels}
          links={links}
          nodePositions={nodePositions}
          zoom={zoom}
          onZoomChange={onZoomChange}
          selectedLinkIndex={selectedLinkIndex}
          selectedNodeId={selectedNodeId}
          onSelectLink={(index) => {
            setSelectedLinkIndex(index);
            if (index >= 0) setSelectedNodeId("");
          }}
          onSelectNode={setSelectedNodeId}
          onNodeDoubleClick={(nodeId, kind) => {
            if (kind === "action") onActionNodeDoubleClick?.(nodeId);
            if (kind === "event") onEventNodeDoubleClick?.(nodeId);
          }}
          onNodeDragStart={onNodePositionDragStart}
          onNodePositionChange={onNodePositionChange}
          onConnectNodes={onConnectNodes}
        />
      </Paper>
    </Box>
  );
}
