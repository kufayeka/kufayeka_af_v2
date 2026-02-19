import { useEffect, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import type { FlowLink, NodePosition } from "../../types/program";
import FlowDiagram from "./FlowDiagram";

interface FlowManagerProps {
  triggerIds: string[];
  actionIds: string[];
  links: FlowLink[];
  nodePositions: Record<string, NodePosition>;
  onAddLink: (link: FlowLink) => void;
  onUpdateLink: (index: number, patch: Partial<FlowLink>) => void;
  onRemoveLink: (index: number) => void;
  onActionNodeDoubleClick?: (actionId: string) => void;
  onNodePositionDragStart?: () => void;
  onNodePositionChange?: (nodeId: string, position: NodePosition) => void;
}

export default function FlowManager({
  triggerIds,
  actionIds,
  links,
  nodePositions,
  onAddLink,
  onUpdateLink,
  onRemoveLink,
  onActionNodeDoubleClick,
  onNodePositionDragStart,
  onNodePositionChange
}: FlowManagerProps) {
  const [selectedLinkIndex, setSelectedLinkIndex] = useState(-1);
  const [draft, setDraft] = useState<FlowLink>({ from: "", to: "" });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const nodeOptions = [...triggerIds, ...actionIds];
  const pagedLinks = links.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(links.length / rowsPerPage) - 1);
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [links.length, rowsPerPage, page]);

  return (
    <Box sx={{ p: 2, display: "grid", gridTemplateRows: "minmax(420px, 45vh) minmax(340px, 1fr)", gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Flow Diagram
        </Typography>
        <FlowDiagram
          triggerIds={triggerIds}
          actionIds={actionIds}
          links={links}
          nodePositions={nodePositions}
          selectedLinkIndex={selectedLinkIndex}
          onSelectLink={setSelectedLinkIndex}
          onNodeDoubleClick={(nodeId, kind) => {
            if (kind === "action") onActionNodeDoubleClick?.(nodeId);
          }}
          onNodeDragStart={onNodePositionDragStart}
          onNodePositionChange={onNodePositionChange}
        />
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Connection Manager
        </Typography>
        <Box sx={{ mb: 1.5, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 1 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>From</InputLabel>
            <Select
              label="From"
              value={draft.from}
              onChange={(e: SelectChangeEvent<string>) =>
                setDraft((prev) => ({ ...prev, from: e.target.value }))
              }
            >
              {nodeOptions.map((id) => (
                <MenuItem key={id} value={id}>
                  {id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>To</InputLabel>
            <Select
              label="To"
              value={draft.to}
              onChange={(e: SelectChangeEvent<string>) =>
                setDraft((prev) => ({ ...prev, to: e.target.value }))
              }
            >
              {nodeOptions.map((id) => (
                <MenuItem key={id} value={id}>
                  {id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={() => {
              if (!draft.from || !draft.to) return;
              onAddLink(draft);
              setDraft({ from: "", to: "" });
            }}
          >
            Add
          </Button>
        </Box>

        <TableContainer sx={{ maxHeight: 360, border: "1px solid #e2e8f0", borderRadius: 1 }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 70 }}>No</TableCell>
                <TableCell>From</TableCell>
                <TableCell>To</TableCell>
                <TableCell sx={{ width: 120 }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedLinks.map((link, rowIndex) => {
                const actualIndex = page * rowsPerPage + rowIndex;
                const isSelected = actualIndex === selectedLinkIndex;
                return (
                  <TableRow
                    key={`${link.from}-${link.to}-${actualIndex}`}
                    selected={isSelected}
                    hover
                    onClick={() => setSelectedLinkIndex(actualIndex)}
                  >
                    <TableCell>{actualIndex + 1}</TableCell>
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={link.from}
                          onChange={(e: SelectChangeEvent<string>) =>
                            onUpdateLink(actualIndex, { from: e.target.value })
                          }
                        >
                          {nodeOptions.map((id) => (
                            <MenuItem key={id} value={id}>
                              {id}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={link.to}
                          onChange={(e: SelectChangeEvent<string>) =>
                            onUpdateLink(actualIndex, { to: e.target.value })
                          }
                        >
                          {nodeOptions.map((id) => (
                            <MenuItem key={id} value={id}>
                              {id}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveLink(actualIndex);
                          setSelectedLinkIndex(-1);
                        }}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          rowsPerPageOptions={[5, 10, 20, 50]}
          count={links.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_event, nextPage) => setPage(nextPage)}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number(event.target.value));
            setPage(0);
          }}
        />
      </Paper>
    </Box>
  );
}
