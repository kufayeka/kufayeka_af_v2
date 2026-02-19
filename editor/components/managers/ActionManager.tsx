import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Typography
} from "@mui/material";
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
  const [search, setSearch] = useState("");
  const [maxEditor, setMaxEditor] = useState(false);
  const selectedAction = actions.find((item) => item.id === selectedActionId);
  const filteredActions = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return actions;
    return actions.filter((action) => {
      const haystack =
        `${action.id} ${action.type} ${action.description ?? ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [actions, search]);

  return (
    <Box sx={{ p: 1.25, display: "grid", gridTemplateColumns: "320px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Button fullWidth variant="outlined" onClick={onAddAction}>
            Add Action Script
          </Button>
          <TextField
            size="small"
            label="Search Action"
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
            {filteredActions.map((action) => (
            <Box
              key={action.id}
              sx={{
                p: 0.75,
                height: "fit-content",
                display: "grid",
                gap: 0.25, 
                border: "1px solid #cbd5e1",
                borderRadius: "3px",
                borderColor: selectedActionId === action.id ? "#0f766e" : undefined,
                cursor: "pointer"
              }}
              onClick={() => onSelectAction(action.id)}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "row",
                  gap: 0.5, // 4px antar card
                }}
              >
                    <Typography variant="subtitle2">{action.id}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {action.type}
                    </Typography>
              </Box>
              {action.description && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    mb: 0.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                >
                  {action.description}
                </Typography>
              )}
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <FormControlLabel
                  sx={{ m: 0 }}
                  control={
                    <Switch
                      size="small"
                      checked={action.enabled !== false}
                      onChange={(_e, checked) =>
                        onUpdateAction(action.id, { enabled: checked })
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
                    onRemoveAction(action.id);
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
        {!selectedAction && (
          <Typography variant="body2" color="text.secondary">
            Pilih action script di panel kiri.
          </Typography>
        )}
        {selectedAction && (
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <Typography variant="h6">Action Detail</Typography>
            <TextField
              label="Action ID"
              value={selectedAction.id}
              onChange={(e) => onRenameAction(selectedAction.id, e.target.value)}
            />
            <TextField
              label="Description"
              value={selectedAction.description ?? ""}
              onChange={(e) =>
                onUpdateAction(selectedAction.id, { description: e.target.value })
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={selectedAction.enabled !== false}
                  onChange={(_event, checked) =>
                    onUpdateAction(selectedAction.id, { enabled: checked })
                  }
                />
              }
              label="Action Enabled"
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button size="small" variant="outlined" onClick={() => setMaxEditor(true)}>
                Maximize Editor
              </Button>
            </Box>
            <Box sx={{ height: 1, border: "1px solid #bbbcbd", borderRadius: 0.5, overflow: "hidden" }}>
            <MonacoEditor
              height="calc(100vh - 300px)"
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

            <Dialog fullScreen open={maxEditor} onClose={() => setMaxEditor(false)}>
              <DialogContent sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="subtitle1">
                    Script Editor: {selectedAction.id}
                  </Typography>
                  <Button variant="outlined" onClick={() => setMaxEditor(false)}>
                    Close
                  </Button>
                </Box>
                <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                  <MonacoEditor
                    height="calc(100vh - 96px)"
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
              </DialogContent>
            </Dialog>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
