import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
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
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { scrollBothOverflowSx } from "../../common/scrollSx";

interface AssetManagerHistorianTabProps {
  assetAttributePaths: string[];
  historianTargets: Array<{ id: string; name: string; timestampUnit: "us" | "ns"; enabled?: boolean }>;
  queryAgg: string;
  queryBucketMs: string;
  queryError: string;
  queryFrom: string;
  queryLimit: string;
  queryLoading: boolean;
  queryMode: "raw" | "range" | "last";
  queryOrder: "asc" | "desc";
  queryPath: string;
  queryResult: {
    matches?: Array<Record<string, unknown>>;
    rows?: Array<Record<string, unknown>>;
    truncated?: boolean;
    agg?: string;
    historianTargetId?: string;
  } | null;
  queryTime: "epoch" | "iso";
  queryTo: string;
  onAddHistorian: () => void;
  onOpenMonitor: (target: { id: string; name: string; timestampUnit: "us" | "ns"; enabled?: boolean }) => void;
  onRemoveHistorian: (index: number) => void;
  onRunQuery: () => void;
  onSetHistorianEnabled: (index: number, enabled: boolean) => void;
  onSetHistorianId: (index: number, id: string) => void;
  onSetHistorianName: (index: number, name: string) => void;
  onSetHistorianTimestampUnit: (index: number, unit: "us" | "ns") => void;
  onSetQueryAgg: (value: string) => void;
  onSetQueryBucketMs: (value: string) => void;
  onSetQueryFrom: (value: string) => void;
  onSetQueryLimit: (value: string) => void;
  onSetQueryMode: (value: "raw" | "range" | "last") => void;
  onSetQueryOrder: (value: "asc" | "desc") => void;
  onSetQueryPath: (value: string) => void;
  onSetQueryTime: (value: "epoch" | "iso") => void;
  onSetQueryTo: (value: string) => void;
  serializeValue: (value: unknown) => string;
}

export default function AssetManagerHistorianTab(props: AssetManagerHistorianTabProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Paper sx={{ p: 1.25, ...scrollBothOverflowSx }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Historian Targets
          </Typography>
          <Button variant="contained" size="small" onClick={props.onAddHistorian}>
            Add Historian
          </Button>
        </Box>
        <TableContainer sx={{ border: "1px solid #dbe3ef", borderRadius: 1, maxHeight: 340, ...scrollBothOverflowSx }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>ID</TableCell>
                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Name</TableCell>
                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 90 }}>TS Unit</TableCell>
                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 90 }}>Enabled</TableCell>
                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {props.historianTargets.map((target, idx) => (
                <TableRow key={`hist-target:${target.id}`}>
                  <TableCell>
                    <TextField
                      size="small"
                      value={target.id}
                      disabled={target.id === "default"}
                      onChange={(e) => props.onSetHistorianId(idx, e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={target.name} onChange={(e) => props.onSetHistorianName(idx, e.target.value)} />
                  </TableCell>
                  <TableCell>
                    <FormControl size="small" sx={{ minWidth: 90 }}>
                      <Select
                        value={target.timestampUnit}
                        onChange={(e: SelectChangeEvent<"us" | "ns">) =>
                          props.onSetHistorianTimestampUnit(idx, e.target.value as "us" | "ns")
                        }
                      >
                        <MenuItem value="us">us</MenuItem>
                        <MenuItem value="ns">ns</MenuItem>
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={target.enabled !== false}
                      onChange={(_e, checked) => props.onSetHistorianEnabled(idx, checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                      <Button size="small" variant="outlined" onClick={() => props.onOpenMonitor(target)}>
                        Monitor
                      </Button>
                      <Button size="small" color="error" onClick={() => props.onRemoveHistorian(idx)}>
                        Remove
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Paper sx={{ p: 1.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          Query Tester
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 1, mb: 1 }}>
          <FormControl size="small">
            <InputLabel>Mode</InputLabel>
            <Select
              label="Mode"
              value={props.queryMode}
              onChange={(e: SelectChangeEvent<"raw" | "range" | "last">) =>
                props.onSetQueryMode(e.target.value as "raw" | "range" | "last")
              }
            >
              <MenuItem value="raw">raw</MenuItem>
              <MenuItem value="range">range</MenuItem>
              <MenuItem value="last">last</MenuItem>
            </Select>
          </FormControl>
          <Autocomplete
            freeSolo
            options={props.assetAttributePaths}
            value={props.queryPath}
            onInputChange={(_e, value) => props.onSetQueryPath(value)}
            renderInput={(params) => <TextField {...params} size="small" label="Path (single/multi comma-separated)" />}
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Order</InputLabel>
              <Select
                label="Order"
                value={props.queryOrder}
                onChange={(e: SelectChangeEvent<"asc" | "desc">) =>
                  props.onSetQueryOrder(e.target.value as "asc" | "desc")
                }
              >
                <MenuItem value="asc">asc</MenuItem>
                <MenuItem value="desc">desc</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Time</InputLabel>
              <Select
                label="Time"
                value={props.queryTime}
                onChange={(e: SelectChangeEvent<"epoch" | "iso">) =>
                  props.onSetQueryTime(e.target.value as "epoch" | "iso")
                }
              >
                <MenuItem value="iso">iso</MenuItem>
                <MenuItem value="epoch">epoch</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Limit"
              value={props.queryLimit}
              onChange={(e) => props.onSetQueryLimit(e.target.value)}
              disabled={props.queryMode !== "raw"}
            />
            <TextField
              size="small"
              label="Bucket ms"
              value={props.queryBucketMs}
              onChange={(e) => props.onSetQueryBucketMs(e.target.value)}
              disabled={props.queryMode !== "range"}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Agg</InputLabel>
              <Select
                label="Agg"
                value={props.queryAgg}
                onChange={(e: SelectChangeEvent<string>) => props.onSetQueryAgg(e.target.value)}
                disabled={props.queryMode !== "range"}
              >
                <MenuItem value="min">min</MenuItem>
                <MenuItem value="max">max</MenuItem>
                <MenuItem value="avg">avg</MenuItem>
                <MenuItem value="first">first</MenuItem>
                <MenuItem value="last">last</MenuItem>
                <MenuItem value="count">count</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 1, mb: 1 }}>
          <TextField size="small" label="From (epoch or ISO)" value={props.queryFrom} onChange={(e) => props.onSetQueryFrom(e.target.value)} disabled={props.queryMode === "last"} />
          <TextField size="small" label="To (epoch or ISO)" value={props.queryTo} onChange={(e) => props.onSetQueryTo(e.target.value)} disabled={props.queryMode === "last"} />
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              const end = new Date();
              const start = new Date(end.getTime() - 15 * 60 * 1000);
              props.onSetQueryFrom(start.toISOString());
              props.onSetQueryTo(end.toISOString());
            }}
          >
            Last 15m
          </Button>
          <Button size="small" variant="contained" disabled={props.queryLoading} onClick={() => void props.onRunQuery()}>
            {props.queryLoading ? "Running..." : "Run Query"}
          </Button>
        </Box>

        {props.queryError ? <Alert severity="error" sx={{ mb: 1 }}>{props.queryError}</Alert> : null}

        {props.queryResult ? (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
            <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                Attribute Metadata
              </Typography>
              <TableContainer sx={{ maxHeight: 300, ...scrollBothOverflowSx }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Path</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell>TagID</TableCell>
                      <TableCell>Target</TableCell>
                      <TableCell>Latest</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(props.queryResult.matches || []).map((m) => (
                      <TableRow key={`query-match:${String(m.assetId)}:${String(m.attributeName)}`}>
                        <TableCell sx={{ fontFamily: "monospace" }}>{String(m.path || "-")}</TableCell>
                        <TableCell>{String(m.type || "-")}</TableCell>
                        <TableCell>{String(m.unit || "-")}</TableCell>
                        <TableCell>{String(m.tagId || "-")}</TableCell>
                        <TableCell>{String(m.historianTargetId || "-")}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>
                          {m.latestValue == null ? "-" : props.serializeValue(m.latestValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                Query Result
              </Typography>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 0.75 }}>
                <Typography variant="caption">rows: {(props.queryResult.rows || []).length}</Typography>
                <Typography variant="caption">truncated: {String(props.queryResult.truncated === true)}</Typography>
                <Typography variant="caption">agg: {props.queryResult.agg || "-"}</Typography>
                <Typography variant="caption">target: {props.queryResult.historianTargetId || "-"}</Typography>
              </Box>
              <Box sx={{ maxHeight: 300, ...scrollBothOverflowSx, border: "1px solid #edf1f7", borderRadius: 1, p: 1, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(props.queryResult.rows || [], null, 2)}
              </Box>
            </Paper>
          </Box>
        ) : null}
      </Paper>
    </Box>
  );
}
