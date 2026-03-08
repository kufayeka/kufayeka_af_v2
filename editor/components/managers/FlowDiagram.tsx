import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { Box, Button, FormControlLabel, Switch, Typography } from "@mui/material";
import type { FlowLink, NodePosition } from "../../types/program";

type NodeKind = "trigger" | "action" | "event";

interface NodePoint {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
}

interface NodeMetrics {
  width: number;
  height: number;
  lines: string[];
}

interface FlowDiagramProps {
  triggerIds: string[];
  actionIds: string[];
  eventNodeIds?: string[];
  nodeLabels?: Record<string, string>;
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  selectedLinkIndex: number;
  selectedNodeId?: string;
  onSelectLink: (index: number) => void;
  onSelectNode?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string, kind: NodeKind) => void;
  onNodeDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
  onConnectNodes?: (fromId: string, toId: string) => void;
}

const NODE_WIDTH = 250;
const NODE_HEIGHT = 52;
const FLOW_NODE_MIN_WIDTH = 180;
const FLOW_NODE_MAX_WIDTH = 360;
const FLOW_NODE_MIN_HEIGHT = 52;
const NODE_TEXT_PADDING_X = 24;
const NODE_TEXT_PADDING_Y = 14;
const NODE_FONT_SIZE = 20;
const NODE_LINE_HEIGHT = 18;
const COLLISION_PADDING = 14;
const GRID_SIZE = 10;
const LINE_CURVE_SCALE = 0.75;

function measureTextWidth(text: string): number {
  return text.length * (NODE_FONT_SIZE * 0.57);
}

function splitLongToken(token: string, maxTextWidth: number): string[] {
  if (measureTextWidth(token) <= maxTextWidth) return [token];
  const result: string[] = [];
  let current = "";
  for (const char of token) {
    const next = current + char;
    if (measureTextWidth(next) > maxTextWidth && current) {
      result.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) result.push(current);
  return result;
}

function wrapNodeText(text: string, maxTextWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const chunks = splitLongToken(word, maxTextWidth);
    for (const chunk of chunks) {
      const attempt = current ? `${current} ${chunk}` : chunk;
      if (measureTextWidth(attempt) <= maxTextWidth) {
        current = attempt;
      } else {
        if (current) lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

function getNodeMetrics(kind: NodeKind, label: string): NodeMetrics {
  const maxTextWidth = FLOW_NODE_MAX_WIDTH - NODE_TEXT_PADDING_X * 2;
  const lines = wrapNodeText(label, maxTextWidth);
  const widestLine = lines.reduce((max, line) => Math.max(max, measureTextWidth(line)), 0);
  const width = Math.max(
    FLOW_NODE_MIN_WIDTH,
    Math.min(FLOW_NODE_MAX_WIDTH, Math.ceil(widestLine + NODE_TEXT_PADDING_X * 2))
  );
  const textHeight = Math.max(NODE_LINE_HEIGHT, lines.length * NODE_LINE_HEIGHT);
  const height = Math.max(FLOW_NODE_MIN_HEIGHT, Math.ceil(textHeight + NODE_TEXT_PADDING_Y * 2));
  return { width, height, lines };
}

function generateLinkPath(
  origX: number,
  origY: number,
  destX: number,
  destY: number,
  laneWidth: number,
  laneHeight: number,
  sc = 1
): string {
  const dy = destY - origY;
  const dx = destX - origX;
  const delta = Math.sqrt(dy * dy + dx * dx);
  let scale = LINE_CURVE_SCALE;
  if (dx * sc > 0) {
    if (delta < laneWidth) {
      scale = 0.75 - 0.75 * ((laneWidth - delta) / laneWidth);
    }
    const cp1x = origX + sc * (laneWidth * scale);
    const cp1y = origY;
    const cp2x = destX - sc * (laneWidth * scale);
    const cp2y = destY;
    return `M ${origX} ${origY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${destX} ${destY}`;
  }

  scale = 0.4 - 0.2 * (Math.max(0, (laneWidth - Math.min(Math.abs(dx), Math.abs(dy))) / laneWidth));
  const cpHeight = laneHeight / 2;
  const midX = Math.floor(destX - dx / 2);
  const midY = Math.floor(destY - dy / 2);
  const y1 = (destY + midY) / 2;
  const topX = origX + sc * laneWidth * scale;
  const topY = dy > 0 ? Math.min(y1 - dy / 2, origY + cpHeight) : Math.max(y1 - dy / 2, origY - cpHeight);
  const bottomX = destX - sc * laneWidth * scale;
  const bottomY = dy > 0 ? Math.max(y1, destY - cpHeight) : Math.min(y1, destY + cpHeight);
  const x1 = (origX + topX) / 2;
  const scy = dy > 0 ? 1 : -1;
  const cp = [
    [x1, origY],
    [topX, dy > 0 ? Math.max(origY, topY - cpHeight) : Math.min(origY, topY + cpHeight)],
    [x1, dy > 0 ? Math.min(midY, topY + cpHeight) : Math.max(midY, topY - cpHeight)],
    [bottomX, dy > 0 ? Math.max(midY, bottomY - cpHeight) : Math.min(midY, bottomY + cpHeight)],
    [(destX + bottomX) / 2, destY]
  ];

  if (cp[2][1] === topY + scy * cpHeight) {
    if (Math.abs(dy) < cpHeight * 10) {
      cp[1][1] = topY - scy * cpHeight / 2;
      cp[3][1] = bottomY - scy * cpHeight / 2;
    }
    cp[2][0] = topX;
  }

  return (
    `M ${origX} ${origY} ` +
    `C ${cp[0][0]} ${cp[0][1]} ${cp[1][0]} ${cp[1][1]} ${topX} ${topY} ` +
    `S ${cp[2][0]} ${cp[2][1]} ${midX} ${midY} ` +
    `S ${cp[3][0]} ${cp[3][1]} ${bottomX} ${bottomY} ` +
    `S ${cp[4][0]} ${cp[4][1]} ${destX} ${destY}`
  );
}

export default function FlowDiagram({
  triggerIds,
  actionIds,
  eventNodeIds = [],
  nodeLabels = {},
  links,
  nodePositions,
  zoom: controlledZoom,
  onZoomChange,
  selectedLinkIndex,
  selectedNodeId,
  onSelectLink,
  onSelectNode,
  onNodeDoubleClick,
  onNodeDragStart,
  onNodePositionChange,
  onConnectNodes
}: FlowDiagramProps) {
  const allIds = useMemo(() => [...triggerIds, ...actionIds, ...eventNodeIds], [triggerIds, actionIds, eventNodeIds]);
  const kindMap = useMemo(() => {
    const map = new Map<string, NodeKind>();
    for (const id of triggerIds) map.set(id, "trigger");
    for (const id of actionIds) map.set(id, "action");
    for (const id of eventNodeIds) map.set(id, "event");
    return map;
  }, [triggerIds, actionIds, eventNodeIds]);

  const [liveNodePositions, setLiveNodePositions] = useState<Record<string, NodePosition>>({});
  useEffect(() => {
    setLiveNodePositions({});
  }, [nodePositions]);

  const nodes = useMemo<NodePoint[]>(() => {
    const result: NodePoint[] = [];
    for (const id of allIds) {
      const live = liveNodePositions[id];
      const fixed = nodePositions[id];
      const pos = live || fixed;
      if (!pos) continue;
      result.push({
        id,
        x: pos.x,
        y: pos.y,
        kind: kindMap.get(id) || "action"
      });
    }
    return result;
  }, [allIds, kindMap, liveNodePositions, nodePositions]);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);
  const nodeMetricsMap = useMemo(() => {
    const map = new Map<string, NodeMetrics>();
    for (const node of nodes) {
      const displayText = (nodeLabels[node.id] || node.id).trim() || node.id;
      map.set(node.id, getNodeMetrics(node.kind, displayText));
    }
    return map;
  }, [nodes, nodeLabels]);
  const maxX = nodes.reduce((acc, node) => Math.max(acc, node.x), 0);
  const maxY = nodes.reduce((acc, node) => Math.max(acc, node.y), 0);
  const maxNodeWidth = Array.from(nodeMetricsMap.values()).reduce((acc, metric) => Math.max(acc, metric.width), NODE_WIDTH);
  const maxNodeHeight = Array.from(nodeMetricsMap.values()).reduce((acc, metric) => Math.max(acc, metric.height), NODE_HEIGHT);
  const diagramWidth = Math.max(1400, maxX + maxNodeWidth + 60);
  const diagramHeight = Math.max(760, maxY + maxNodeHeight + 60);

  const [internalZoom, setInternalZoom] = useState(0.5);
  const zoom = controlledZoom ?? internalZoom;
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [collisionEnabled, setCollisionEnabled] = useState(true);
  const [connectFromId, setConnectFromId] = useState("");
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragPanRef = useRef({
    active: false,
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0
  });
  const dragNodeRef = useRef<{
    active: boolean;
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
    latestX: number;
    latestY: number;
  }>({
    active: false,
    nodeId: "",
    startMouseX: 0,
    startMouseY: 0,
    startNodeX: 0,
    startNodeY: 0,
    latestX: 0,
    latestY: 0
  });
  const dragRafRef = useRef<number | null>(null);

  const findNonOverlappingPosition = (nodeId: string, targetX: number, targetY: number): { x: number; y: number } => {
    const metric = nodeMetricsMap.get(nodeId) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [nodeId] };
    const minX = Math.ceil(metric.width / 2) + 10;
    const minY = Math.ceil(metric.height / 2) + 10;

    const collidesAt = (candidateX: number, candidateY: number): boolean => {
      const left = candidateX - metric.width / 2 - COLLISION_PADDING;
      const right = candidateX + metric.width / 2 + COLLISION_PADDING;
      const top = candidateY - metric.height / 2 - COLLISION_PADDING;
      const bottom = candidateY + metric.height / 2 + COLLISION_PADDING;
      for (const other of nodes) {
        if (other.id === nodeId) continue;
        const otherMetric = nodeMetricsMap.get(other.id) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [other.id] };
        const otherLeft = other.x - otherMetric.width / 2;
        const otherRight = other.x + otherMetric.width / 2;
        const otherTop = other.y - otherMetric.height / 2;
        const otherBottom = other.y + otherMetric.height / 2;
        const overlap = !(right < otherLeft || left > otherRight || bottom < otherTop || top > otherBottom);
        if (overlap) return true;
      }
      return false;
    };

    const clamp = (x: number, y: number) => ({ x: Math.max(minX, x), y: Math.max(minY, y) });
    const first = clamp(targetX, targetY);
    if (!collisionEnabled || !collidesAt(first.x, first.y)) return first;
    const step = gridSnapEnabled ? GRID_SIZE : 8;
    for (let ring = 1; ring <= 24; ring += 1) {
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

  const zoomView = (factor: number) => {
    const nextZoom = Math.max(0.3, Math.min(2, Number(factor.toFixed(2))));
    const el = scrollerRef.current;
    if (!el) {
      if (controlledZoom === undefined) setInternalZoom(nextZoom);
      onZoomChange?.(nextZoom);
      return;
    }
    const screenW = el.clientWidth;
    const screenH = el.clientHeight;
    const scrollLeft = el.scrollLeft;
    const scrollTop = el.scrollTop;
    const centerX = (scrollLeft + screenW / 2) / zoom;
    const centerY = (scrollTop + screenH / 2) / zoom;
    if (controlledZoom === undefined) setInternalZoom(nextZoom);
    onZoomChange?.(nextZoom);
    requestAnimationFrame(() => {
      const updated = scrollerRef.current;
      if (!updated) return;
      updated.scrollLeft = centerX * nextZoom - screenW / 2;
      updated.scrollTop = centerY * nextZoom - screenH / 2;
    });
  };
  const zoomIn = () => zoomView(zoom + 0.1);
  const zoomOut = () => zoomView(zoom - 0.1);
  const zoomReset = () => zoomView(0.5);

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
    if (!dragNodeRef.current.active || !dragNodeRef.current.nodeId) return;
    const nodeId = dragNodeRef.current.nodeId;
    onNodePositionChange?.(nodeId, {
      x: dragNodeRef.current.latestX || dragNodeRef.current.startNodeX,
      y: dragNodeRef.current.latestY || dragNodeRef.current.startNodeY
    });
    dragNodeRef.current.active = false;
  };

  const hasFlowNodePayload = (event: ReactDragEvent): boolean => {
    const types = Array.from(event.dataTransfer.types || []);
    return types.includes("application/x-flow-node") || types.includes("text/plain");
  };

  const getDraggedNodeId = (event: ReactDragEvent): string => {
    const raw =
      event.dataTransfer.getData("application/x-flow-node") ||
      event.dataTransfer.getData("text/plain");
    return String(raw || "").trim();
  };

  const handleDragOver = (event: ReactDragEvent) => {
    if (!hasFlowNodePayload(event)) return;
    event.dataTransfer.dropEffect = "move";
    event.preventDefault();
  };

  const handleDrop = (event: ReactDragEvent) => {
    const nodeId = getDraggedNodeId(event);
    if (!nodeId) return;
    const point = getSvgPointFromMouse(event.clientX, event.clientY);
    if (!point) return;
    const nextX = gridSnapEnabled ? Math.round(point.x / GRID_SIZE) * GRID_SIZE : point.x;
    const nextY = gridSnapEnabled ? Math.round(point.y / GRID_SIZE) * GRID_SIZE : point.y;
    const resolved = findNonOverlappingPosition(nodeId, nextX, nextY);
    onNodeDragStart?.();
    onNodePositionChange?.(nodeId, {
      x: resolved.x,
      y: resolved.y
    });
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
        userSelect: "none",
        WebkitUserSelect: "none",
        "@keyframes wireBlink": {
          "0%": { opacity: 1 },
          "50%": { opacity: 0.2 },
          "100%": { opacity: 1 }
        }
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Box
        sx={{
          p: 0.5,
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Zoom: {Math.round(zoom * 100)}% | Middle-click drag to pan | Alt+Wheel zoom | Click wire + Delete
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
          <FormControlLabel
            sx={{ mr: 0.5 }}
            control={<Switch size="small" checked={gridSnapEnabled} onChange={(_e, checked) => setGridSnapEnabled(checked)} />}
            label={<Typography variant="caption">Grid Snap</Typography>}
          />
          <FormControlLabel
            sx={{ mr: 0.5 }}
            control={<Switch size="small" checked={collisionEnabled} onChange={(_e, checked) => setCollisionEnabled(checked)} />}
            label={<Typography variant="caption">Collision</Typography>}
          />
          <Button size="small" onClick={zoomOut}>-</Button>
          <Button size="small" onClick={zoomReset}>Reset</Button>
          <Button size="small" onClick={zoomIn}>+</Button>
        </Box>
      </Box>

      <Box
        ref={scrollerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowX: "auto",
          overflowY: "auto",
          cursor: dragPanRef.current.active ? "grabbing" : "grab",
          background: "#f8fafc",
          position: "relative"
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onMouseDown={(event) => {
          const target = event.target as Element;
          if (event.button === 1) {
            const el = scrollerRef.current;
            if (!el) return;
            dragPanRef.current = {
              active: true,
              x: event.clientX,
              y: event.clientY,
              scrollLeft: el.scrollLeft,
              scrollTop: el.scrollTop
            };
            event.preventDefault();
            return;
          }
          if (target.closest("[data-diagram-interactive='true']")) return;
          if (event.button !== 0) return;
          onSelectNode?.("");
          setConnectFromId("");
          setConnectCursor(null);
        }}
        onWheel={(event) => {
          if (!event.altKey) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.deltaY > 0) zoomOut();
          else zoomIn();
        }}
        onMouseMove={(event) => {
          const el = scrollerRef.current;
          if (!el) return;

          if (dragNodeRef.current.active) {
            const point = getSvgPointFromMouse(event.clientX, event.clientY);
            if (!point) return;
            const dx = point.x - dragNodeRef.current.startMouseX;
            const dy = point.y - dragNodeRef.current.startMouseY;
            const rawX = dragNodeRef.current.startNodeX + dx;
            const rawY = dragNodeRef.current.startNodeY + dy;
            const nextX = gridSnapEnabled ? Math.round(rawX / GRID_SIZE) * GRID_SIZE : rawX;
            const nextY = gridSnapEnabled ? Math.round(rawY / GRID_SIZE) * GRID_SIZE : rawY;
            const resolved = findNonOverlappingPosition(dragNodeRef.current.nodeId, nextX, nextY);
            dragNodeRef.current.latestX = resolved.x;
            dragNodeRef.current.latestY = resolved.y;

            if (dragRafRef.current === null) {
              dragRafRef.current = requestAnimationFrame(() => {
                dragRafRef.current = null;
                if (!dragNodeRef.current.nodeId) return;
                setLiveNodePositions((prev) => ({
                  ...prev,
                  [dragNodeRef.current.nodeId]: {
                    x: dragNodeRef.current.latestX,
                    y: dragNodeRef.current.latestY
                  }
                }));
              });
            }
            return;
          }

          if (connectFromId) {
            const point = getSvgPointFromMouse(event.clientX, event.clientY);
            if (point) setConnectCursor(point);
          }

          if (!dragPanRef.current.active) return;
          const dx = event.clientX - dragPanRef.current.x;
          const dy = event.clientY - dragPanRef.current.y;
          el.scrollLeft = dragPanRef.current.scrollLeft - dx;
          el.scrollTop = dragPanRef.current.scrollTop - dy;
        }}
        onMouseUp={() => {
          dragPanRef.current.active = false;
          if (dragRafRef.current !== null) {
            cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = null;
          }
          commitDragNode();
        }}
        onMouseLeave={() => {
          dragPanRef.current.active = false;
          if (dragRafRef.current !== null) {
            cancelAnimationFrame(dragRafRef.current);
            dragRafRef.current = null;
          }
          commitDragNode();
        }}
      >
        <Box
          sx={{ width: Math.max(1, diagramWidth * zoom), height: Math.max(1, diagramHeight * zoom), display: "inline-block" }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <defs>
              <pattern id="gridPattern" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" stroke="#e2e8f0" strokeWidth="1" />
              </pattern>
              <marker id="flowArrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#565656" />
              </marker>
            </defs>

            <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="#f8fafc" />
            <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="url(#gridPattern)" />

            {links.map((link, index) => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              const fromMetric = nodeMetricsMap.get(from.id) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [from.id] };
              const toMetric = nodeMetricsMap.get(to.id) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [to.id] };
              const fromHalfWidth = fromMetric.width / 2;
              const toHalfWidth = toMetric.width / 2;
              const laneWidth = Math.max(fromMetric.width, toMetric.width);
              const laneHeight = Math.max(fromMetric.height, toMetric.height);
              const startX = from.x + fromHalfWidth;
              const startY = from.y;
              const endX = to.x - toHalfWidth;
              const endY = to.y;
              const d = generateLinkPath(startX, startY, endX, endY, laneWidth, laneHeight, 1);
              const isSelected = selectedLinkIndex === index;
              const isEnabled = link.enabled !== false;
              const edgeLabelX = (startX + endX) / 2;
              const edgeLabelY = (startY + endY) / 2 - 8;

              return (
                <g key={`${link.from}-${link.to}-${index}`}>
                  <path d={d} fill="none" stroke="#ffffff" strokeWidth={7} strokeDasharray={isEnabled ? undefined : "7 5"} markerEnd="url(#flowArrow)" pointerEvents="none" />
                  <path d={d} fill="none" stroke={isSelected ? "#dc2626" : isEnabled ? "#707070" : "#94a3b8"} strokeWidth={4} strokeDasharray={isEnabled ? undefined : "7 5"} markerEnd="url(#flowArrow)" pointerEvents="none" style={isSelected ? { animation: "wireBlink 0.8s linear infinite" } : undefined} />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={20} data-diagram-interactive="true" onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }} />
                  <circle cx={edgeLabelX} cy={edgeLabelY + 5} r={10} fill="#fff" stroke="#94a3b8" strokeWidth={1} onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }} />
                  <text x={edgeLabelX} y={edgeLabelY + 8} textAnchor="middle" fontFamily="Ubuntu, 'Segoe UI', Arial, sans-serif" fontSize="11" fontWeight="700" fill="#0f172a" onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }}>
                    {index + 1}
                  </text>
                </g>
              );
            })}

            {connectFromId && connectCursor && (() => {
              const from = nodeMap.get(connectFromId);
              if (!from) return null;
              const fromMetric = nodeMetricsMap.get(from.id) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [from.id] };
              const d = generateLinkPath(
                from.x + fromMetric.width / 2,
                from.y,
                connectCursor.x,
                connectCursor.y,
                fromMetric.width,
                fromMetric.height,
                1
              );
              return <path d={d} fill="none" stroke="#0f766e" strokeWidth={3} strokeDasharray="6 4" markerEnd="url(#flowArrow)" pointerEvents="none" />;
            })()}

            {nodes.map((node) => {
              const metric = nodeMetricsMap.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT, lines: [node.id] };
              const halfWidth = metric.width / 2;
              const halfHeight = metric.height / 2;
              const displayLines = metric.lines.length > 0 ? metric.lines : [(nodeLabels[node.id] || node.id).trim() || node.id];
              return (
              <g
                key={node.id}
                onClick={(event) => {
                  onSelectLink(-1);
                  onSelectNode?.(node.id);
                  event.stopPropagation();
                }}
                onDoubleClick={() => onNodeDoubleClick?.(node.id, node.kind)}
                onMouseDown={(event) => {
                  const target = event.target as Element;
                  if (target.closest("[data-node-port='true']")) return;
                  onNodeDragStart?.();
                  const point = getSvgPointFromMouse(event.clientX, event.clientY);
                  if (!point) return;
                  dragNodeRef.current = { active: true, nodeId: node.id, startMouseX: point.x, startMouseY: point.y, startNodeX: node.x, startNodeY: node.y, latestX: node.x, latestY: node.y };
                  setConnectFromId("");
                  setConnectCursor(null);
                  event.stopPropagation();
                  event.preventDefault();
                }}
                data-diagram-interactive="true"
                style={{ cursor: dragNodeRef.current.active && dragNodeRef.current.nodeId === node.id ? "grabbing" : "grab" }}
              >
                <rect
                  x={node.x - halfWidth}
                  y={node.y - halfHeight}
                  width={metric.width}
                  height={metric.height}
                  rx={20}
                  fill={node.kind === "action" ? "#01806b" : node.kind === "event" ? "#1d4ed8" : "#676e6c"}
                  stroke={node.kind === "action" ? "#14f4b4" : node.kind === "event" ? "#7dd3fc" : "#0f766e"}
                  strokeWidth={0.7}
                />
                {selectedNodeId === node.id && (
                  <rect
                    x={node.x - halfWidth - 4}
                    y={node.y - halfHeight - 4}
                    width={metric.width + 8}
                    height={metric.height + 8}
                    rx={24}
                    fill="none"
                    stroke="#dc2626"
                    strokeWidth={2}
                  />
                )}
                <title>{node.id}</title>
                <text x={node.x} y={node.y - ((displayLines.length - 1) * NODE_LINE_HEIGHT) / 2 + 6} textAnchor="middle" fontSize={NODE_FONT_SIZE} fontWeight="500" fill="#ffffff">
                  {displayLines.map((line, index) => (
                    <tspan key={`${node.id}-line-${index}`} x={node.x} dy={index === 0 ? 0 : NODE_LINE_HEIGHT}>
                      {line}
                    </tspan>
                  ))}
                </text>

                <circle
                  cx={node.x - halfWidth}
                  cy={node.y}
                  r={8}
                  fill={connectFromId ? "#f8fafc" : "#ffffff"}
                  stroke={connectFromId ? "#0f766e" : "#64748b"}
                  strokeWidth={1.5}
                  data-diagram-interactive="true"
                  data-node-port="true"
                  onClick={(event) => {
                    if (!connectFromId || connectFromId === node.id) {
                      event.stopPropagation();
                      return;
                    }
                    onConnectNodes?.(connectFromId, node.id);
                    setConnectFromId("");
                    setConnectCursor(null);
                    event.stopPropagation();
                  }}
                  style={{ cursor: connectFromId && connectFromId !== node.id ? "crosshair" : "default" }}
                />
                <circle
                  cx={node.x + halfWidth}
                  cy={node.y}
                  r={8}
                  fill={connectFromId === node.id ? "#ccfbf1" : "#ffffff"}
                  stroke={connectFromId === node.id ? "#0f766e" : "#64748b"}
                  strokeWidth={1.5}
                  data-diagram-interactive="true"
                  data-node-port="true"
                  onClick={(event) => {
                    if (connectFromId === node.id) {
                      setConnectFromId("");
                      setConnectCursor(null);
                    } else {
                      setConnectFromId(node.id);
                      setConnectCursor({ x: node.x + halfWidth, y: node.y });
                    }
                    event.stopPropagation();
                  }}
                  style={{ cursor: "crosshair" }}
                />
              </g>
            );
            })}
          </svg>
        </Box>
      </Box>
    </Box>
  );
}
