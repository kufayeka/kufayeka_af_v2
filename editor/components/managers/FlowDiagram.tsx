import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { ElementType } from "react";
import { Box, Button, FormControlLabel, Switch, Typography } from "@mui/material";
import { BellRing, Play, RadioTower } from "lucide-react";
import type { FlowLink, NodePosition } from "../../types/program";

export type FlowNodeKind = "trigger" | "action" | "event";

export type FlowPaletteItem =
  | { type: "existing-node"; nodeId: string }
  | { type: "script-template"; templateId: string; label: string }
  | { type: "event-template"; templateId: string; label: string };

export type FlowEditorNode = {
  id: string;
  kind: FlowNodeKind;
  label: string;
  icon?: string;
  hasError?: boolean;
  outputs: Array<{ id: string; label: string }>;
  fillColor?: string;
  borderColor?: string;
  textColor?: string;
};

type PlacedNode = {
  id: string;
  x: number;
  y: number;
  kind: FlowNodeKind;
  label: string;
  icon?: string;
  hasError?: boolean;
  outputs: Array<{ id: string; label: string }>;
  fillColor?: string;
  borderColor?: string;
  textColor?: string;
};

type FlowDiagramProps = {
  nodes: FlowEditorNode[];
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  selectedLinkIndex: number;
  selectedNodeIds?: string[];
  onSelectLink: (index: number) => void;
  onSelectNodeIds?: (nodeIds: string[]) => void;
  onNodeDoubleClick?: (nodeId: string, kind: FlowNodeKind) => void;
  onNodeContextMenu?: (nodeId: string, kind: FlowNodeKind, anchor: { x: number; y: number }) => void;
  onCanvasContextMenu?: (anchor: { x: number; y: number }, position: NodePosition) => void;
  onNodeDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onNodesPositionChange?: (positions: Record<string, NodePosition>) => void;
  onConnectNodes?: (fromId: string, toId: string, fromPort: string) => void;
  onDropPaletteItem?: (item: FlowPaletteItem, position: NodePosition) => void;
};

const NODE_W = 248;
const BASE_NODE_H = 54;
const PORT_GAP = 18;
const GRID_SIZE = 10;
const COLLISION_PADDING = 14;
const ICON_LANE_W = 42;
const ICON_SIZE = 18;
const OUTPUT_PILL_GAP = 0;
const OUTPUT_PILL_OUTSIDE_GAP = 0;
const OUTPUT_PORT_RADIUS = 7;
const INPUT_PILL_LABEL = "in";
const INPUT_PILL_W = Math.max(40, INPUT_PILL_LABEL.length * 7 + 14);
const INPUT_PILL_H = 16;

type BezierCurve = {
  path: string;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
};

type FlowPathResult = {
  path: string;
  labelX: number;
  labelY: number;
};

const ICON_MAP: Record<string, ElementType> = {
  PlayArrowRounded: Play,
  SensorsRounded: RadioTower,
  SettingsEthernetRounded: BellRing,
  NotificationsActiveRounded: BellRing
};

function buildBezierCurve(startX: number, startY: number, endX: number, endY: number): BezierCurve {
  const dx = endX - startX;
  const dy = endY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const horizontalPull =
    dx >= 0
      ? Math.max(90, Math.min(240, absDx * 0.42 + absDy * 0.22))
      : Math.max(170, Math.min(340, absDx * 0.68 + absDy * 0.34 + 120));
  const verticalPull = dy === 0 ? 0 : Math.sign(dy) * Math.max(20, Math.min(88, absDy * 0.28));
  const control1X = startX + horizontalPull;
  const control1Y = startY + verticalPull;
  const control2X = endX - horizontalPull;
  const control2Y = endY - verticalPull;
  return {
    path: `M ${startX} ${startY} C ${control1X} ${control1Y} ${control2X} ${control2Y} ${endX} ${endY}`,
    c1x: control1X,
    c1y: control1Y,
    c2x: control2X,
    c2y: control2Y
  };
}

function sampleBezierPoint(
  startX: number,
  startY: number,
  curve: BezierCurve,
  endX: number,
  endY: number,
  t: number
): { x: number; y: number } {
  const oneMinusT = 1 - t;
  const x =
    oneMinusT ** 3 * startX +
    3 * oneMinusT ** 2 * t * curve.c1x +
    3 * oneMinusT * t ** 2 * curve.c2x +
    t ** 3 * endX;
  const y =
    oneMinusT ** 3 * startY +
    3 * oneMinusT ** 2 * t * curve.c1y +
    3 * oneMinusT * t ** 2 * curve.c2y +
    t ** 3 * endY;
  return { x, y };
}

function buildFlowPath(startX: number, startY: number, endX: number, endY: number): FlowPathResult {
  const curve = buildBezierCurve(startX, startY, endX, endY);
  const labelPoint = sampleBezierPoint(startX, startY, curve, endX, endY, 0.5);
  return {
    path: curve.path,
    labelX: labelPoint.x,
    labelY: labelPoint.y - 8
  };
}

function getNodeHeight(node: Pick<FlowEditorNode, "kind" | "outputs">): number {
  const outputCount = Math.max(1, node.outputs.length);
  return Math.max(BASE_NODE_H, 36 + outputCount * PORT_GAP);
}

function getOutputY(node: PlacedNode, outputIndex: number): number {
  const height = getNodeHeight(node);
  const count = Math.max(1, node.outputs.length);
  const top = node.y - height / 2;
  const unit = height / (count + 1);
  return top + unit * (outputIndex + 1);
}

function getInputPortX(node: Pick<PlacedNode, "x">): number {
  return node.x - NODE_W / 2 - OUTPUT_PILL_OUTSIDE_GAP - INPUT_PILL_W - OUTPUT_PILL_GAP - OUTPUT_PORT_RADIUS;
}

function getInputPillX(node: Pick<PlacedNode, "x">): number {
  return getInputPortX(node) + OUTPUT_PORT_RADIUS + OUTPUT_PILL_GAP;
}

export default function FlowDiagram({
  nodes = [],
  links = [],
  nodePositions,
  zoom: controlledZoom,
  onZoomChange,
  selectedLinkIndex,
  selectedNodeIds = [],
  onSelectLink,
  onSelectNodeIds,
  onNodeDoubleClick,
  onNodeContextMenu,
  onCanvasContextMenu,
  onNodeDragStart,
  onNodePositionChange,
  onNodesPositionChange,
  onConnectNodes,
  onDropPaletteItem
}: FlowDiagramProps) {
  const safeNodes = useMemo(
    () =>
      (Array.isArray(nodes) ? nodes : []).map((node) => ({
        id: node.id,
        kind: node.kind,
        label: node.label,
        icon: node.icon,
        hasError: Boolean(node.hasError),
        outputs: Array.isArray(node.outputs) && node.outputs.length > 0 ? node.outputs : [{ id: "default", label: "OUT" }],
        fillColor: node.fillColor,
        borderColor: node.borderColor,
        textColor: node.textColor
      })),
    [nodes]
  );
  const safeLinks = Array.isArray(links) ? links : [];
  const nodeMetaMap = useMemo(() => new Map(safeNodes.map((node) => [node.id, node] as const)), [safeNodes]);

  const [liveNodePositions, setLiveNodePositions] = useState<Record<string, NodePosition>>({});
  const [previewNodePositions, setPreviewNodePositions] = useState<Record<string, NodePosition>>({});
  useEffect(() => {
    setLiveNodePositions({});
    setPreviewNodePositions({});
  }, [nodePositions]);

  const placedNodes = useMemo<PlacedNode[]>(() => {
    const list: PlacedNode[] = [];
    for (const node of safeNodes) {
      const pos = previewNodePositions[node.id] || liveNodePositions[node.id] || nodePositions[node.id];
      if (!pos) continue;
      list.push({ ...node, x: pos.x, y: pos.y });
    }
    return list;
  }, [previewNodePositions, liveNodePositions, nodePositions, safeNodes]);

  const nodeMap = useMemo(() => new Map(placedNodes.map((node) => [node.id, node] as const)), [placedNodes]);
  const maxX = placedNodes.reduce((acc, node) => Math.max(acc, node.x), 0);
  const maxY = placedNodes.reduce((acc, node) => Math.max(acc, node.y), 0);
  const diagramWidth = Math.max(1400, maxX + NODE_W + 120);
  const diagramHeight = Math.max(760, maxY + 200);

  const [internalZoom, setInternalZoom] = useState(0.95);
  const zoom = controlledZoom ?? internalZoom;
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [collisionEnabled, setCollisionEnabled] = useState(true);
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; portId: string; x: number; y: number } | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; endX: number; endY: number; additive: boolean } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodeElementRefs = useRef<Record<string, SVGGElement | null>>({});
  const dragPanRef = useRef({ active: false, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const previewRafRef = useRef<number | null>(null);
  const dragNodeRef = useRef({
    active: false,
    nodeIds: [] as string[],
    startMouseX: 0,
    startMouseY: 0,
    startNodePositions: {} as Record<string, NodePosition>,
    latestPositions: {} as Record<string, NodePosition>
  });

  const findNonOverlappingPosition = (nodeId: string, targetX: number, targetY: number): NodePosition => {
    const nodeMeta = nodeMetaMap.get(nodeId);
    const nodeHeight = getNodeHeight(nodeMeta ?? { kind: "action", outputs: [] });
    const minX = Math.ceil(NODE_W / 2) + 10;
    const minY = Math.ceil(nodeHeight / 2) + 10;

    const collidesAt = (candidateX: number, candidateY: number): boolean => {
      const left = candidateX - NODE_W / 2 - COLLISION_PADDING;
      const right = candidateX + NODE_W / 2 + COLLISION_PADDING;
      const top = candidateY - nodeHeight / 2 - COLLISION_PADDING;
      const bottom = candidateY + nodeHeight / 2 + COLLISION_PADDING;
      for (const other of placedNodes) {
        if (other.id === nodeId) continue;
        const otherH = getNodeHeight(other);
        const otherLeft = other.x - NODE_W / 2;
        const otherRight = other.x + NODE_W / 2;
        const otherTop = other.y - otherH / 2;
        const otherBottom = other.y + otherH / 2;
        const overlap = !(right < otherLeft || left > otherRight || bottom < otherTop || top > otherBottom);
        if (overlap) return true;
      }
      return false;
    };

    const clamp = (x: number, y: number) => ({ x: Math.max(minX, x), y: Math.max(minY, y) });
    const first = clamp(targetX, targetY);
    if (!collisionEnabled || !collidesAt(first.x, first.y)) return first;
    const step = gridSnapEnabled ? GRID_SIZE : 8;
    for (let ring = 1; ring <= 20; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const next = clamp(first.x + dx * step, first.y + dy * step);
          if (!collidesAt(next.x, next.y)) return next;
        }
      }
    }
    return first;
  };

  const clearDragPreview = () => {
    if (previewRafRef.current !== null) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    setPreviewNodePositions({});
    for (const nodeId of dragNodeRef.current.nodeIds) {
      const element = nodeElementRefs.current[nodeId];
      if (element) {
        element.removeAttribute("transform");
      }
    }
  };

  const applyDragPreview = (batch: Record<string, NodePosition>) => {
    for (const nodeId of dragNodeRef.current.nodeIds) {
      const element = nodeElementRefs.current[nodeId];
      const start = dragNodeRef.current.startNodePositions[nodeId];
      const next = batch[nodeId];
      if (!element || !start || !next) continue;
      element.setAttribute("transform", `translate(${next.x - start.x}, ${next.y - start.y})`);
    }
  };

  const zoomView = (factor: number) => {
    const nextZoom = Math.max(0.3, Math.min(2, Number(factor.toFixed(2))));
    const scroller = scrollerRef.current;
    if (!scroller) {
      if (controlledZoom === undefined) setInternalZoom(nextZoom);
      onZoomChange?.(nextZoom);
      return;
    }
    const screenW = scroller.clientWidth;
    const screenH = scroller.clientHeight;
    const centerX = (scroller.scrollLeft + screenW / 2) / zoom;
    const centerY = (scroller.scrollTop + screenH / 2) / zoom;

    if (controlledZoom === undefined) setInternalZoom(nextZoom);
    onZoomChange?.(nextZoom);
    requestAnimationFrame(() => {
      const updated = scrollerRef.current;
      if (!updated) return;
      updated.scrollLeft = centerX * nextZoom - screenW / 2;
      updated.scrollTop = centerY * nextZoom - screenH / 2;
    });
  };

  const getSvgPointFromMouse = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const scaleX = diagramWidth / rect.width;
    const scaleY = diagramHeight / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const commitDragNode = () => {
    if (!dragNodeRef.current.active || dragNodeRef.current.nodeIds.length === 0) return;
    const batch: Record<string, NodePosition> = {};
    dragNodeRef.current.nodeIds.forEach((nodeId) => {
      const latest = dragNodeRef.current.latestPositions[nodeId];
      const start = dragNodeRef.current.startNodePositions[nodeId];
      const resolved = latest ?? start;
      if (!resolved) return;
      batch[nodeId] = { x: resolved.x, y: resolved.y };
    });
    if (Object.keys(batch).length > 0) {
      setLiveNodePositions((prev) => ({
        ...prev,
        ...batch
      }));
      onNodesPositionChange?.(batch);
      if (!onNodesPositionChange) {
        Object.entries(batch).forEach(([nodeId, position]) => onNodePositionChange?.(nodeId, position));
      }
    }
    clearDragPreview();
    dragNodeRef.current.active = false;
    dragNodeRef.current.nodeIds = [];
    dragNodeRef.current.startNodePositions = {};
    dragNodeRef.current.latestPositions = {};
  };

  const handleInteractionMove = (clientX: number, clientY: number) => {
    const el = scrollerRef.current;
    if (!el) return;

    if (dragNodeRef.current.active) {
      const point = getSvgPointFromMouse(clientX, clientY);
      if (!point) return;
      const dx = point.x - dragNodeRef.current.startMouseX;
      const dy = point.y - dragNodeRef.current.startMouseY;
      const nextBatch: Record<string, NodePosition> = {};
      dragNodeRef.current.nodeIds.forEach((id) => {
        const start = dragNodeRef.current.startNodePositions[id];
        if (!start) return;
        const rawX = start.x + dx;
        const rawY = start.y + dy;
        const nextX = gridSnapEnabled ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : rawX;
        const nextY = gridSnapEnabled ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : rawY;
        const resolved = dragNodeRef.current.nodeIds.length > 1 ? { x: nextX, y: nextY } : findNonOverlappingPosition(id, nextX, nextY);
        nextBatch[id] = resolved;
      });
      dragNodeRef.current.latestPositions = nextBatch;
      applyDragPreview(nextBatch);
      if (previewRafRef.current === null) {
        previewRafRef.current = requestAnimationFrame(() => {
          previewRafRef.current = null;
          setPreviewNodePositions({ ...dragNodeRef.current.latestPositions });
        });
      }
      return;
    }

    if (marquee) {
      const point = getSvgPointFromMouse(clientX, clientY);
      if (!point) return;
      setMarquee((prev) => (prev ? { ...prev, endX: point.x, endY: point.y } : prev));
      return;
    }

    if (connectFrom) {
      const point = getSvgPointFromMouse(clientX, clientY);
      if (point) setConnectCursor(point);
    }

    if (!dragPanRef.current.active) return;
    const dx = clientX - dragPanRef.current.x;
    const dy = clientY - dragPanRef.current.y;
    el.scrollLeft = dragPanRef.current.scrollLeft - dx;
    el.scrollTop = dragPanRef.current.scrollTop - dy;
  };

  const handleInteractionEnd = () => {
    dragPanRef.current.active = false;
    if (marquee) {
      const minX = Math.min(marquee.startX, marquee.endX);
      const minY = Math.min(marquee.startY, marquee.endY);
      const maxX = Math.max(marquee.startX, marquee.endX);
      const maxY = Math.max(marquee.startY, marquee.endY);
      const isClick = Math.abs(maxX - minX) < 4 && Math.abs(maxY - minY) < 4;
      const hitIds = isClick
        ? []
        : placedNodes
            .filter((node) => {
              const nodeH = getNodeHeight(node);
              const left = node.x - NODE_W / 2;
              const right = node.x + NODE_W / 2;
              const top = node.y - nodeH / 2;
              const bottom = node.y + nodeH / 2;
              return !(right < minX || left > maxX || bottom < minY || top > maxY);
            })
            .map((node) => node.id);
      if (isClick) {
        onSelectNodeIds?.(marquee.additive ? selectedNodeIds : []);
      } else if (marquee.additive) {
        onSelectNodeIds?.(Array.from(new Set([...(selectedNodeIds ?? []), ...hitIds])));
      } else {
        onSelectNodeIds?.(hitIds);
      }
      setMarquee(null);
    }
    commitDragNode();
  };

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      handleInteractionMove(event.clientX, event.clientY);
    };
    const handleWindowMouseUp = () => {
      handleInteractionEnd();
    };
    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      if (previewRafRef.current !== null) {
        cancelAnimationFrame(previewRafRef.current);
        previewRafRef.current = null;
      }
    };
  });

  const handleDragOver = (event: ReactDragEvent) => {
    event.dataTransfer.dropEffect = "copy";
    event.preventDefault();
  };

  const handleDrop = (event: ReactDragEvent) => {
    const point = getSvgPointFromMouse(event.clientX, event.clientY);
    if (!point) return;
    const nextX = gridSnapEnabled ? Math.round(point.x / GRID_SIZE) * GRID_SIZE : point.x;
    const nextY = gridSnapEnabled ? Math.round(point.y / GRID_SIZE) * GRID_SIZE : point.y;
    const rawPalette = String(event.dataTransfer.getData("application/x-flow-palette-item") || "").trim();
    if (rawPalette) {
      try {
        const payload = JSON.parse(rawPalette) as FlowPaletteItem;
        const nodeId = payload.type === "existing-node" ? payload.nodeId : `${payload.type}:${payload.templateId}`;
        const resolved = findNonOverlappingPosition(nodeId, nextX, nextY);
        onNodeDragStart?.();
        onDropPaletteItem?.(payload, resolved);
        event.preventDefault();
        event.stopPropagation();
        return;
      } catch {
        // fall through to legacy handling
      }
    }
    const nodeId = String(event.dataTransfer.getData("application/x-flow-node") || event.dataTransfer.getData("text/plain") || "").trim();
    if (!nodeId) return;
    const resolved = findNonOverlappingPosition(nodeId, nextX, nextY);
    onNodeDragStart?.();
    onNodePositionChange?.(nodeId, resolved);
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        border: "1px solid #cbd5e1",
        borderRadius: 0.5,
        overflow: "hidden",
        userSelect: "none"
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Box sx={{ p: 0.5, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Zoom: {Math.round(zoom * 100)}% | Mid-click pan | Alt+Wheel zoom | In/Out ports enabled
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
          <FormControlLabel sx={{ mr: 0.5 }} control={<Switch size="small" checked={gridSnapEnabled} onChange={(_e, checked) => setGridSnapEnabled(checked)} />} label={<Typography variant="caption">Grid Snap</Typography>} />
          <FormControlLabel sx={{ mr: 0.5 }} control={<Switch size="small" checked={collisionEnabled} onChange={(_e, checked) => setCollisionEnabled(checked)} />} label={<Typography variant="caption">Collision</Typography>} />
          <Button size="small" onClick={() => zoomView(zoom - 0.1)}>
            -
          </Button>
          <Button size="small" onClick={() => zoomView(0.95)}>
            Reset
          </Button>
          <Button size="small" onClick={() => zoomView(zoom + 0.1)}>
            +
          </Button>
        </Box>
      </Box>

      <Box
        ref={scrollerRef}
        sx={{ flex: 1, minHeight: 0, overflow: "auto", cursor: dragPanRef.current.active ? "grabbing" : "grab", background: "#f8fafc", position: "relative" }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onMouseDown={(event) => {
          const target = event.target as Element;
          if (event.button === 1) {
            const el = scrollerRef.current;
            if (!el) return;
            dragPanRef.current = { active: true, x: event.clientX, y: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
            event.preventDefault();
            return;
          }
          if (target.closest("[data-diagram-interactive='true']")) return;
          if (event.button !== 0) return;
          const point = getSvgPointFromMouse(event.clientX, event.clientY);
          if (!point) return;
          const additive = event.ctrlKey || event.metaKey;
          setMarquee({
            startX: point.x,
            startY: point.y,
            endX: point.x,
            endY: point.y,
            additive
          });
          setConnectFrom(null);
          setConnectCursor(null);
        }}
        onContextMenu={(event) => {
          const target = event.target as Element;
          if (target.closest("[data-diagram-interactive='true']")) return;
          const point = getSvgPointFromMouse(event.clientX, event.clientY);
          if (!point) return;
          event.preventDefault();
          onSelectLink(-1);
          onSelectNodeIds?.([]);
          onCanvasContextMenu?.(
            { x: event.clientX, y: event.clientY },
            { x: Math.round(point.x), y: Math.round(point.y) }
          );
        }}
        onWheel={(event) => {
          if (!event.altKey) return;
          event.preventDefault();
          if (event.deltaY > 0) zoomView(zoom - 0.1);
          else zoomView(zoom + 0.1);
        }}
        onMouseMove={(event) => {
          handleInteractionMove(event.clientX, event.clientY);
        }}
        onMouseUp={handleInteractionEnd}
        onMouseLeave={() => {
          if (!dragNodeRef.current.active && !dragPanRef.current.active) return;
          handleInteractionEnd();
        }}
      >
        <Box sx={{ width: Math.max(1, diagramWidth * zoom), height: Math.max(1, diagramHeight * zoom), display: "inline-block" }}>
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${diagramWidth} ${diagramHeight}`} onDragOver={handleDragOver} onDrop={handleDrop}>
            <defs>
              <pattern id="flow-grid-pattern" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              </pattern>
              <marker id="flow-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#565656" />
              </marker>
            </defs>

            <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="#f8fafc" />
            <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="url(#flow-grid-pattern)" />

            {safeLinks.map((link, index) => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              const portIndex = Math.max(0, from.outputs.findIndex((output) => output.id === (link.fromPort || "default")));
              const outputLabel = from.outputs[portIndex]?.label ?? "OUT";
              const outputPillWidth = Math.max(50, outputLabel.length * 7 + 14);
              const startX = from.x + NODE_W / 2 + OUTPUT_PILL_OUTSIDE_GAP + outputPillWidth + OUTPUT_PILL_GAP + OUTPUT_PORT_RADIUS;
              const startY = getOutputY(from, portIndex);
              const endX = getInputPortX(to);
              const endY = to.y;
              const flowPath = buildFlowPath(startX, startY, endX, endY);
              const isSelected = selectedLinkIndex === index;
              const isEnabled = link.enabled !== false;

              return (
                <g key={`${link.from}-${link.to}-${link.fromPort ?? "default"}-${index}`}>
                  <path d={flowPath.path} fill="none" stroke="#ffffff" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={isEnabled ? undefined : "7 5"} markerEnd="url(#flow-arrow)" pointerEvents="none" />
                  <path d={flowPath.path} fill="none" stroke={isSelected ? "#dc2626" : isEnabled ? "#707070" : "#94a3b8"} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={isEnabled ? undefined : "7 5"} markerEnd="url(#flow-arrow)" pointerEvents="none" />
                  <path d={flowPath.path} fill="none" stroke="transparent" strokeWidth={20} data-diagram-interactive="true" onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }} />
                  <circle cx={flowPath.labelX} cy={flowPath.labelY + 5} r={10} fill="#fff" stroke="#94a3b8" strokeWidth={1} onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }} />
                  <text x={flowPath.labelX} y={flowPath.labelY + 8} textAnchor="middle" fontFamily="monospace" fontSize="11" fontWeight="700" fill="#0f172a" onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }}>
                    {index + 1}
                  </text>
                </g>
              );
            })}

            {connectFrom && connectCursor ? <path d={buildFlowPath(connectFrom.x, connectFrom.y, connectCursor.x, connectCursor.y).path} fill="none" stroke="#0f766e" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4" markerEnd="url(#flow-arrow)" pointerEvents="none" /> : null}
            {marquee ? (
              <rect
                x={Math.min(marquee.startX, marquee.endX)}
                y={Math.min(marquee.startY, marquee.endY)}
                width={Math.max(1, Math.abs(marquee.endX - marquee.startX))}
                height={Math.max(1, Math.abs(marquee.endY - marquee.startY))}
                fill="rgba(14,116,144,0.15)"
                stroke="#0e7490"
                strokeDasharray="5 4"
                pointerEvents="none"
              />
            ) : null}

            {placedNodes.map((node) => {
              const nodeH = getNodeHeight(node);
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    nodeElementRefs.current[node.id] = element;
                  }}
                  onClick={(event) => {
                    onSelectLink(-1);
                    if (event.ctrlKey || event.metaKey) {
                      const set = new Set(selectedNodeIds ?? []);
                      if (set.has(node.id)) set.delete(node.id);
                      else set.add(node.id);
                      onSelectNodeIds?.(Array.from(set));
                    } else {
                      onSelectNodeIds?.([node.id]);
                    }
                    event.stopPropagation();
                  }}
                  onDoubleClick={() => onNodeDoubleClick?.(node.id, node.kind)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onSelectLink(-1);
                    onSelectNodeIds?.([node.id]);
                    onNodeContextMenu?.(node.id, node.kind, { x: event.clientX, y: event.clientY });
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    const target = event.target as Element;
                    if (target.closest("[data-node-port='true']")) return;
                    onNodeDragStart?.();
                    const point = getSvgPointFromMouse(event.clientX, event.clientY);
                    if (!point) return;
                    const selectedSet = new Set(selectedNodeIds ?? []);
                    const dragIds = selectedSet.has(node.id) ? Array.from(selectedSet) : [node.id];
                    if (!selectedSet.has(node.id)) {
                      onSelectNodeIds?.([node.id]);
                    }
                    const startNodePositions: Record<string, NodePosition> = {};
                    dragIds.forEach((id) => {
                      const found = nodeMap.get(id);
                      if (found) startNodePositions[id] = { x: found.x, y: found.y };
                    });
                    dragNodeRef.current = {
                      active: true,
                      nodeIds: dragIds,
                      startMouseX: point.x,
                      startMouseY: point.y,
                      startNodePositions,
                      latestPositions: { ...startNodePositions }
                    };
                    setConnectFrom(null);
                    setConnectCursor(null);
                    event.stopPropagation();
                    event.preventDefault();
                  }}
                  data-diagram-interactive="true"
                  style={{ cursor: dragNodeRef.current.active && dragNodeRef.current.nodeIds.includes(node.id) ? "grabbing" : "grab" }}
                >
                  <rect
                    x={node.x - NODE_W / 2}
                    y={node.y - nodeH / 2}
                    width={NODE_W}
                    height={nodeH}
                    rx={18}
                    fill={node.fillColor || (node.kind === "action" ? "#01806b" : node.kind === "event" ? "#3366e8" : "#4b5563")}
                    stroke={node.fillColor || (node.kind === "action" ? "#01806b" : node.kind === "event" ? "#3366e8" : "#4b5563")}
                    strokeWidth={1}
                  />
                  <rect x={node.x - NODE_W / 2} y={node.y - nodeH / 2} width={ICON_LANE_W} height={nodeH} fill="rgba(255,255,255,0.16)" pointerEvents="none" />
                  <line x1={node.x - NODE_W / 2 + ICON_LANE_W} y1={node.y - nodeH / 2} x2={node.x - NODE_W / 2 + ICON_LANE_W} y2={node.y + nodeH / 2} stroke="rgba(255,255,255,0.34)" strokeWidth={1} pointerEvents="none" />
                  {selectedNodeIds.includes(node.id) ? <rect x={node.x - NODE_W / 2 - 4} y={node.y - nodeH / 2 - 4} width={NODE_W + 8} height={nodeH + 8} rx={22} fill="none" stroke="#dc2626" strokeWidth={2} /> : null}
                  {(() => {
                    const iconName = String(node.icon || "").trim();
                    const IconComp = iconName ? ICON_MAP[iconName] : undefined;
                    if (!IconComp) {
                      return (
                        <text x={node.x - NODE_W / 2 + ICON_LANE_W / 2} y={node.y + 5} textAnchor="middle" fontSize={16} fontWeight="700" fill={node.textColor || "#ffffff"} pointerEvents="none">
                          {iconName || "o"}
                        </text>
                      );
                    }
                    return (
                      <foreignObject x={node.x - NODE_W / 2 + (ICON_LANE_W - 24) / 2} y={node.y - 12} width={24} height={24} pointerEvents="none">
                        <div style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: node.textColor || "#ffffff" }}>
                          <IconComp size={ICON_SIZE} />
                        </div>
                      </foreignObject>
                    );
                  })()}
                  <foreignObject x={node.x - NODE_W / 2 + ICON_LANE_W + 12} y={node.y - 14} width={NODE_W - ICON_LANE_W - 34} height={28} pointerEvents="none">
                    <div
                      style={{
                        width: "100%",
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        fontSize: 14,
                        fontWeight: 700,
                        fontStyle: node.kind === "action" ? "italic" : "normal",
                        color: node.textColor || "#ffffff",
                        fontFamily: "inherit"
                      }}
                    >
                      {node.label}
                    </div>
                  </foreignObject>
                  {node.hasError ? (
                    <g pointerEvents="none">
                      <circle cx={node.x + NODE_W / 2 - 10} cy={node.y - nodeH / 2 + 10} r={6} fill="#dc2626" stroke="#ffffff" strokeWidth={2} />
                    </g>
                  ) : null}

                  <g>
                    <circle
                      cx={getInputPortX(node)}
                      cy={node.y}
                      r={8}
                      fill={connectFrom ? "#f8fafc" : "#ffffff"}
                      stroke={connectFrom ? "#0f766e" : "#64748b"}
                      strokeWidth={1.5}
                      data-diagram-interactive="true"
                      data-node-port="true"
                      onClick={(event) => {
                        if (!connectFrom || connectFrom.nodeId === node.id) {
                          event.stopPropagation();
                          return;
                        }
                        onConnectNodes?.(connectFrom.nodeId, node.id, connectFrom.portId);
                        setConnectFrom(null);
                        setConnectCursor(null);
                        event.stopPropagation();
                      }}
                      style={{ cursor: connectFrom && connectFrom.nodeId !== node.id ? "crosshair" : "default" }}
                    />
                    <rect
                      x={getInputPillX(node)}
                      y={node.y - INPUT_PILL_H / 2}
                      width={INPUT_PILL_W}
                      height={INPUT_PILL_H}
                      rx={4}
                      fill="#ffffff"
                      stroke={node.fillColor || (node.kind === "action" ? "#01806b" : node.kind === "event" ? "#3366e8" : "#4b5563")}
                      strokeWidth={2}
                    />
                    <text x={getInputPillX(node) + INPUT_PILL_W / 2} y={node.y + 3} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#0f172a">
                      {INPUT_PILL_LABEL}
                    </text>
                  </g>

                  {node.outputs.map((output, index) => {
                    const portY = getOutputY(node, index);
                    const pillLabel = output.label;
                    const pillWidth = Math.max(50, pillLabel.length * 7 + 14);
                    const pillHeight = 16;
                    const pillX = node.x + NODE_W / 2 + OUTPUT_PILL_OUTSIDE_GAP;
                    const portX = pillX + pillWidth + OUTPUT_PILL_GAP + OUTPUT_PORT_RADIUS;
                    const pillY = portY - pillHeight / 2;
                    return (
                      <g key={`${node.id}-${output.id}`}>
                        <rect
                          x={pillX}
                          y={pillY}
                          width={pillWidth}
                          height={pillHeight}
                          rx={4}
                          fill="#ffffff"
                          stroke={node.fillColor || (node.kind === "action" ? "#01806b" : node.kind === "event" ? "#3366e8" : "#4b5563")}
                          strokeWidth={2}
                        />
                        <text x={pillX + pillWidth / 2} y={portY + 3} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="#0f172a">
                          {pillLabel}
                        </text>
                        <circle
                          cx={portX}
                          cy={portY}
                          r={OUTPUT_PORT_RADIUS}
                          fill={connectFrom?.nodeId === node.id && connectFrom.portId === output.id ? "#ccfbf1" : "#ffffff"}
                          stroke={connectFrom?.nodeId === node.id && connectFrom.portId === output.id ? "#0f766e" : "#64748b"}
                          strokeWidth={1.5}
                          data-diagram-interactive="true"
                          data-node-port="true"
                          onClick={(event) => {
                            if (connectFrom?.nodeId === node.id && connectFrom.portId === output.id) {
                              setConnectFrom(null);
                              setConnectCursor(null);
                            } else {
                              setConnectFrom({ nodeId: node.id, portId: output.id, x: portX, y: portY });
                              setConnectCursor({ x: portX, y: portY });
                            }
                            event.stopPropagation();
                          }}
                          style={{ cursor: "crosshair" }}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </Box>
      </Box>
    </Box>
  );
}
