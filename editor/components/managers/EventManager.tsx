import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
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
  TableSortLabel,
  TextField,
  Typography
} from "@mui/material";

type EventStatusFilter = "*" | "open" | "closed";
type EventSeverity = "other" | "info" | "low" | "medium" | "high" | "critical";
type SortDirection = "asc" | "desc";
type SortColumn =
  | "id"
  | "event_path"
  | "start_ts"
  | "end_ts"
  | "status"
  | "severity"
  | "is_acknowledge"
  | "acknowledged_ts";

interface EventRow {
  id: string;
  event_path: string;
  start_ts: string;
  end_ts: string | null;
  status: "open" | "closed";
  severity: EventSeverity;
  context: Record<string, unknown>;
  is_acknowledge: boolean;
  acknowledged_ts: string | null;
  notes_on_open: string | null;
  notes_on_close: string | null;
  captured_data_on_open: Record<string, unknown> | null;
  captured_data_on_close: Record<string, unknown> | null;
}

interface EventApiResponse {
  rows?: EventRow[];
  total?: number;
}

interface EventMetaResponse {
  provider?: string;
  eventStore?: {
    engine?: string;
    database?: string;
    schema?: string;
    table?: string;
  };
}

const severityBg: Record<EventSeverity, string> = {
  other: "#ffffff",
  info: "#e8f1ff",
  low: "#e8f7ef",
  medium: "#fff8dc",
  high: "#ffe9d6",
  critical: "#ffe3e3"
};

function serializeContextPreview(context: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(context);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch {
    return "{}";
  }
}

function rowBgColor(row: EventRow): string {
  if (row.status === "closed") return "#eceff3";
  return severityBg[row.severity || "other"] || "#ffffff";
}

async function parseJsonOrError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `Runtime API error ${response.status}`);
  }
  return body;
}

export default function EventManager() {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [pattern, setPattern] = useState("*");
  const [status, setStatus] = useState<EventStatusFilter>("*");
  const [severity, setSeverity] = useState<"*" | EventSeverity>("*");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [sortBy, setSortBy] = useState<SortColumn>("start_ts");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [meta, setMeta] = useState<EventMetaResponse | null>(null);

  const runtimeEventApi = useMemo(() => {
    const explicit = process.env.NEXT_PUBLIC_KUFAYEKA_RUNTIME_EVENT_API?.trim();
    if (explicit) return explicit;
    const base = process.env.NEXT_PUBLIC_RUNTIME_API_BASE?.trim();
    if (base) return `${base.replace(/\/$/, "")}/api/events`;
    if (typeof window !== "undefined") {
      return `${window.location.protocol}//${window.location.hostname}:4000/api/events`;
    }
    return "http://127.0.0.1:4000/api/events";
  }, []);

  const queryUrl = useMemo(() => {
    const url = new URL(runtimeEventApi);
    url.searchParams.set("pattern", pattern || "*");
    url.searchParams.set("status", status);
    url.searchParams.set("severity", severity);
    url.searchParams.set("limit", String(rowsPerPage));
    url.searchParams.set("offset", String(page * rowsPerPage));
    url.searchParams.set("sortBy", sortBy);
    url.searchParams.set("sortDir", sortDir);
    if (from) url.searchParams.set("from", from);
    if (to) url.searchParams.set("to", to);
    return url.toString();
  }, [from, page, pattern, rowsPerPage, runtimeEventApi, severity, sortBy, sortDir, status, to]);

  const loadRows = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(queryUrl);
      const data = (await parseJsonOrError(response)) as EventApiResponse;
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total || 0));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const runRowAction = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
      await loadRows();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
    }
  };

  const closeById = async (id: string) =>
    runRowAction(async () => {
      const response = await fetch(`${runtimeEventApi}/close-id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ts: new Date().toISOString(), notes_on_close: "Manual close" })
      });
      await parseJsonOrError(response);
    });

  const acknowledgeById = async (id: string) =>
    runRowAction(async () => {
      const response = await fetch(`${runtimeEventApi}/ack-id`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ts: new Date().toISOString() })
      });
      await parseJsonOrError(response);
    });

  const deleteById = async (id: string) =>
    runRowAction(async () => {
      const response = await fetch(`${runtimeEventApi}/by-id?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      await parseJsonOrError(response);
    });

  const deleteAll = async () => {
    const confirmed = window.confirm("Delete all events matching the current filter?");
    if (!confirmed) return;
    await runRowAction(async () => {
      const url = new URL(runtimeEventApi);
      url.searchParams.set("pattern", pattern || "*");
      url.searchParams.set("status", status);
      url.searchParams.set("severity", severity);
      if (from) url.searchParams.set("from", from);
      if (to) url.searchParams.set("to", to);
      const response = await fetch(url.toString(), { method: "DELETE" });
      await parseJsonOrError(response);
      setPage(0);
    });
  };

  useEffect(() => {
    loadRows();
  }, [queryUrl]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadRows();
    }, 2000);
    return () => clearInterval(timer);
  }, [queryUrl]);

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const url = new URL(runtimeEventApi);
        url.pathname = "/api/events/meta";
        const response = await fetch(url.toString());
        const data = (await parseJsonOrError(response)) as EventMetaResponse;
        setMeta(data);
      } catch {
        setMeta(null);
      }
    };
    void loadMeta();
  }, [runtimeEventApi]);

  const toggleSort = (column: SortColumn) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir("asc");
  };

  return (
    <Box sx={{ p: 1.25, display: "grid", gap: 1.25, width: "100%", minWidth: 0 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Event View
        </Typography>
        <Typography variant="caption" sx={{ color: "#475569" }}>
          source: {runtimeEventApi} | engine: {meta?.eventStore?.engine || "-"} | table: {meta?.eventStore?.schema || "-"}.
          {meta?.eventStore?.table || "-"}
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1.4fr 120px 120px 1fr 1fr auto auto", gap: 1 }}>
          <TextField
            size="small"
            label="Pattern Wildcard"
            value={pattern}
            onChange={(event) => {
              setPattern(event.target.value);
              setPage(0);
            }}
            placeholder="Jasuindo.OffsetPrinter.Taiyo1/Event/*"
          />
          <Select
            size="small"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as EventStatusFilter);
              setPage(0);
            }}
          >
            <MenuItem value="*">all</MenuItem>
            <MenuItem value="open">open</MenuItem>
            <MenuItem value="closed">closed</MenuItem>
          </Select>
          <Select
            size="small"
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value as "*" | EventSeverity);
              setPage(0);
            }}
          >
            <MenuItem value="*">all severity</MenuItem>
            <MenuItem value="other">other</MenuItem>
            <MenuItem value="info">info</MenuItem>
            <MenuItem value="low">low</MenuItem>
            <MenuItem value="medium">medium</MenuItem>
            <MenuItem value="high">high</MenuItem>
            <MenuItem value="critical">critical</MenuItem>
          </Select>
          <TextField
            size="small"
            label="From (ISO)"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(0);
            }}
            placeholder="2026-02-22T00:00:00Z"
          />
          <TextField
            size="small"
            label="To (ISO)"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(0);
            }}
            placeholder="2026-02-22T23:59:59Z"
          />
          <Button variant="outlined" onClick={loadRows} disabled={loading}>
            Refresh
          </Button>
          <Button color="error" variant="outlined" onClick={deleteAll} disabled={loading}>
            Delete All
          </Button>
        </Box>
        {error ? (
          <Typography color="error" variant="body2">
            {error}
          </Typography>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 0.5, width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
        <TableContainer
          sx={{
            width: "100%",
            maxWidth: "100%",
            maxHeight: "calc(100vh - 300px)",
            overflowX: "auto",
            overflowY: "auto"
          }}
        >
          <Table size="small" stickyHeader sx={{ width: "max-content", minWidth: "100%" }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 240, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "id"}
                    direction={sortBy === "id" ? sortDir : "asc"}
                    onClick={() => toggleSort("id")}
                  >
                    id
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 320, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "event_path"}
                    direction={sortBy === "event_path" ? sortDir : "asc"}
                    onClick={() => toggleSort("event_path")}
                  >
                    event_path
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 170, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "start_ts"}
                    direction={sortBy === "start_ts" ? sortDir : "asc"}
                    onClick={() => toggleSort("start_ts")}
                  >
                    start_ts
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 170, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "end_ts"}
                    direction={sortBy === "end_ts" ? sortDir : "asc"}
                    onClick={() => toggleSort("end_ts")}
                  >
                    end_ts
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 100, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "status"}
                    direction={sortBy === "status" ? sortDir : "asc"}
                    onClick={() => toggleSort("status")}
                  >
                    status
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 110, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "severity"}
                    direction={sortBy === "severity" ? sortDir : "asc"}
                    onClick={() => toggleSort("severity")}
                  >
                    severity
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 260, backgroundColor: "#d0dfdb" }}>context</TableCell>
                <TableCell sx={{ minWidth: 130, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "is_acknowledge"}
                    direction={sortBy === "is_acknowledge" ? sortDir : "asc"}
                    onClick={() => toggleSort("is_acknowledge")}
                  >
                    is_acknowledge
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 170, backgroundColor: "#d0dfdb" }}>
                  <TableSortLabel
                    active={sortBy === "acknowledged_ts"}
                    direction={sortBy === "acknowledged_ts" ? sortDir : "asc"}
                    onClick={() => toggleSort("acknowledged_ts")}
                  >
                    acknowledged_ts
                  </TableSortLabel>
                </TableCell>
                <TableCell sx={{ minWidth: 220, backgroundColor: "#d0dfdb" }}>notes_on_open</TableCell>
                <TableCell sx={{ minWidth: 220, backgroundColor: "#d0dfdb" }}>notes_on_close</TableCell>
                <TableCell sx={{ minWidth: 260, backgroundColor: "#d0dfdb" }}>captured_data_on_open</TableCell>
                <TableCell sx={{ minWidth: 260, backgroundColor: "#d0dfdb" }}>captured_data_on_close</TableCell>
                <TableCell sx={{ minWidth: 260, backgroundColor: "#d0dfdb" }}>actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} hover sx={{ backgroundColor: rowBgColor(row) }}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.id}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.event_path}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.start_ts}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.end_ts || ""}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.status}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", textTransform: "capitalize" }}>
                    {row.severity || "other"}
                  </TableCell>
                  <TableCell>{serializeContextPreview(row.context || {})}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.is_acknowledge ? "true" : "false"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{row.acknowledged_ts || ""}</TableCell>
                  <TableCell>{row.notes_on_open || ""}</TableCell>
                  <TableCell>{row.notes_on_close || ""}</TableCell>
                  <TableCell>{row.captured_data_on_open ? serializeContextPreview(row.captured_data_on_open) : ""}</TableCell>
                  <TableCell>{row.captured_data_on_close ? serializeContextPreview(row.captured_data_on_close) : ""}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={loading || row.status !== "open"}
                        onClick={() => closeById(row.id)}
                      >
                        Close
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={loading || row.is_acknowledge}
                        onClick={() => acknowledgeById(row.id)}
                      >
                        Acknowledge
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        disabled={loading}
                        onClick={() => deleteById(row.id)}
                      >
                        Delete
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12}>
                    <Typography variant="body2" color="text.secondary">
                      {loading ? "Loading events..." : "No events"}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_event, nextPage) => setPage(nextPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            const nextSize = Number(event.target.value);
            setRowsPerPage(nextSize);
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
        />
      </Paper>
    </Box>
  );
}

