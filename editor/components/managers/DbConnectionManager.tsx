import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";

interface DbConfigResponse {
  config?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  error?: string;
}

interface SqlTestResponse {
  ok?: boolean;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
  error?: string;
}

async function parseJsonOrError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.error || `Runtime API error ${response.status}`));
  }
  return body;
}

export default function DbConnectionManager() {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [config, setConfig] = useState<DbConfigResponse | null>(null);
  const [sql, setSql] = useState("SELECT * FROM af_historian ORDER BY ts DESC LIMIT 20;");
  const [sqlResult, setSqlResult] = useState<SqlTestResponse | null>(null);

  const runtimeApiBase = useMemo(() => {
    return "/api/runtime";
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${runtimeApiBase}/db/config`);
      const json = (await parseJsonOrError(res)) as DbConfigResponse;
      setConfig(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${runtimeApiBase}/db/test-connection`, {
        method: "POST"
      });
      const json = (await parseJsonOrError(res)) as { ok?: boolean; message?: string; latencyMs?: number };
      setNotice(`${json.ok ? "OK" : "FAILED"}: ${json.message || "-"} (${json.latencyMs || 0} ms)`);
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const runSql = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${runtimeApiBase}/db/sql-test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql })
      });
      const json = (await parseJsonOrError(res)) as SqlTestResponse;
      setSqlResult(json);
      setNotice(`SQL executed. rowCount=${json.rowCount || 0}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSqlResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: "grid", gap: 1.25 }}>
      <Paper sx={{ p: 1 }}>
        <Tabs value={tab} onChange={(_e, value: number) => setTab(value)}>
          <Tab label="DB Connection" />
          <Tab label="SQL Tester" />
        </Tabs>
      </Paper>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success">{notice}</Alert> : null}

      {tab === 0 && (
        <Paper sx={{ p: 1.25, display: "grid", gap: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Database Connection
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button variant="outlined" disabled={loading} onClick={() => void loadConfig()}>
              Refresh Config
            </Button>
            <Button variant="contained" disabled={loading} onClick={() => void testConnection()}>
              Test Connection
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Historian table: `af_historian`, Event table: `af_event`. Tables are auto-created by runtime.
          </Typography>
          <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              Config + Metrics
            </Typography>
            <Box sx={{ maxHeight: 420, ...scrollBothOverflowSx, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(config || {}, null, 2)}
            </Box>
          </Paper>
        </Paper>
      )}

      {tab === 1 && (
        <Paper sx={{ p: 1.25, display: "grid", gap: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            SQL Tester
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Gunakan query SQL untuk eksplorasi `af_historian` dan `af_event`.
          </Typography>
          <TextField
            label="SQL"
            multiline
            minRows={6}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT * FROM af_event ORDER BY start_ts DESC LIMIT 20;"
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button variant="contained" disabled={loading} onClick={() => void runSql()}>
              Run SQL
            </Button>
          </Box>
          <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              Result
            </Typography>
            <Box sx={{ maxHeight: 420, ...scrollBothOverflowSx, fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(sqlResult || {}, null, 2)}
            </Box>
          </Paper>
        </Paper>
      )}
    </Box>
  );
}
