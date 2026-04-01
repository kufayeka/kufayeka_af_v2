import { useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Typography
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type { TriggerTemplateDefinition, TriggerTemplateType } from "../../types/program";

interface TriggerManagerProps {
  triggerTemplates: TriggerTemplateDefinition[];
  watchPathOptions?: string[];
  eventWatchPathOptions?: string[];
  selectedTriggerTemplateId: string;
  onSelectTriggerTemplate: (id: string) => void;
  onAddTriggerTemplate: (type: TriggerTemplateType) => void;
  onRemoveTriggerTemplate: (id: string) => void;
  onUpdateTriggerTemplate: (id: string, patch: Partial<TriggerTemplateDefinition>) => void;
  onUpdateTriggerTemplatePayload: (id: string, rawPayload: string) => void;
}

function getTriggerTemplateTypeLabel(type: TriggerTemplateType): string {
  if (type === "interval") return "Interval";
  if (type === "watcher_set") return "Attribute Set";
  if (type === "watcher_valuechange") return "Attribute Value Change";
  if (type === "watcher_event_open") return "Event Open";
  return "Event Close";
}

export default function TriggerManager({
  triggerTemplates,
  watchPathOptions = [],
  eventWatchPathOptions = ["*"],
  selectedTriggerTemplateId,
  onSelectTriggerTemplate,
  onAddTriggerTemplate,
  onRemoveTriggerTemplate,
  onUpdateTriggerTemplate,
  onUpdateTriggerTemplatePayload
}: TriggerManagerProps) {
  const [search, setSearch] = useState("");

  const filteredTemplates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return triggerTemplates;
    return triggerTemplates.filter((template) =>
      `${template.id} ${template.name} ${template.description || ""} ${template.type} ${template.watchPath || ""}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [search, triggerTemplates]);

  const selectedTemplate =
    triggerTemplates.find((item) => item.id === selectedTriggerTemplateId) ||
    filteredTemplates[0] ||
    null;

  return (
    <Box sx={{ p: 1.25, display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
      <Paper
        variant="outlined"
        sx={{
          p: 1,
          display: "grid",
          gridTemplateRows: "auto auto 1fr",
          gap: 1,
          minHeight: "calc(100vh - 220px)",
          height: "calc(100vh - 220px)",
          overflow: "hidden"
        }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
          <Button fullWidth variant="outlined" onClick={() => onAddTriggerTemplate("interval")}>
            Add Interval
          </Button>
          <Button fullWidth variant="outlined" onClick={() => onAddTriggerTemplate("watcher_set")}>
            Add Set Trigger
          </Button>
          <Button fullWidth variant="outlined" onClick={() => onAddTriggerTemplate("watcher_valuechange")}>
            Add Value Trigger
          </Button>
          <Button fullWidth variant="outlined" onClick={() => onAddTriggerTemplate("watcher_event_open")}>
            Add Event Open
          </Button>
          <Button fullWidth variant="outlined" onClick={() => onAddTriggerTemplate("watcher_event_close")}>
            Add Event Close
          </Button>
        </Box>
        <TextField
          size="small"
          label="Search Trigger Template"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Box sx={{ ...scrollBothOverflowSx, maxHeight: "calc(100vh - 220px)", display: "grid", gap: 0.75 }}>
        <Box
          sx={{
            ...scrollBothOverflowSx,
            minHeight: 0,
            height: "100%",
            display: "grid",
            alignContent: "start",
            gap: 0.75,
            pr: 0.25
          }}
        >
          {filteredTemplates.map((template) => {
            const selected = template.id === selectedTemplate?.id;
            return (
              <Box
                key={template.id}
                onClick={() => onSelectTriggerTemplate(template.id)}
                sx={{
                  border: "1px solid",
                  borderColor: selected ? "#3b82f6" : "#dbe4ee",
                  borderRadius: 1.5,
                  px: 1.1,
                  py: 0.85,
                  cursor: "pointer",
                  background: selected ? "#eff6ff" : "#fff",
                  minHeight: 76,
                  display: "grid",
                  alignContent: "start",
                  boxShadow: selected ? "0 0 0 1px rgba(59,130,246,0.14)" : "none"
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {template.name || template.id}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {getTriggerTemplateTypeLabel(template.type)}
                </Typography>
                {!!template.watchPath && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {template.watchPath}
                  </Typography>
                )}
              </Box>
            );
          })}
          {filteredTemplates.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 1 }}>
              No trigger templates found.
            </Typography>
          )}
        </Box>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
        {!selectedTemplate && (
          <Typography variant="body2" color="text.secondary">
            Select a trigger template from the left panel.
          </Typography>
        )}

        {selectedTemplate && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="h6">Trigger Template Detail</Typography>
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => onRemoveTriggerTemplate(selectedTemplate.id)}
              >
                Remove Template
              </Button>
            </Box>
            <TextField
              label="Template ID"
              value={selectedTemplate.id}
              disabled
              helperText="Internal ID is generated automatically and cannot be edited."
            />
            <TextField
              label="Template Name"
              value={selectedTemplate.name}
              onChange={(e) => onUpdateTriggerTemplate(selectedTemplate.id, { name: e.target.value })}
            />
            <TextField
              label="Description"
              value={selectedTemplate.description ?? ""}
              onChange={(e) => onUpdateTriggerTemplate(selectedTemplate.id, { description: e.target.value })}
            />
            <TextField label="Trigger Type" value={selectedTemplate.type} disabled />

            {selectedTemplate.type === "interval" && (
              <TextField
                label="Interval (ms)"
                type="number"
                value={selectedTemplate.intervalMs}
                onChange={(e) =>
                  onUpdateTriggerTemplate(selectedTemplate.id, {
                    intervalMs: Math.max(1, Number(e.target.value) || 1)
                  })
                }
              />
            )}

            {(selectedTemplate.type === "interval") && (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <TextField
                  label="Active From (HH:mm)"
                  value={selectedTemplate.activeFrom ?? ""}
                  onChange={(e) => onUpdateTriggerTemplate(selectedTemplate.id, { activeFrom: e.target.value })}
                  helperText="Optional time window"
                />
                <TextField
                  label="Active To (HH:mm)"
                  value={selectedTemplate.activeTo ?? ""}
                  onChange={(e) => onUpdateTriggerTemplate(selectedTemplate.id, { activeTo: e.target.value })}
                  helperText="Optional time window"
                />
              </Box>
            )}

            {(selectedTemplate.type === "watcher_set" ||
              selectedTemplate.type === "watcher_valuechange" ||
              selectedTemplate.type === "watcher_event_open" ||
              selectedTemplate.type === "watcher_event_close") && (
              <Autocomplete
                freeSolo
                options={
                  selectedTemplate.type === "watcher_event_open" || selectedTemplate.type === "watcher_event_close"
                    ? eventWatchPathOptions
                    : watchPathOptions
                }
                value={selectedTemplate.watchPath ?? ((selectedTemplate.type === "watcher_event_open" || selectedTemplate.type === "watcher_event_close") ? "*" : "*.*.*")}
                onInputChange={(_e, value) => onUpdateTriggerTemplate(selectedTemplate.id, { watchPath: value })}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Watch Path (wildcard supported)"
                    helperText={
                      selectedTemplate.type === "watcher_event_open" || selectedTemplate.type === "watcher_event_close"
                        ? 'Event path example: "Taiyo1.Events.*" or "*"'
                        : 'Attribute path example: "Jasuindo.*.Operator" or "*.*.*"'
                    }
                  />
                )}
              />
            )}

            <TextField
              label="Initial Payload"
              value={JSON.stringify(selectedTemplate.message?.payload ?? 0)}
              onChange={(e) => onUpdateTriggerTemplatePayload(selectedTemplate.id, e.target.value)}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={selectedTemplate.enabled !== false}
                  onChange={(_event, checked) =>
                    onUpdateTriggerTemplate(selectedTemplate.id, { enabled: checked })
                  }
                />
              }
              label="Template Enabled"
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
