import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";

interface GlobalStoreManagerProps {
  onStatus: (message: string) => void;
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function prettyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function GlobalStoreManager({ onStatus }: GlobalStoreManagerProps) {
  const [entries, setEntries] = useState<Record<string, unknown>>({});
  const [selectedKey, setSelectedKey] = useState("");
  const [newKey, setNewKey] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const runtimeGlobalApiBase = useMemo(() => "/api/runtime/global", []);

  const keys = useMemo(() => Object.keys(entries).sort((a, b) => a.localeCompare(b)), [entries]);

  const refresh = async (): Promise<void> => {
    setIsBusy(true);
    try {
      const res = await fetch(runtimeGlobalApiBase);
      const data = (await res.json()) as { data?: Record<string, unknown>; error?: string };
      if (!res.ok) {
        onStatus(`Global load error: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      const next = data.data || {};
      setEntries(next);
      if (selectedKey && !Object.prototype.hasOwnProperty.call(next, selectedKey)) {
        setSelectedKey("");
        setValueDraft("");
      }
      onStatus(`Global store loaded (${Object.keys(next).length} keys)`);
    } catch (error) {
      onStatus(`Global load error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [runtimeGlobalApiBase]);

  useEffect(() => {
    if (!selectedKey) return;
    setValueDraft(prettyValue(entries[selectedKey]));
  }, [selectedKey, entries]);

  const createOrUpdate = async (key: string, valueText: string): Promise<void> => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      onStatus("Global key is required");
      return;
    }
    setIsBusy(true);
    try {
      const value = parseMaybeJson(valueText);
      const res = await fetch(`${runtimeGlobalApiBase}/${encodeURIComponent(normalizedKey)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value })
      });
      const data = (await res.json()) as { value?: unknown; error?: string };
      if (!res.ok) {
        onStatus(`Global save error: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setEntries((prev) => ({ ...prev, [normalizedKey]: data.value }));
      setSelectedKey(normalizedKey);
      setNewKey("");
      setValueDraft(prettyValue(data.value));
      onStatus(`Global key saved: ${normalizedKey}`);
    } catch (error) {
      onStatus(`Global save error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const removeKey = async (): Promise<void> => {
    if (!selectedKey) {
      onStatus("Select a global key first");
      return;
    }
    setIsBusy(true);
    try {
      const keyToDelete = selectedKey;
      const res = await fetch(`${runtimeGlobalApiBase}/${encodeURIComponent(keyToDelete)}`, {
        method: "DELETE"
      });
      const data = (await res.json()) as { deleted?: boolean; error?: string };
      if (!res.ok) {
        onStatus(`Global delete error: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      if (data.deleted) {
        setEntries((prev) => {
          const next = { ...prev };
          delete next[keyToDelete];
          return next;
        });
        setSelectedKey("");
        setValueDraft("");
      }
      onStatus(data.deleted ? `Global key deleted: ${keyToDelete}` : `Global key not found: ${keyToDelete}`);
    } catch (error) {
      onStatus(`Global delete error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: 1 }}>
        <Typography variant="subtitle2">Global Keys</Typography>
        <Box sx={{ display: "flex", gap: 0.75 }}>
          <Button size="small" variant="outlined" onClick={() => void refresh()} disabled={isBusy}>
            Refresh
          </Button>
        </Box>
        <List dense sx={{ maxHeight: "calc(100vh - 300px)", ...scrollBothOverflowSx, border: "1px solid #e2e8f0" }}>
          {keys.length === 0 && (
            <Typography variant="caption" sx={{ p: 1, color: "#64748b" }}>
              No user global keys.
            </Typography>
          )}
          {keys.map((key) => (
            <ListItemButton key={key} selected={selectedKey === key} onClick={() => setSelectedKey(key)}>
              <ListItemText primary={key} />
            </ListItemButton>
          ))}
        </List>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, display: "grid", gap: 1 }}>
        <Typography variant="h6">Global Store</Typography>
        <Typography variant="caption" sx={{ color: "#64748b" }}>
          Live runtime state. Perubahan di sini langsung mengubah global store runtime aktif.
        </Typography>
        <TextField
          size="small"
          label="New Key"
          placeholder="paper.counter.prevRaw"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <Box sx={{ display: "flex", gap: 0.75 }}>
          <Button
            variant="outlined"
            disabled={isBusy || !newKey.trim()}
            onClick={() => void createOrUpdate(newKey, valueDraft || "0")}
          >
            Create Key
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={isBusy || !selectedKey}
            onClick={() => void removeKey()}
          >
            Delete Selected
          </Button>
        </Box>

        <TextField
          size="small"
          label="Selected Key"
          value={selectedKey}
          disabled
        />
        <TextField
          label="Value (JSON or plain text)"
          multiline
          minRows={14}
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          placeholder='{"count":123}'
          inputProps={{ wrap: "off" }}
          sx={{
            "& .MuiInputBase-root": {
              maxHeight: "50vh",
              ...scrollBothOverflowSx
            },
            "& textarea": {
              overflow: "auto !important",
              whiteSpace: "pre",
              overflowWrap: "normal",
              wordBreak: "normal",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
            }
          }}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 0.75 }}>
          <Button variant="contained" disabled={isBusy || !selectedKey} onClick={() => void createOrUpdate(selectedKey, valueDraft)}>
            Save Selected
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
