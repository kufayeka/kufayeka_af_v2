import { useMemo, useState } from "react";
import {
  Box,
  Button,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import type { TriggerDefinition } from "../../types/program";

interface TriggerManagerProps {
  triggers: TriggerDefinition[];
  selectedTriggerId: string;
  onSelectTrigger: (id: string) => void;
  onAddTrigger: () => void;
  onRemoveTrigger: (id: string) => void;
  onRenameTrigger: (oldId: string, newId: string) => void;
  onUpdateTrigger: (id: string, patch: Partial<TriggerDefinition>) => void;
  onUpdateTriggerPayload: (id: string, rawPayload: string) => void;
}

export default function TriggerManager({
  triggers,
  selectedTriggerId,
  onSelectTrigger,
  onAddTrigger,
  onRemoveTrigger,
  onRenameTrigger,
  onUpdateTrigger,
  onUpdateTriggerPayload
}: TriggerManagerProps) {
  const [search, setSearch] = useState("");
  const selectedTrigger = triggers.find((item) => item.id === selectedTriggerId);
  const filteredTriggers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return triggers;
    return triggers.filter((trigger) => {
      const haystack = `${trigger.id} ${trigger.type}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [search, triggers]);

  return (
    <Box sx={{ p: 1.25, display: "grid", gridTemplateColumns: "320px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Button fullWidth variant="outlined" onClick={onAddTrigger}>
            Add Trigger
          </Button>
          <TextField
            size="small"
            label="Search Trigger"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.5, // 4px antar card
            overflow: "auto",
            maxHeight: "calc(100vh - 220px)"
          }}
        >
          {filteredTriggers.map((trigger) => (
            <Box
              key={trigger.id}
              sx={{
                height: "fit-content",
                p: 0.75,
                display: "grid",
                border: "1px solid #cbd5e1",
                borderRadius: "3px",
                borderColor: selectedTriggerId === trigger.id ? "#0f766e" : undefined,
                cursor: "pointer"
              }}
              onClick={() => onSelectTrigger(trigger.id)}
            >
              <Typography variant="subtitle2">{trigger.id}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {trigger.type} / {trigger.intervalMs} ms
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Switch
                      size="small"
                      checked={trigger.enabled !== false}
                      onChange={(_e, checked) =>
                        onUpdateTrigger(trigger.id, { enabled: checked })
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                  label={<Typography variant="caption">Enabled</Typography>}
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  size="small"
                  color="error"
                  sx={{ minWidth: 0, px: 0.5 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTrigger(trigger.id);
                  }}
                >
                  Remove
                </Button>
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
        {!selectedTrigger && (
          <Typography variant="body2" color="text.secondary">
            Pilih trigger di panel kiri.
          </Typography>
        )}

        {selectedTrigger && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Typography variant="h6">Trigger Detail</Typography>
            <TextField
              label="Trigger ID"
              value={selectedTrigger.id}
              onChange={(e) => onRenameTrigger(selectedTrigger.id, e.target.value)}
            />
            <TextField
              label="Interval (ms)"
              type="number"
              value={selectedTrigger.intervalMs}
              onChange={(e) =>
                onUpdateTrigger(selectedTrigger.id, {
                  intervalMs: Number(e.target.value) || 1
                })
              }
            />
            <TextField
              label="Initial Payload"
              value={JSON.stringify(selectedTrigger.message?.payload ?? 0)}
              onChange={(e) => onUpdateTriggerPayload(selectedTrigger.id, e.target.value)}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={selectedTrigger.enabled !== false}
                  onChange={(_event, checked) =>
                    onUpdateTrigger(selectedTrigger.id, { enabled: checked })
                  }
                />
              }
              label="Trigger Enabled"
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
