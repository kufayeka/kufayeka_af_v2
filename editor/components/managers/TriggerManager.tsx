import { Box, Button, Paper, TextField, Typography } from "@mui/material";
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
  const selectedTrigger = triggers.find((item) => item.id === selectedTriggerId);

  return (
    <Box sx={{ p: 2, display: "grid", gridTemplateColumns: "340px 1fr", gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 1.5, height: "calc(100vh - 260px)", overflow: "auto" }}>
        <Button fullWidth variant="outlined" onClick={onAddTrigger}>
          Add Trigger
        </Button>
        <Box sx={{ mt: 1.5, display: "grid", gap: 1 }}>
          {triggers.map((trigger) => (
            <Paper
              key={trigger.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderColor: selectedTriggerId === trigger.id ? "#0f766e" : undefined,
                cursor: "pointer"
              }}
              onClick={() => onSelectTrigger(trigger.id)}
            >
              <Typography variant="subtitle2">{trigger.id}</Typography>
              <Typography variant="body2" color="text.secondary">
                {trigger.type} / {trigger.intervalMs} ms
              </Typography>
              <Button
                size="small"
                color="error"
                sx={{ mt: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTrigger(trigger.id);
                }}
              >
                Remove
              </Button>
            </Paper>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, minHeight: "calc(100vh - 260px)" }}>
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
          </Box>
        )}
      </Paper>
    </Box>
  );
}
