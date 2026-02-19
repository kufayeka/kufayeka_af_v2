import { useMemo, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import type { FlowLink, NodePosition } from "../../types/program";

type NodeKind = "trigger" | "action";

interface NodePoint {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
}

interface FlowDiagramProps {
  triggerIds: string[];
  actionIds: string[];
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  selectedLinkIndex: number;
  onSelectLink: (index: number) => void;
  onNodeDoubleClick?: (nodeId: string, kind: NodeKind) => void;
  onNodeDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
}

function buildSideLayout(triggerIds: string[], actionIds: string[], links: FlowLink[]): NodePoint[] {
  const nodeKindMap = new Map<string, NodeKind>();
  for (const id of triggerIds) nodeKindMap.set(id, "trigger");
  for (const id of actionIds) nodeKindMap.set(id, "action");

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const allNodeIds = new Set<string>([...triggerIds, ...actionIds]);

  for (const link of links) {
    allNodeIds.add(link.from);
    allNodeIds.add(link.to);
    if (!outgoing.has(link.from)) outgoing.set(link.from, []);
    if (!incoming.has(link.to)) incoming.set(link.to, []);
    outgoing.get(link.from)?.push(link.to);
    incoming.get(link.to)?.push(link.from);
  }

  const orderedIds = [
    ...triggerIds,
    ...actionIds.filter((id) => !triggerIds.includes(id)),
    ...Array.from(allNodeIds).filter((id) => !triggerIds.includes(id) && !actionIds.includes(id))
  ];

  const depthMap = new Map<string, number>();
  for (const id of orderedIds) depthMap.set(id, 0);
  const roots = orderedIds.filter((id) => (incoming.get(id)?.length || 0) === 0);

  const queue = [...roots];
  const visitedCount = new Map<string, number>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentDepth = depthMap.get(current) || 0;
    const nexts = outgoing.get(current) || [];
    for (const nextId of nexts) {
      const candidateDepth = currentDepth + 1;
      if ((depthMap.get(nextId) || 0) < candidateDepth) depthMap.set(nextId, candidateDepth);
      visitedCount.set(nextId, (visitedCount.get(nextId) || 0) + 1);
      const needed = incoming.get(nextId)?.length || 0;
      if ((visitedCount.get(nextId) || 0) >= needed) queue.push(nextId);
    }
  }

  const nodesByDepth = new Map<number, string[]>();
  for (const id of orderedIds) {
    const depth = depthMap.get(id) || 0;
    if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, []);
    nodesByDepth.get(depth)?.push(id);
  }

  const H_GAP = 320;
  const V_GAP = 100;
  const MIN_GAP = 88;
  const LEFT = 170;
  const BASE_Y = 90;
  const yMap = new Map<string, number>();

  const allDepths = Array.from(nodesByDepth.keys()).sort((a, b) => a - b);
  for (const depth of allDepths) {
    const ids = nodesByDepth.get(depth) || [];
    ids.forEach((id, index) => yMap.set(id, BASE_Y + index * V_GAP));
  }

  const relaxLayer = (depth: number, useParents: boolean) => {
    const ids = nodesByDepth.get(depth) || [];
    const scored = ids.map((id) => {
      const refs = useParents ? incoming.get(id) || [] : outgoing.get(id) || [];
      if (refs.length === 0) return { id, score: yMap.get(id) || BASE_Y };
      const avg = refs.reduce((acc, refId) => acc + (yMap.get(refId) || BASE_Y), 0) / refs.length;
      const current = yMap.get(id) || BASE_Y;
      return { id, score: current * 0.35 + avg * 0.65 };
    });

    scored.sort((a, b) => a.score - b.score);
    let prevY = BASE_Y - MIN_GAP;
    for (const item of scored) {
      const nextY = Math.max(item.score, prevY + MIN_GAP);
      yMap.set(item.id, nextY);
      prevY = nextY;
    }
  };

  for (let i = 0; i < 3; i += 1) {
    for (const depth of allDepths) if (depth > 0) relaxLayer(depth, true);
    for (const depth of [...allDepths].reverse()) if (depth < allDepths[allDepths.length - 1]) relaxLayer(depth, false);
  }

  for (const [targetId, parents] of incoming.entries()) {
    if (parents.length < 2) continue;
    const targetY = yMap.get(targetId) || BASE_Y;
    for (const parentId of parents) {
      const parentOut = outgoing.get(parentId) || [];
      if (parentOut.length === 1) {
        const currentY = yMap.get(parentId) || BASE_Y;
        yMap.set(parentId, currentY * 0.25 + targetY * 0.75);
      }
    }
  }

  for (const depth of allDepths) {
    const ids = nodesByDepth.get(depth) || [];
    ids.sort((a, b) => (yMap.get(a) || BASE_Y) - (yMap.get(b) || BASE_Y));
    let prevY = BASE_Y - MIN_GAP;
    for (const id of ids) {
      const y = Math.max(yMap.get(id) || BASE_Y, prevY + MIN_GAP);
      yMap.set(id, y);
      prevY = y;
    }
  }

  return orderedIds.map((id) => ({
    id,
    x: LEFT + (depthMap.get(id) || 0) * H_GAP,
    y: yMap.get(id) || BASE_Y,
    kind: nodeKindMap.get(id) || "action"
  }));
}

export default function FlowDiagram({
  triggerIds,
  actionIds,
  links,
  nodePositions,
  selectedLinkIndex,
  onSelectLink,
  onNodeDoubleClick,
  onNodeDragStart,
  onNodePositionChange
}: FlowDiagramProps) {
  const autoNodes = useMemo(
    () => buildSideLayout(triggerIds, actionIds, links),
    [triggerIds, actionIds, links]
  );

  const nodes = useMemo(() => {
    return autoNodes.map((node) => {
      const manual = nodePositions[node.id];
      if (!manual) return node;
      return { ...node, x: manual.x, y: manual.y };
    });
  }, [autoNodes, nodePositions]);

  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const maxX = nodes.reduce((acc, node) => Math.max(acc, node.x), 0);
  const maxY = nodes.reduce((acc, node) => Math.max(acc, node.y), 0);
  const diagramWidth = Math.max(1200, maxX + 260);
  const diagramHeight = Math.max(420, maxY + 140);

  const [zoom, setZoom] = useState(0.75);
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
    dx: number;
    dy: number;
  }>({
    active: false,
    nodeId: "",
    dx: 0,
    dy: 0
  });

  const zoomIn = () => setZoom((prev) => Math.min(2, Number((prev + 0.1).toFixed(2))));
  const zoomOut = () => setZoom((prev) => Math.max(0.35, Number((prev - 0.1).toFixed(2))));
  const zoomReset = () => setZoom(0.75);

  return (
    <Box
      sx={{
        border: "1px solid #cbd5e1",
        borderRadius: 2,
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
        "@keyframes wireBlink": {
          "0%": { opacity: 1 },
          "50%": { opacity: 0.2 },
          "100%": { opacity: 1 }
        }
      }}
    >
      <Box
        sx={{
          p: 1,
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Zoom: {Math.round(zoom * 100)}% | Drag canvas to pan | Drag move icon to reposition script node
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75 }}>
          <Button size="small" onClick={zoomOut}>
            -
          </Button>
          <Button size="small" onClick={zoomReset}>
            Reset
          </Button>
          <Button size="small" onClick={zoomIn}>
            +
          </Button>
        </Box>
      </Box>

      <Box
        ref={scrollerRef}
        sx={{
          height: 420,
          overflow: "auto",
          cursor: dragPanRef.current.active ? "grabbing" : "grab",
          background: "#f8fafc",
          userSelect: "none",
          WebkitUserSelect: "none"
        }}
        onMouseDown={(event) => {
          const target = event.target as Element;
          if (target.closest("[data-diagram-interactive='true']")) return;

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
        }}
        onMouseMove={(event) => {
          const el = scrollerRef.current;
          if (!el) return;

          if (dragNodeRef.current.active) {
            const svg = svgRef.current;
            if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const scaleX = diagramWidth / rect.width;
            const scaleY = diagramHeight / rect.height;
            const svgX = (event.clientX - rect.left) * scaleX;
            const svgY = (event.clientY - rect.top) * scaleY;

            onNodePositionChange?.(dragNodeRef.current.nodeId, {
              x: Math.max(130, svgX - dragNodeRef.current.dx),
              y: Math.max(60, svgY - dragNodeRef.current.dy)
            });
            return;
          }

          if (!dragPanRef.current.active) return;
          const dx = event.clientX - dragPanRef.current.x;
          const dy = event.clientY - dragPanRef.current.y;
          el.scrollLeft = dragPanRef.current.scrollLeft - dx;
          el.scrollTop = dragPanRef.current.scrollTop - dy;
        }}
        onMouseUp={() => {
          dragPanRef.current.active = false;
          dragNodeRef.current.active = false;
        }}
        onMouseLeave={() => {
          dragPanRef.current.active = false;
          dragNodeRef.current.active = false;
        }}
      >
        <svg
          ref={svgRef}
          width={diagramWidth * zoom}
          height={diagramHeight * zoom}
          viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
        >
          <defs>
            <marker
              id="flowArrow"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f172a" />
            </marker>
          </defs>

          <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="#f8fafc" />

          {links.map((link, index) => {
            const from = nodeMap.get(link.from);
            const to = nodeMap.get(link.to);
            if (!from || !to) return null;

            const startX = from.x + 125;
            const startY = from.y;
            const endX = to.x - 125;
            const endY = to.y;
            const midX = (startX + endX) / 2;
            const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
            const isSelected = selectedLinkIndex === index;
            const edgeLabelX = midX;
            const edgeLabelY = (startY + endY) / 2 - 8;

            return (
              <g key={`${link.from}-${link.to}-${index}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={isSelected ? "#dc2626" : "#1e293b"}
                  strokeWidth={1.5}
                  markerEnd="url(#flowArrow)"
                  pointerEvents="none"
                  style={isSelected ? { animation: "wireBlink 0.8s linear infinite" } : undefined}
                />
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={20}
                  data-diagram-interactive="true"
                  onClick={() => onSelectLink(index)}
                  style={{ cursor: "pointer" }}
                />
                <circle cx={edgeLabelX} cy={edgeLabelY+5} r={11} fill="#fff" stroke="#94a3b8" strokeWidth={1} onClick={() => onSelectLink(index)} style={{ cursor: "pointer" }}/>
                <text
                  x={edgeLabelX}
                  y={edgeLabelY + 8}
                  textAnchor="middle"
                  fontFamily="Arial, sans-serif"
                  fontSize="11"
                  fontWeight="700"
                  fill="#0f172a"
                  onClick={() => onSelectLink(index)}
                  style={{ cursor: "pointer" }}
                >
                  {index + 1}
                </text>
              </g>
            );
          })}

          {nodes.map((node) => {
            const isAction = node.kind === "action";
            const moveIconX = node.x + 106;
            const moveIconY = node.y - 20;

            return (
              <g
                key={node.id}
                onDoubleClick={() => onNodeDoubleClick?.(node.id, node.kind)}
                data-diagram-interactive="true"
                style={{ cursor: isAction ? "pointer" : "default" }}
              >
                <rect
                  x={node.x - 125}
                  y={node.y - 26}
                  width={250}
                  height={52}
                  rx={10}
                  fill={isAction ? "#dbeafe" : "#ccfbf1"}
                  stroke={isAction ? "#2563eb" : "#0f766e"}
                  strokeWidth={0.7}
                />
                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  fontFamily="Arial, sans-serif"
                  fontSize={isAction ? "14" : "12"}
                  fontWeight={isAction ? "700" : "600"}
                  fill="#0f172a"
                >
                  {node.id}
                </text>

                {isAction && (
                  <g
                    data-diagram-interactive="true"
                    onMouseDown={(event) => {
                      const svg = svgRef.current;
                      if (!svg) return;
                      onNodeDragStart?.();
                      const rect = svg.getBoundingClientRect();
                      const scaleX = diagramWidth / rect.width;
                      const scaleY = diagramHeight / rect.height;
                      const svgX = (event.clientX - rect.left) * scaleX;
                      const svgY = (event.clientY - rect.top) * scaleY;

                      dragNodeRef.current = {
                        active: true,
                        nodeId: node.id,
                        dx: svgX - node.x,
                        dy: svgY - node.y
                      };
                      event.stopPropagation();
                      event.preventDefault();
                    }}
                  >
                    <rect
                      x={moveIconX - 20}
                      y={moveIconY - 10}
                      width={40}
                      height={20}
                      rx={4}
                      fill="#ffffff"
                      stroke="#64748b"
                      strokeWidth={1}
                    />
                    <text
                      x={moveIconX}
                      y={moveIconY + 4}
                      textAnchor="middle"
                      fontFamily="Arial, sans-serif"
                      fontSize="12"
                      fontWeight="700"
                      fill="#334155"
                    >
                      move
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </Box>
    </Box>
  );
}
