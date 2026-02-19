import dynamic from "next/dynamic";
import { Box, Button, Paper, TextField, Typography } from "@mui/material";
import type { ActionDefinition } from "../../types/program";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface ActionManagerProps {
  actions: ActionDefinition[];
  selectedActionId: string;
  onSelectAction: (id: string) => void;
  onAddAction: () => void;
  onRemoveAction: (id: string) => void;
  onRenameAction: (oldId: string, newId: string) => void;
  onUpdateAction: (id: string, patch: Partial<ActionDefinition>) => void;
}

export default function ActionManager({
  actions,
  selectedActionId,
  onSelectAction,
  onAddAction,
  onRemoveAction,
  onRenameAction,
  onUpdateAction
}: ActionManagerProps) {
  const selectedAction = actions.find((item) => item.id === selectedActionId);

  return (
    <Box sx={{ p: 2, display: "grid", gridTemplateColumns: "340px 1fr", gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 1.5, height: "calc(100vh - 260px)", overflow: "auto" }}>
        <Button fullWidth variant="outlined" onClick={onAddAction}>
          Add Action Script
        </Button>
        <Box sx={{ mt: 1.5, display: "grid", gap: 1 }}>
          {actions.map((action) => (
            <Paper
              key={action.id}
              variant="outlined"
              sx={{
                p: 1.25,
                borderColor: selectedActionId === action.id ? "#0f766e" : undefined,
                cursor: "pointer"
              }}
              onClick={() => onSelectAction(action.id)}
            >
              <Typography variant="subtitle2">{action.id}</Typography>
              <Typography variant="body2" color="text.secondary">
                {action.type}
              </Typography>
              <Button
                size="small"
                color="error"
                sx={{ mt: 0.5 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveAction(action.id);
                }}
              >
                Remove
              </Button>
            </Paper>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, minHeight: "calc(100vh - 260px)" }}>
        {!selectedAction && (
          <Typography variant="body2" color="text.secondary">
            Pilih action script di panel kiri.
          </Typography>
        )}
        {selectedAction && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Typography variant="h6">Action Detail</Typography>
            <TextField
              label="Action ID"
              value={selectedAction.id}
              onChange={(e) => onRenameAction(selectedAction.id, e.target.value)}
            />
            <MonacoEditor
              height="calc(100vh - 380px)"
              defaultLanguage="javascript"
              value={selectedAction.script}
              onChange={(value) =>
                onUpdateAction(selectedAction.id, { script: value ?? "" })
              }
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: "on"
              }}
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
