import { useEffect, useMemo, useState } from "react";
import { Box, Menu, MenuItem, Paper, TextField, Typography } from "@mui/material";
import type { EventTemplateDefinition, FlowLink, NodePosition, ScriptTemplateDefinition } from "../../types/program";
import FlowDiagram, { type FlowEditorNode, type FlowNodeKind, type FlowPaletteItem } from "./FlowDiagram";

interface FlowManagerProps {
  triggerIds: string[];
  actionIds: string[];
  eventNodeIds?: string[];
  scriptTemplates: ScriptTemplateDefinition[];
  eventTemplates: EventTemplateDefinition[];
  nodeLabels?: Record<string, string>;
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
  onActionNodeDoubleClick?: (actionId: string) => void;
  onEventNodeDoubleClick?: (nodeId: string) => void;
  onNodePositionDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onConnectNodes?: (fromId: string, toId: string, fromPort: string) => void;
  onDropPaletteItem?: (item: FlowPaletteItem, position: NodePosition) => void;
}

function getNodeKindMeta(kind: FlowNodeKind) {
  if (kind === "action") {
    return {
      fillColor: "#01806b",
      borderColor: "#14f4b4",
      textColor: "#ffffff",
      icon: "PlayArrowRounded"
    };
  }
  if (kind === "event") {
    return {
      fillColor: "#3366e8",
      borderColor: "#8ab4ff",
      textColor: "#ffffff",
      icon: "SettingsEthernetRounded"
    };
  }
  return {
    fillColor: "#4b5563",
    borderColor: "#22d3ee",
    textColor: "#ffffff",
    icon: "SensorsRounded"
  };
}

function getNodeOutputs(nodeId: string, kind: FlowNodeKind): Array<{ id: string; label: string }> {
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
  links,
  nodePositions,
  zoom,
  onZoomChange,
  onRemoveLink,
  onRemoveNodeFromFlow,
  onDeleteNodes,
  onDuplicateNodes,
  onActionNodeDoubleClick,
  onEventNodeDoubleClick,
  onNodePositionDragStart,
  onNodePositionChange,
  onConnectNodes,
  onDropPaletteItem
}: FlowManagerProps) {
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(-1);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; kind: FlowNodeKind; mouseX: number; mouseY: number } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ mouseX: number; mouseY: number; position: NodePosition } | null>(null);

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
      allNodes.map((node) => {
        const meta = getNodeKindMeta(node.kind);
        return {
          id: node.id,
          kind: node.kind,
          label: (nodeLabels[node.id] || node.id).trim() || node.id,
          outputs: getNodeOutputs(node.id, node.kind),
          ...meta
        };
      }),
    [allNodes, nodeLabels]
  );

  const placedIds = useMemo(() => new Set(Object.keys(nodePositions || {})), [nodePositions]);
  const paletteItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const items: Array<{ key: string; label: string; subtitle: string; fillColor: string; borderColor: string; payload: FlowPaletteItem }> = [];

    for (const node of diagramNodes) {
      if (node.kind !== "trigger") continue;
      if (placedIds.has(node.id)) continue;
      items.push({
        key: `trigger:${node.id}`,
        label: node.label,
        subtitle: node.id,
        fillColor: node.fillColor || "#4b5563",
        borderColor: node.borderColor || "#22d3ee",
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
        key: `event-template:${template.id}`,
        label: template.id,
        subtitle: template.eventPathTemplate || template.id,
        fillColor: "#3366e8",
        borderColor: "#8ab4ff",
        payload: { type: "event-template", templateId: template.id, label: template.id }
      });
    }

    return items.filter((item) => {
      if (!keyword) return true;
      return `${item.label} ${item.subtitle}`.toLowerCase().includes(keyword);
    });
  }, [diagramNodes, eventTemplates, placedIds, scriptTemplates, search]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const isMeta = event.ctrlKey || event.metaKey;

      if (isMeta && event.key.toLowerCase() === "c" && selectedNodeIds.length > 0) {
        window.sessionStorage.setItem("flow-node-clipboard", JSON.stringify(selectedNodeIds));
        event.preventDefault();
        return;
      }

      if (isMeta && event.key.toLowerCase() === "v") {
        const raw = window.sessionStorage.getItem("flow-node-clipboard");
        if (!raw) return;
        try {
          const nodeIds = JSON.parse(raw);
          if (Array.isArray(nodeIds) && nodeIds.length > 0) {
            onDuplicateNodes?.(nodeIds);
            event.preventDefault();
          }
        } catch {
          // ignore clipboard parse issue
        }
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedNodeIds.length > 0) {
        if (onDeleteNodes) onDeleteNodes(selectedNodeIds);
        else selectedNodeIds.forEach((nodeId) => onRemoveNodeFromFlow?.(nodeId));
        setSelectedNodeIds([]);
        setSelectedLinkIndex(-1);
        event.preventDefault();
        return;
      }
      if (selectedLinkIndex >= 0) {
        onRemoveLink(selectedLinkIndex);
        setSelectedLinkIndex(-1);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDeleteNodes, onDuplicateNodes, onRemoveLink, onRemoveNodeFromFlow, selectedLinkIndex, selectedNodeIds]);

  const closeNodeMenu = () => setNodeMenu(null);
  const closeCanvasMenu = () => setCanvasMenu(null);

  const handleCopyNode = (nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    window.sessionStorage.setItem("flow-node-clipboard", JSON.stringify(nodeIds));
  };

  const handlePasteAt = (position?: NodePosition) => {
    const raw = window.sessionStorage.getItem("flow-node-clipboard");
    if (!raw) return;
    try {
      const nodeIds = JSON.parse(raw);
      if (Array.isArray(nodeIds) && nodeIds.length > 0) {
        onDuplicateNodes?.(nodeIds, position);
      }
    } catch {
      // ignore clipboard parse issue
    }
  };

  return (
    <Box sx={{ width: "100%", height: "calc(100vh - 120px)", display: "grid", gridTemplateColumns: "300px 1fr", gap: 1 }}>
      <Paper variant="outlined" sx={{ p: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75 }}>
        <Typography variant="subtitle1">Available Nodes</Typography>
        <TextField size="small" label="Search Node" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Box sx={{ minHeight: 0, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 0.5, p: 0.5, display: "flex", flexDirection: "column", gap: 0.5, alignItems: "stretch" }}>
          {paletteItems.map((item) => (
            <Box
              key={item.key}
              draggable
              onDragStart={(event) => {
                const payload = JSON.stringify(item.payload);
                event.dataTransfer.setData("application/x-flow-palette-item", payload);
                event.dataTransfer.setData("text/plain", item.subtitle);
                event.dataTransfer.effectAllowed = "copyMove";
              }}
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: 1,
                border: "1px solid",
                borderColor: item.borderColor,
                background: item.fillColor,
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
                {item.label}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: "monospace", color: "#dbeafe", ml: 1, opacity: 0.9 }}>
                {item.subtitle}
              </Typography>
            </Box>
          ))}
          {paletteItems.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No available nodes.
            </Typography>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1, minHeight: 0, display: "grid", gridTemplateRows: "1fr" }}>
        <FlowDiagram
          nodes={diagramNodes}
          links={links}
          nodePositions={nodePositions}
          zoom={zoom}
          onZoomChange={onZoomChange}
          selectedLinkIndex={selectedLinkIndex}
          selectedNodeIds={selectedNodeIds}
          onSelectLink={(index) => {
            setSelectedLinkIndex(index);
            if (index >= 0) setSelectedNodeIds([]);
          }}
          onSelectNodeIds={setSelectedNodeIds}
          onNodeDoubleClick={(nodeId, kind) => {
            if (kind === "action") onActionNodeDoubleClick?.(nodeId);
            if (kind === "event") onEventNodeDoubleClick?.(nodeId);
          }}
          onNodeContextMenu={(nodeId, kind, anchor) => {
            closeCanvasMenu();
            setNodeMenu({ nodeId, kind, mouseX: anchor.x, mouseY: anchor.y });
          }}
          onCanvasContextMenu={(anchor, position) => {
            closeNodeMenu();
            setCanvasMenu({ mouseX: anchor.x, mouseY: anchor.y, position });
          }}
          onNodeDragStart={onNodePositionDragStart}
          onNodePositionChange={onNodePositionChange}
          onConnectNodes={(fromId, toId, fromPort) => onConnectNodes?.(fromId, toId, fromPort)}
          onDropPaletteItem={onDropPaletteItem}
        />
        <Menu
          open={Boolean(nodeMenu)}
          onClose={closeNodeMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            nodeMenu
              ? { top: nodeMenu.mouseY, left: nodeMenu.mouseX }
              : undefined
          }
        >
          <MenuItem
            onClick={() => {
              if (!nodeMenu) return;
              const nodeIds = selectedNodeIds.includes(nodeMenu.nodeId) ? selectedNodeIds : [nodeMenu.nodeId];
              handleCopyNode(nodeIds);
              closeNodeMenu();
            }}
          >
            Copy
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!nodeMenu) return;
              const nodeIds = selectedNodeIds.includes(nodeMenu.nodeId) ? selectedNodeIds : [nodeMenu.nodeId];
              onDuplicateNodes?.(nodeIds);
              closeNodeMenu();
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (!nodeMenu) return;
              const nodeIds = selectedNodeIds.includes(nodeMenu.nodeId) ? selectedNodeIds : [nodeMenu.nodeId];
              if (onDeleteNodes) onDeleteNodes(nodeIds);
              else nodeIds.forEach((nodeId) => onRemoveNodeFromFlow?.(nodeId));
              setSelectedNodeIds([]);
              closeNodeMenu();
            }}
          >
            Delete
          </MenuItem>
        </Menu>
        <Menu
          open={Boolean(canvasMenu)}
          onClose={closeCanvasMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            canvasMenu
              ? { top: canvasMenu.mouseY, left: canvasMenu.mouseX }
              : undefined
          }
        >
          <MenuItem
            onClick={() => {
              handlePasteAt(canvasMenu?.position);
              closeCanvasMenu();
            }}
          >
            Paste
          </MenuItem>
        </Menu>
      </Paper>
    </Box>
  );
}
