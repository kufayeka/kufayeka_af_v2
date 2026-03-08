
import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type {
  AssetFrameworkDefinition,
  EventTemplateAssetPathDefinition,
  EventTemplateDefinition,
  EventTemplateFieldDefinition,
  EventTemplateFieldSource,
  EventTemplateInputBindingDefinition,
  EventTemplatePathSegmentDefinition,
  EventTemplateTimeSourceDefinition
} from "../../types/program";
import { normalizeEventTemplateInputBinding, renderEventTemplatePathBuilder } from "../../lib/programUtils";

interface EventTemplateManagerProps {
  assets: AssetFrameworkDefinition;
  eventTemplates: EventTemplateDefinition[];
  selectedTemplateId: string;
  onSelectTemplate: (id: string) => void;
  onAddTemplate: () => void;
  onAddPresetTemplate: (preset: "job_lifecycle" | "job_activity" | "machine_alarm") => void;
  onRemoveTemplate: (id: string) => void;
  onUpdateTemplate: (id: string, patch: Partial<EventTemplateDefinition>) => void;
}

interface AssetTemplateOption {
  id: string;
  name: string;
  attributes: string[];
}

function getAssetTemplateOptions(assets: AssetFrameworkDefinition): AssetTemplateOption[] {
  return (assets.attributeTemplates || [])
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      attributes: (item.attributes || [])
        .filter((attr) => attr.enabled !== false)
        .map((attr) => attr.name)
        .sort((a, b) => a.localeCompare(b))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectTemplateVariables(template: EventTemplateDefinition | null): string[] {
  if (!template) return ["assetPath"];
  if ((template.bindings || []).length > 0) {
    return (template.bindings || []).map((item) => item.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  const keys = new Set<string>();
  (template.assetPaths || []).forEach((item) => {
    if (item.source === "variable" && item.key) keys.add(item.key);
  });
  (template.eventPathBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.closePatternBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.contextFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  (template.captureFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  if (template.timeSource?.open?.source === "variable" && template.timeSource.open.key) keys.add(template.timeSource.open.key);
  if (template.timeSource?.close?.source === "variable" && template.timeSource.close.key) keys.add(template.timeSource.close.key);
  Object.values(template.contextBindings || {}).forEach((binding) => {
    if (binding.source === "variable" && binding.key) keys.add(binding.key);
  });

  const list = Array.from(keys).sort((a, b) => a.localeCompare(b));
  return list.length > 0 ? list : ["assetPath"];
}

function buildEmptyInputBinding(index: number): EventTemplateInputBindingDefinition {
  return {
    name: `binding_${index}`,
    source: "msg_path",
    templateId: "",
    defaultValue: ""
  };
}

function deriveAssetPathsFromBindings(bindings: EventTemplateInputBindingDefinition[]): EventTemplateAssetPathDefinition[] {
  return bindings
    .filter((item) => item.source === "asset")
    .map((item) => ({
      id: item.name,
      source: "variable" as const,
      key: item.name,
      value: "",
      templateId: item.templateId || ""
    }));
}

function parseLooseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

function formatLooseValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildEmptyField(index: number): EventTemplateFieldDefinition {
  return {
    key: `field_${index}`,
    source: "variable",
    variableKey: ""
  };
}

function updateArrayItem<T>(items: T[] | undefined, index: number, patch: Partial<T>): T[] {
  return (items || []).map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

function getTemplateAttributes(
  templateOptions: AssetTemplateOption[],
  assetPaths: EventTemplateAssetPathDefinition[] | undefined,
  assetPathId: string
): string[] {
  const templateId = (assetPaths || []).find((item) => item.id === assetPathId)?.templateId || "";
  return templateOptions.find((item) => item.id === templateId)?.attributes || [];
}

function getAssetPathLabel(assetPath: EventTemplateAssetPathDefinition, templateOptions: AssetTemplateOption[]): string {
  const templateName = templateOptions.find((item) => item.id === assetPath.templateId)?.name || "Any Template";
  return `${assetPath.id} (${templateName})`;
}

function buildTimeSourcePatch(
  source: EventTemplateTimeSourceDefinition["source"],
  templateVariables: string[],
  assetPaths: EventTemplateAssetPathDefinition[]
): EventTemplateTimeSourceDefinition {
  if (source === "now") return { source: "now" };
  if (source === "variable") return { source: "variable", key: templateVariables[0] || "timestamp" };
  return { source: "asset_path_attribute", assetPathId: assetPaths[0]?.id || "", attributeName: "" };
}

function buildEmptyPathSegment(): EventTemplatePathSegmentDefinition {
  return { type: "static", value: "", separator: "" };
}

function buildEmptyPatternBuilder(): EventTemplatePathSegmentDefinition[] {
  return [buildEmptyPathSegment()];
}

function updatePathSegment(
  segments: EventTemplatePathSegmentDefinition[] | undefined,
  index: number,
  patch: Partial<EventTemplatePathSegmentDefinition>
): EventTemplatePathSegmentDefinition[] {
  return (segments || []).map((segment, segmentIndex) =>
    segmentIndex === index ? { ...segment, ...patch } : segment
  );
}

function pathSegmentPreview(segment: EventTemplatePathSegmentDefinition): string {
  return renderEventTemplatePathBuilder([segment]);
}

function updateNestedPathSegment(
  groups: EventTemplatePathSegmentDefinition[][] | undefined,
  groupIndex: number,
  segmentIndex: number,
  patch: Partial<EventTemplatePathSegmentDefinition>
): EventTemplatePathSegmentDefinition[][] {
  return (groups || []).map((group, currentGroupIndex) =>
    currentGroupIndex === groupIndex
      ? group.map((segment, currentSegmentIndex) =>
          currentSegmentIndex === segmentIndex ? { ...segment, ...patch } : segment
        )
      : group
  );
}

export default function EventTemplateManager({
  assets,
  eventTemplates,
  selectedTemplateId,
  onSelectTemplate,
  onAddTemplate,
  onAddPresetTemplate,
  onRemoveTemplate,
  onUpdateTemplate
}: EventTemplateManagerProps) {
  const [search, setSearch] = useState("");
  const [draftAssetIds, setDraftAssetIds] = useState<Record<string, string>>({});
  const [draftContextKeys, setDraftContextKeys] = useState<Record<string, string>>({});
  const [draftCaptureKeys, setDraftCaptureKeys] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return eventTemplates;
    return eventTemplates.filter((item) =>
      `${item.id} ${item.eventPathTemplate} ${item.closePatternTemplate ?? ""}`.toLowerCase().includes(keyword)
    );
  }, [eventTemplates, search]);

  const selected =
    filtered.find((item) => item.id === selectedTemplateId) ||
    eventTemplates.find((item) => item.id === selectedTemplateId) ||
    null;

  useEffect(() => {
    setDraftAssetIds({});
    setDraftContextKeys({});
    setDraftCaptureKeys({});
  }, [selectedTemplateId]);

  const assetTemplateOptions = useMemo(() => getAssetTemplateOptions(assets), [assets]);
  const templateVariables = useMemo(() => collectTemplateVariables(selected), [selected]);
  const inputBindings = selected?.bindings || [];
  const assetPaths = useMemo(
    () => (inputBindings.length > 0 ? deriveAssetPathsFromBindings(inputBindings) : selected?.assetPaths || []),
    [inputBindings, selected?.assetPaths]
  );
  const contextFields = selected?.contextFields || [];
  const captureFields = selected?.captureFields || [];
  const capturedFieldKeys = useMemo(() => captureFields.map((item) => item.key).filter(Boolean), [captureFields]);
  const concurrencyMode = selected?.concurrencyMode || (selected?.allowParallel === false ? "unique_exact_path" : "parallel");
  const hasRequiredParent = ((selected?.requiredParentBuilder || []).length > 0) || Boolean(String(selected?.requiredParentPattern || "").trim());

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto auto auto 1fr", gap: 1 }}>
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Button variant="outlined" onClick={onAddTemplate}>
            Add Blank Event Template
          </Button>
          <Typography variant="caption" color="text.secondary">
            Quick start presets
          </Typography>
          <Box sx={{ display: "grid", gap: 0.5 }}>
            <Button size="small" variant="outlined" onClick={() => onAddPresetTemplate("job_lifecycle")}>
              Add Preset: Job Lifecycle
            </Button>
            <Button size="small" variant="outlined" onClick={() => onAddPresetTemplate("job_activity")}>
              Add Preset: Job Activity
            </Button>
            <Button size="small" variant="outlined" onClick={() => onAddPresetTemplate("machine_alarm")}>
              Add Preset: Machine Alarm
            </Button>
          </Box>
        </Box>
        <TextField size="small" label="Search Event Template" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Box sx={{ display: "grid", gap: 0.75, maxHeight: "calc(100vh - 260px)", ...scrollBothOverflowSx }}>
          {filtered.map((item) => (
            <Paper
              key={item.id}
              variant="outlined"
              onClick={() => onSelectTemplate(item.id)}
              sx={{ p: 0.9, cursor: "pointer", borderColor: item.id === selected?.id ? "#0f766e" : undefined }}
            >
              <Typography variant="subtitle2">{item.id}</Typography>
              <Typography variant="caption" color="text.secondary">
                {item.eventPathTemplate}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
        {!selected && <Typography color="text.secondary">Select an event template from the left panel.</Typography>}
        {selected && (
          <Box sx={{ display: "grid", gap: 1.25 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="h6">Event Template Detail</Typography>
              <Button color="error" variant="outlined" onClick={() => onRemoveTemplate(selected.id)}>
                Remove
              </Button>
            </Box>

            <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ minWidth: 220, backgroundColor: "#d0dfdb" }}>Setting</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb" }}>Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Template ID</TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth value={selected.id} onChange={(e) => onUpdateTemplate(selected.id, { id: e.target.value })} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Template Enabled</TableCell>
                    <TableCell>
                      <FormControlLabel
                        control={<Switch checked={selected.enabled !== false} onChange={(_e, checked) => onUpdateTemplate(selected.id, { enabled: checked })} />}
                        label="Enabled"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Concurrency Mode</TableCell>
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={concurrencyMode}
                          onChange={(e) => {
                            const mode = String(e.target.value || "parallel") as NonNullable<EventTemplateDefinition["concurrencyMode"]>;
                            onUpdateTemplate(selected.id, {
                              concurrencyMode: mode,
                              allowParallel: mode === "parallel",
                              ...(mode !== "unique_pattern"
                                ? {
                                    uniquePatternBuilder: [],
                                    uniquePatternTemplate: ""
                                  }
                                : {})
                            });
                          }}
                        >
                          <MenuItem value="parallel">Parallel Allowed</MenuItem>
                          <MenuItem value="unique_exact_path">Unique By Exact Event Path</MenuItem>
                          <MenuItem value="unique_pattern">Unique By Pattern / Group</MenuItem>
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Concurrency Behavior</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {concurrencyMode === "parallel"
                          ? "Every open request can create a new event row."
                          : concurrencyMode === "unique_exact_path"
                            ? "Only one open event with the same exact event path is allowed."
                            : "Only one open event inside the configured unique pattern group is allowed."}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Open Event Path Preview</TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth value={renderEventTemplatePathBuilder(selected.eventPathBuilder)} disabled helperText="Built from the Open Path Builder below" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Close Pattern Preview</TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth value={renderEventTemplatePathBuilder(selected.closePatternBuilder)} disabled helperText="Built from the Close Pattern Builder below" />
                    </TableCell>
                  </TableRow>
                  {concurrencyMode === "unique_pattern" && (
                    <TableRow>
                      <TableCell>Unique Pattern Preview</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={renderEventTemplatePathBuilder(selected.uniquePatternBuilder)}
                          disabled
                          helperText="Open requests will be unique inside this pattern group"
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {hasRequiredParent && (
                    <TableRow>
                      <TableCell>Required Parent Preview</TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={renderEventTemplatePathBuilder(selected.requiredParentBuilder)}
                          disabled
                          helperText="This event can only open while a matching parent event is already open"
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell>Default Severity</TableCell>
                    <TableCell>
                      <TextField size="small" fullWidth value={selected.severity ?? "other"} onChange={(e) => onUpdateTemplate(selected.id, { severity: e.target.value })} />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Capture On Open</TableCell>
                    <TableCell>
                      <FormControlLabel
                        control={<Switch checked={selected.capture?.onOpen !== false} onChange={(_e, checked) => onUpdateTemplate(selected.id, { capture: { ...(selected.capture || {}), onOpen: checked } })} />}
                        label="Capture configured values on open"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Capture On Close</TableCell>
                    <TableCell>
                      <FormControlLabel
                        control={<Switch checked={selected.capture?.onClose !== false} onChange={(_e, checked) => onUpdateTemplate(selected.id, { capture: { ...(selected.capture || {}), onClose: checked } })} />}
                        label="Capture configured values on close"
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {([
              { key: "eventPathBuilder", title: "Open Event Path Builder" },
              { key: "closePatternBuilder", title: "Close Event Pattern Builder" },
              ...(concurrencyMode === "unique_pattern"
                ? [{ key: "uniquePatternBuilder", title: "Unique Pattern Builder" } as const]
                : [])
            ] as const).map((builderDef) => {
              const segments = (selected[builderDef.key] || []) as EventTemplatePathSegmentDefinition[];
              return (
                <Paper key={builderDef.key} variant="outlined" sx={{ p: 1 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                    <Box>
                      <Typography variant="subtitle2">{builderDef.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Build pattern with `/` to model hierarchy. Bindings are explicit. No automatic parsing from curly braces.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        const nextSegments = [...segments, buildEmptyPathSegment()];
                        const rendered = renderEventTemplatePathBuilder(nextSegments);
                        onUpdateTemplate(selected.id, {
                          [builderDef.key]: nextSegments,
                          ...(builderDef.key === "eventPathBuilder"
                            ? { eventPathTemplate: rendered }
                            : builderDef.key === "closePatternBuilder"
                              ? { closePatternTemplate: rendered }
                              : builderDef.key === "uniquePatternBuilder"
                                ? { uniquePatternTemplate: rendered }
                                : { requiredParentPattern: rendered })
                        } as Partial<EventTemplateDefinition>);
                      }}
                    >
                      Add Segment
                    </Button>
                  </Box>
                  <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Type</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Value</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Separator</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Preview</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", width: 110 }}>Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {segments.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <Typography variant="caption" color="text.secondary">
                                Add ordered segments: static text, binding, or wildcard.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                        {segments.map((segment, index) => {
                          const builderPatchKey =
                            builderDef.key === "eventPathBuilder"
                              ? "eventPathTemplate"
                              : builderDef.key === "closePatternBuilder"
                                ? "closePatternTemplate"
                                : builderDef.key === "uniquePatternBuilder"
                                  ? "uniquePatternTemplate"
                                  : "requiredParentPattern";
                          const nextBuilder = (patch: Partial<EventTemplatePathSegmentDefinition>) => {
                            const nextSegments = updatePathSegment(segments, index, patch);
                            const rendered = renderEventTemplatePathBuilder(nextSegments);
                            onUpdateTemplate(selected.id, {
                              [builderDef.key]: nextSegments,
                              [builderPatchKey]: rendered
                            } as Partial<EventTemplateDefinition>);
                          };
                          return (
                            <TableRow key={`${builderDef.key}:${index}`}>
                              <TableCell>
                                <FormControl size="small" fullWidth>
                                  <Select
                                    value={segment.type}
                                    onChange={(e) => {
                                      const type = String(e.target.value) as EventTemplatePathSegmentDefinition["type"];
                                      nextBuilder({
                                        type,
                                        value:
                                          type === "binding"
                                            ? templateVariables[0] || assetPaths[0]?.id || ""
                                            : type === "wildcard"
                                              ? "*"
                                              : ""
                                      });
                                    }}
                                  >
                                    <MenuItem value="static">Static Text</MenuItem>
                                    <MenuItem value="binding">Binding</MenuItem>
                                    <MenuItem value="wildcard">Wildcard (*)</MenuItem>
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell>
                                {segment.type === "static" && (
                                  <TextField size="small" fullWidth value={segment.value ?? ""} onChange={(e) => nextBuilder({ value: e.target.value })} />
                                )}
                                {segment.type === "binding" && (
                                  <FormControl size="small" fullWidth>
                                    <Select value={segment.value ?? ""} onChange={(e) => nextBuilder({ value: String(e.target.value || "") })}>
                                      {templateVariables.map((item) => (
                                        <MenuItem key={item} value={item}>
                                          {item}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                )}
                                {segment.type === "wildcard" && (
                                  <TextField size="small" fullWidth value="*" disabled />
                                )}
                              </TableCell>
                              <TableCell>
                                <FormControl size="small" fullWidth>
                                  <Select value={segment.separator ?? ""} onChange={(e) => nextBuilder({ separator: String(e.target.value || "") as EventTemplatePathSegmentDefinition["separator"] })}>
                                    <MenuItem value="">None</MenuItem>
                                    <MenuItem value="/">/</MenuItem>
                                    <MenuItem value=".">.</MenuItem>
                                    <MenuItem value="-">-</MenuItem>
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                                  {pathSegmentPreview(segment)}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  onClick={() => {
                                    const nextSegments = segments.filter((_item, itemIndex) => itemIndex !== index);
                                    const rendered = renderEventTemplatePathBuilder(nextSegments);
                                    onUpdateTemplate(selected.id, {
                                      [builderDef.key]: nextSegments,
                                      [builderPatchKey]: rendered
                                    } as Partial<EventTemplateDefinition>);
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
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                    Result: {renderEventTemplatePathBuilder(segments)}
                  </Typography>
                </Paper>
              );
            })}

            <Paper variant="outlined" sx={{ p: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: hasRequiredParent ? 0.75 : 0 }}>
                <Box>
                  <Typography variant="subtitle2">Required Parent Rule</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Use this when the event must exist only inside a parent event window.
                  </Typography>
                </Box>
                {!hasRequiredParent ? (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => onUpdateTemplate(selected.id, {
                      requiredParentBuilder: [buildEmptyPathSegment()],
                      requiredParentPattern: ""
                    })}
                  >
                    Enable Parent Rule
                  </Button>
                ) : (
                  <Box sx={{ display: "flex", gap: 0.75 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => onUpdateTemplate(selected.id, {
                        requiredParentBuilder: [...(selected.requiredParentBuilder || []), buildEmptyPathSegment()],
                        requiredParentPattern: renderEventTemplatePathBuilder([...(selected.requiredParentBuilder || []), buildEmptyPathSegment()])
                      })}
                    >
                      Add Segment
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => onUpdateTemplate(selected.id, {
                        requiredParentBuilder: [],
                        requiredParentPattern: ""
                      })}
                    >
                      Disable Parent Rule
                    </Button>
                  </Box>
                )}
              </Box>
              {!hasRequiredParent && (
                <Typography variant="caption" color="text.secondary">
                  Hidden because this template currently does not require a parent event.
                </Typography>
              )}
              {hasRequiredParent && (
                <>
                  <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Type</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Value</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Separator</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Preview</TableCell>
                          <TableCell sx={{ backgroundColor: "#d0dfdb", width: 110 }}>Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(selected.requiredParentBuilder || []).map((segment, index) => {
                          const nextBuilder = (patch: Partial<EventTemplatePathSegmentDefinition>) => {
                            const nextSegments = updatePathSegment(selected.requiredParentBuilder || [], index, patch);
                            const rendered = renderEventTemplatePathBuilder(nextSegments);
                            onUpdateTemplate(selected.id, {
                              requiredParentBuilder: nextSegments,
                              requiredParentPattern: rendered
                            });
                          };
                          return (
                            <TableRow key={`requiredParent:${index}`}>
                              <TableCell>
                                <FormControl size="small" fullWidth>
                                  <Select
                                    value={segment.type}
                                    onChange={(e) => {
                                      const type = String(e.target.value) as EventTemplatePathSegmentDefinition["type"];
                                      nextBuilder({
                                        type,
                                        value: type === "binding" ? templateVariables[0] || assetPaths[0]?.id || "" : type === "wildcard" ? "*" : ""
                                      });
                                    }}
                                  >
                                    <MenuItem value="static">Static Text</MenuItem>
                                    <MenuItem value="binding">Binding</MenuItem>
                                    <MenuItem value="wildcard">Wildcard (*)</MenuItem>
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell>
                                {segment.type === "static" && (
                                  <TextField size="small" fullWidth value={segment.value ?? ""} onChange={(e) => nextBuilder({ value: e.target.value })} />
                                )}
                                {segment.type === "binding" && (
                                  <FormControl size="small" fullWidth>
                                    <Select value={segment.value ?? ""} onChange={(e) => nextBuilder({ value: String(e.target.value || "") })}>
                                      {templateVariables.map((item) => (
                                        <MenuItem key={item} value={item}>
                                          {item}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                )}
                                {segment.type === "wildcard" && <TextField size="small" fullWidth value="*" disabled />}
                              </TableCell>
                              <TableCell>
                                <FormControl size="small" fullWidth>
                                  <Select value={segment.separator ?? ""} onChange={(e) => nextBuilder({ separator: String(e.target.value || "") as EventTemplatePathSegmentDefinition["separator"] })}>
                                    <MenuItem value="">None</MenuItem>
                                    <MenuItem value="/">/</MenuItem>
                                    <MenuItem value=".">.</MenuItem>
                                    <MenuItem value="-">-</MenuItem>
                                  </Select>
                                </FormControl>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                                  {pathSegmentPreview(segment)}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  onClick={() => {
                                    const nextSegments = (selected.requiredParentBuilder || []).filter((_item, itemIndex) => itemIndex !== index);
                                    onUpdateTemplate(selected.id, {
                                      requiredParentBuilder: nextSegments,
                                      requiredParentPattern: renderEventTemplatePathBuilder(nextSegments)
                                    });
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
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                    Result: {renderEventTemplatePathBuilder(selected.requiredParentBuilder)}
                  </Typography>
                </>
              )}
            </Paper>

            <Paper variant="outlined" sx={{ p: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                <Typography variant="subtitle2">Bindings</Typography>
                <Button size="small" variant="outlined" onClick={() => onUpdateTemplate(selected.id, { bindings: [...inputBindings, buildEmptyInputBinding(inputBindings.length + 1)], assetPaths: assetPaths })}>
                  Add Binding
                </Button>
              </Box>
              <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Binding Name</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 170 }}>Binding Type</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 320 }}>Default / Hint</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Asset Template</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", width: 110 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {inputBindings.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="caption" color="text.secondary">
                            Define all required bindings here. Path builder, time source, context, captured values, and event action bindings will all reuse this same registry.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {inputBindings.map((item, index) => {
                      const draftKey = `${index}:${item.name}`;
                      return (
                        <TableRow key={draftKey}>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              value={draftAssetIds[draftKey] ?? item.name}
                              onChange={(e) => setDraftAssetIds((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                              onBlur={() => {
                                const nextId = (draftAssetIds[draftKey] ?? item.name).trim();
                                if (!nextId || nextId === item.name) return;
                                const nextBindings = inputBindings.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, name: nextId } : binding);
                                const nextAssetPaths = deriveAssetPathsFromBindings(nextBindings);
                                onUpdateTemplate(selected.id, {
                                  bindings: nextBindings,
                                  assetPaths: nextAssetPaths,
                                  contextFields: contextFields.map((field) => (field.assetPathId === item.name ? { ...field, assetPathId: nextId } : field)),
                                  captureFields: captureFields.map((field) => (field.assetPathId === item.name ? { ...field, assetPathId: nextId } : field)),
                                  timeSource: {
                                    open: selected.timeSource?.open?.assetPathId === item.name ? { ...selected.timeSource.open, assetPathId: nextId } : selected.timeSource?.open,
                                    close: selected.timeSource?.close?.assetPathId === item.name ? { ...selected.timeSource.close, assetPathId: nextId } : selected.timeSource?.close
                                  }
                                });
                                setDraftAssetIds((prev) => {
                                  const next = { ...prev };
                                  delete next[draftKey];
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" fullWidth>
                              <Select
                                value={item.source}
                                onChange={(e) => {
                                  const source = String(e.target.value) as EventTemplateInputBindingDefinition["source"];
                                  const nextBindings = inputBindings.map((binding, bindingIndex) =>
                                    bindingIndex === index ? normalizeEventTemplateInputBinding({ ...binding, source }) : binding
                                  );
                                  onUpdateTemplate(selected.id, {
                                    bindings: nextBindings,
                                    assetPaths: deriveAssetPathsFromBindings(nextBindings)
                                  });
                                }}
                              >
                                <MenuItem value="msg_path">msg_path</MenuItem>
                                <MenuItem value="asset">asset</MenuItem>
                                <MenuItem value="attribute">asset_attribute</MenuItem>
                                <MenuItem value="static_string">static_string</MenuItem>
                                <MenuItem value="static_number">static_number</MenuItem>
                                <MenuItem value="static_boolean">static_boolean</MenuItem>
                                <MenuItem value="static_array">static_array</MenuItem>
                                <MenuItem value="static_object">static_object</MenuItem>
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            {item.source === "msg_path" && (
                              <TextField
                                size="small"
                                fullWidth
                                label="Message Path Hint"
                                value={String(item.defaultValue ?? "")}
                                onChange={(e) => onUpdateTemplate(selected.id, { bindings: inputBindings.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, defaultValue: e.target.value } : binding) })}
                                helperText="Example: payload.workOrder"
                              />
                            )}
                            {item.source === "asset" && (
                              <Typography variant="caption" color="text.secondary">Will appear in Event Action as asset picker. Source type will be locked there.</Typography>
                            )}
                            {item.source === "attribute" && (
                              <Typography variant="caption" color="text.secondary">Will appear in Event Action as attribute picker. If template selected, picker is filtered by that template.</Typography>
                            )}
                            {(item.source === "static_string" || item.source === "static_number" || item.source === "static_boolean" || item.source === "static_array" || item.source === "static_object") && (
                              <TextField
                                size="small"
                                fullWidth
                                value={typeof item.defaultValue === "string" ? item.defaultValue : JSON.stringify(item.defaultValue ?? "")}
                                onChange={(e) => onUpdateTemplate(selected.id, { bindings: inputBindings.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, defaultValue: e.target.value } : binding) })}
                                helperText="Default value for event action binding"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" fullWidth>
                              <Select value={item.templateId ?? ""} onChange={(e) => {
                                const nextBindings = inputBindings.map((binding, bindingIndex) => bindingIndex === index ? { ...binding, templateId: String(e.target.value || "") } : binding);
                                onUpdateTemplate(selected.id, { bindings: nextBindings, assetPaths: deriveAssetPathsFromBindings(nextBindings) });
                              }}>
                                <MenuItem value="">(Any Template)</MenuItem>
                                {assetTemplateOptions.map((option) => (
                                  <MenuItem key={option.id} value={option.id}>
                                    {option.name}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            <Button size="small" color="error" variant="outlined" onClick={() => {
                              const nextBindings = inputBindings.filter((_item, itemIndex) => itemIndex !== index);
                              onUpdateTemplate(selected.id, { bindings: nextBindings, assetPaths: deriveAssetPathsFromBindings(nextBindings) });
                            }}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            {([
              {
                title: "Close Other Events On Open",
                description: "When this event opens, runtime will close all matching open events first.",
                builderKey: "closeOnOpenPatternBuilders",
                valueKey: "closeOnOpenPatterns",
                addLabel: "Add Pattern"
              },
              {
                title: "Close Child Events On Close",
                description: "When this parent event closes, runtime will close all matching child events using the same close timestamp.",
                builderKey: "closeChildrenOnClosePatternBuilders",
                valueKey: "closeChildrenOnClosePatterns",
                addLabel: "Add Child Pattern"
              }
            ] as const).map((ruleDef) => {
              const builders = (selected[ruleDef.builderKey] || []) as EventTemplatePathSegmentDefinition[][];
              return (
                <Paper key={ruleDef.builderKey} variant="outlined" sx={{ p: 1 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                    <Box>
                      <Typography variant="subtitle2">{ruleDef.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ruleDef.description}
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        const nextBuilders = [...builders, buildEmptyPatternBuilder()];
                        onUpdateTemplate(selected.id, {
                          [ruleDef.builderKey]: nextBuilders,
                          [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                        } as Partial<EventTemplateDefinition>);
                      }}
                    >
                      {ruleDef.addLabel}
                    </Button>
                  </Box>
                  {builders.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      No rules yet. Add one or more patterns. Use `/` to model hierarchy and `*` for wildcard segment.
                    </Typography>
                  )}
                  <Box sx={{ display: "grid", gap: 1 }}>
                    {builders.map((segments, ruleIndex) => (
                      <Paper key={`${ruleDef.builderKey}:${ruleIndex}`} variant="outlined" sx={{ p: 0.85 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            Rule {ruleIndex + 1}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 0.75 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                const nextBuilders = builders.map((builder, index) => index === ruleIndex ? [...builder, buildEmptyPathSegment()] : builder);
                                onUpdateTemplate(selected.id, {
                                  [ruleDef.builderKey]: nextBuilders,
                                  [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                } as Partial<EventTemplateDefinition>);
                              }}
                            >
                              Add Segment
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              onClick={() => {
                                const nextBuilders = builders.filter((_builder, index) => index !== ruleIndex);
                                onUpdateTemplate(selected.id, {
                                  [ruleDef.builderKey]: nextBuilders,
                                  [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                } as Partial<EventTemplateDefinition>);
                              }}
                            >
                              Remove Rule
                            </Button>
                          </Box>
                        </Box>
                        <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Type</TableCell>
                                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Value</TableCell>
                                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Separator</TableCell>
                                <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Preview</TableCell>
                                <TableCell sx={{ backgroundColor: "#d0dfdb", width: 120 }}>Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {segments.map((segment, segmentIndex) => (
                                <TableRow key={`${ruleDef.builderKey}:${ruleIndex}:${segmentIndex}`}>
                                  <TableCell>
                                    <FormControl size="small" fullWidth>
                                      <Select
                                        value={segment.type}
                                        onChange={(e) => {
                                          const type = String(e.target.value) as EventTemplatePathSegmentDefinition["type"];
                                          const nextBuilders = updateNestedPathSegment(builders, ruleIndex, segmentIndex, {
                                            type,
                                            value: type === "binding" ? templateVariables[0] || assetPaths[0]?.id || "" : type === "wildcard" ? "*" : ""
                                          });
                                          onUpdateTemplate(selected.id, {
                                            [ruleDef.builderKey]: nextBuilders,
                                            [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                          } as Partial<EventTemplateDefinition>);
                                        }}
                                      >
                                        <MenuItem value="static">Static Text</MenuItem>
                                        <MenuItem value="binding">Binding</MenuItem>
                                        <MenuItem value="wildcard">Wildcard (*)</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </TableCell>
                                  <TableCell>
                                    {segment.type === "static" && (
                                      <TextField
                                        size="small"
                                        fullWidth
                                        value={segment.value ?? ""}
                                        onChange={(e) => {
                                          const nextBuilders = updateNestedPathSegment(builders, ruleIndex, segmentIndex, { value: e.target.value });
                                          onUpdateTemplate(selected.id, {
                                            [ruleDef.builderKey]: nextBuilders,
                                            [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                          } as Partial<EventTemplateDefinition>);
                                        }}
                                      />
                                    )}
                                    {segment.type === "binding" && (
                                      <FormControl size="small" fullWidth>
                                        <Select
                                          value={segment.value ?? ""}
                                          onChange={(e) => {
                                            const nextBuilders = updateNestedPathSegment(builders, ruleIndex, segmentIndex, { value: String(e.target.value || "") });
                                            onUpdateTemplate(selected.id, {
                                              [ruleDef.builderKey]: nextBuilders,
                                              [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                            } as Partial<EventTemplateDefinition>);
                                          }}
                                        >
                                          {templateVariables.map((item) => (
                                            <MenuItem key={item} value={item}>
                                              {item}
                                            </MenuItem>
                                          ))}
                                        </Select>
                                      </FormControl>
                                    )}
                                    {segment.type === "wildcard" && <TextField size="small" fullWidth value="*" disabled />}
                                  </TableCell>
                                  <TableCell>
                                    <FormControl size="small" fullWidth>
                                      <Select
                                        value={segment.separator ?? ""}
                                        onChange={(e) => {
                                          const nextBuilders = updateNestedPathSegment(builders, ruleIndex, segmentIndex, {
                                            separator: String(e.target.value || "") as EventTemplatePathSegmentDefinition["separator"]
                                          });
                                          onUpdateTemplate(selected.id, {
                                            [ruleDef.builderKey]: nextBuilders,
                                            [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                          } as Partial<EventTemplateDefinition>);
                                        }}
                                      >
                                        <MenuItem value="">None</MenuItem>
                                        <MenuItem value="/">/</MenuItem>
                                        <MenuItem value=".">.</MenuItem>
                                        <MenuItem value="-">-</MenuItem>
                                      </Select>
                                    </FormControl>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                                      {pathSegmentPreview(segment)}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="outlined"
                                      onClick={() => {
                                        const nextBuilders = builders.map((builder, index) =>
                                          index === ruleIndex ? builder.filter((_segment, idx) => idx !== segmentIndex) : builder
                                        );
                                        onUpdateTemplate(selected.id, {
                                          [ruleDef.builderKey]: nextBuilders,
                                          [ruleDef.valueKey]: nextBuilders.map((builder) => renderEventTemplatePathBuilder(builder)).filter(Boolean)
                                        } as Partial<EventTemplateDefinition>);
                                      }}
                                    >
                                      Remove
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                          Result: {renderEventTemplatePathBuilder(segments)}
                        </Typography>
                      </Paper>
                    ))}
                  </Box>
                </Paper>
              );
            })}

            <Paper variant="outlined" sx={{ p: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                Time Source
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                {(["open", "close"] as const).map((phase) => {
                  const sourceDef = selected.timeSource?.[phase] || { source: "now" as const };
                  const attributeOptions = getTemplateAttributes(assetTemplateOptions, assetPaths, sourceDef.assetPathId || assetPaths[0]?.id || "");
                  return (
                    <Paper key={phase} variant="outlined" sx={{ p: 1, display: "grid", gap: 0.75 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, textTransform: "capitalize" }}>
                        {phase} Time
                      </Typography>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={sourceDef.source}
                          onChange={(e) =>
                            onUpdateTemplate(selected.id, {
                              timeSource: {
                                ...(selected.timeSource || {}),
                                [phase]: buildTimeSourcePatch(String(e.target.value) as EventTemplateTimeSourceDefinition["source"], templateVariables, assetPaths)
                              }
                            })
                          }
                        >
                          <MenuItem value="now">Now</MenuItem>
                          <MenuItem value="variable">Variable</MenuItem>
                          <MenuItem value="asset_path_attribute">Asset Path Attribute</MenuItem>
                        </Select>
                      </FormControl>
                      {sourceDef.source === "variable" && (
                        <TextField
                          size="small"
                          label="Variable Name"
                          value={sourceDef.key ?? ""}
                          onChange={(e) =>
                            onUpdateTemplate(selected.id, {
                              timeSource: { ...(selected.timeSource || {}), [phase]: { source: "variable", key: e.target.value } }
                            })
                          }
                        />
                      )}
                      {sourceDef.source === "asset_path_attribute" && (
                        <>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={sourceDef.assetPathId ?? ""}
                              onChange={(e) =>
                                onUpdateTemplate(selected.id, {
                                  timeSource: {
                                    ...(selected.timeSource || {}),
                                    [phase]: { source: "asset_path_attribute", assetPathId: String(e.target.value || ""), attributeName: "" }
                                  }
                                })
                              }
                            >
                              {assetPaths.map((item) => (
                                <MenuItem key={item.id} value={item.id}>
                                  {getAssetPathLabel(item, assetTemplateOptions)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <FormControl size="small" fullWidth>
                            <Select
                              value={sourceDef.attributeName ?? ""}
                              onChange={(e) =>
                                onUpdateTemplate(selected.id, {
                                  timeSource: {
                                    ...(selected.timeSource || {}),
                                    [phase]: { ...sourceDef, source: "asset_path_attribute", attributeName: String(e.target.value || "") }
                                  }
                                })
                              }
                            >
                              {attributeOptions.map((item) => (
                                <MenuItem key={item} value={item}>
                                  {item}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </>
                      )}
                    </Paper>
                  );
                })}
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                <Typography variant="subtitle2">Context Fields</Typography>
                <Button size="small" variant="outlined" onClick={() => onUpdateTemplate(selected.id, { contextFields: [...contextFields, buildEmptyField(contextFields.length + 1)] })}>
                  Add Context Field
                </Button>
              </Box>
              <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Field Name</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 170 }}>Source</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 380 }}>Attribute Setting</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", width: 110 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {contextFields.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="caption" color="text.secondary">
                            Context can combine variables, statics, captured values, and attributes from multiple asset paths.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {contextFields.map((field, index) => {
                      const draftKey = `${index}:${field.key}`;
                      const attributeOptions = getTemplateAttributes(assetTemplateOptions, assetPaths, field.assetPathId || assetPaths[0]?.id || "");
                      return (
                        <TableRow key={draftKey}>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              value={draftContextKeys[draftKey] ?? field.key}
                              onChange={(e) => setDraftContextKeys((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                              onBlur={() => {
                                const nextKey = (draftContextKeys[draftKey] ?? field.key).trim();
                                if (!nextKey || nextKey === field.key) return;
                                onUpdateTemplate(selected.id, { contextFields: contextFields.map((item, itemIndex) => (itemIndex === index ? { ...item, key: nextKey } : item)) });
                                setDraftContextKeys((prev) => {
                                  const next = { ...prev };
                                  delete next[draftKey];
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" fullWidth>
                              <Select
                                value={field.source}
                                onChange={(e) => {
                                  const source = String(e.target.value) as EventTemplateFieldSource;
                                  const patch: Partial<EventTemplateFieldDefinition> =
                                    source === "variable"
                                      ? { source, variableKey: templateVariables[0] || "", value: undefined, assetPathId: undefined, attributeName: undefined, capturedKey: undefined }
                                      : source === "static"
                                        ? { source, value: "", variableKey: undefined, assetPathId: undefined, attributeName: undefined, capturedKey: undefined }
                                        : source === "captured_value"
                                          ? { source, capturedKey: capturedFieldKeys[0] || "", variableKey: undefined, value: undefined, assetPathId: undefined, attributeName: undefined }
                                          : { source, assetPathId: assetPaths[0]?.id || "", attributeName: "", variableKey: undefined, value: undefined, capturedKey: undefined };
                                  onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, patch) });
                                }}
                              >
                                <MenuItem value="variable">Variable</MenuItem>
                                <MenuItem value="static">Static</MenuItem>
                                <MenuItem value="asset_path_attribute">Asset Path Attribute</MenuItem>
                                <MenuItem value="captured_value">Captured Value</MenuItem>
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            {field.source === "variable" && (
                              <TextField size="small" fullWidth label="Variable Name" value={field.variableKey ?? ""} onChange={(e) => onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, { variableKey: e.target.value }) })} />
                            )}
                            {field.source === "static" && (
                              <TextField size="small" fullWidth label="Static Value" value={formatLooseValue(field.value)} onChange={(e) => onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, { value: parseLooseValue(e.target.value) }) })} helperText="Text biasa boleh. Untuk object/array/number/boolean, isi JSON valid." />
                            )}
                            {field.source === "captured_value" && (
                              <FormControl size="small" fullWidth>
                                <Select value={field.capturedKey ?? ""} onChange={(e) => onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, { capturedKey: String(e.target.value || "") }) })}>
                                  {capturedFieldKeys.map((item) => (
                                    <MenuItem key={item} value={item}>
                                      {item}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            )}
                            {field.source === "asset_path_attribute" && (
                              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
                                <FormControl size="small" fullWidth>
                                  <Select value={field.assetPathId ?? ""} onChange={(e) => onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, { assetPathId: String(e.target.value || ""), attributeName: "" }) })}>
                                    {assetPaths.map((item) => (
                                      <MenuItem key={item.id} value={item.id}>
                                        {getAssetPathLabel(item, assetTemplateOptions)}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <FormControl size="small" fullWidth>
                                  <Select
                                    value={field.attributeName ?? ""}
                                    onChange={(e) => {
                                      const attributeName = String(e.target.value || "");
                                      onUpdateTemplate(selected.id, { contextFields: updateArrayItem(contextFields, index, { attributeName, key: field.key || attributeName }) });
                                    }}
                                  >
                                    {attributeOptions.map((item) => (
                                      <MenuItem key={item} value={item}>
                                        {item}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button size="small" color="error" variant="outlined" onClick={() => onUpdateTemplate(selected.id, { contextFields: contextFields.filter((_item, itemIndex) => itemIndex !== index) })}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.75 }}>
                <Typography variant="subtitle2">Captured Values</Typography>
                <Button size="small" variant="outlined" onClick={() => onUpdateTemplate(selected.id, { captureFields: [...captureFields, buildEmptyField(captureFields.length + 1)] })}>
                  Add Captured Value
                </Button>
              </Box>
              <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Captured Key</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 170 }}>Source</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 380 }}>Attribute Setting</TableCell>
                      <TableCell sx={{ backgroundColor: "#d0dfdb", width: 110 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {captureFields.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="caption" color="text.secondary">
                            Capture values can come from variables, static values, or attributes from multiple asset paths.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {captureFields.map((field, index) => {
                      const draftKey = `${index}:${field.key}`;
                      const attributeOptions = getTemplateAttributes(assetTemplateOptions, assetPaths, field.assetPathId || assetPaths[0]?.id || "");
                      return (
                        <TableRow key={draftKey}>
                          <TableCell>
                            <TextField
                              size="small"
                              fullWidth
                              value={draftCaptureKeys[draftKey] ?? field.key}
                              onChange={(e) => setDraftCaptureKeys((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                              onBlur={() => {
                                const nextKey = (draftCaptureKeys[draftKey] ?? field.key).trim();
                                if (!nextKey || nextKey === field.key) return;
                                onUpdateTemplate(selected.id, { captureFields: captureFields.map((item, itemIndex) => (itemIndex === index ? { ...item, key: nextKey } : item)) });
                                setDraftCaptureKeys((prev) => {
                                  const next = { ...prev };
                                  delete next[draftKey];
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" fullWidth>
                              <Select
                                value={field.source === "captured_value" ? "asset_path_attribute" : field.source}
                                onChange={(e) => {
                                  const source = String(e.target.value) as Exclude<EventTemplateFieldSource, "captured_value">;
                                  const patch: Partial<EventTemplateFieldDefinition> =
                                    source === "variable"
                                      ? { source, variableKey: templateVariables[0] || "", value: undefined, assetPathId: undefined, attributeName: undefined, capturedKey: undefined }
                                      : source === "static"
                                        ? { source, value: "", variableKey: undefined, assetPathId: undefined, attributeName: undefined, capturedKey: undefined }
                                        : { source, assetPathId: assetPaths[0]?.id || "", attributeName: "", variableKey: undefined, value: undefined, capturedKey: undefined };
                                  onUpdateTemplate(selected.id, { captureFields: updateArrayItem(captureFields, index, patch) });
                                }}
                              >
                                <MenuItem value="variable">Variable</MenuItem>
                                <MenuItem value="static">Static</MenuItem>
                                <MenuItem value="asset_path_attribute">Asset Path Attribute</MenuItem>
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            {field.source === "variable" && (
                              <TextField size="small" fullWidth label="Variable Name" value={field.variableKey ?? ""} onChange={(e) => onUpdateTemplate(selected.id, { captureFields: updateArrayItem(captureFields, index, { variableKey: e.target.value }) })} />
                            )}
                            {field.source === "static" && (
                              <TextField size="small" fullWidth label="Static Value" value={formatLooseValue(field.value)} onChange={(e) => onUpdateTemplate(selected.id, { captureFields: updateArrayItem(captureFields, index, { value: parseLooseValue(e.target.value) }) })} helperText="Text biasa boleh. Untuk object/array/number/boolean, isi JSON valid." />
                            )}
                            {field.source === "asset_path_attribute" && (
                              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
                                <FormControl size="small" fullWidth>
                                  <Select value={field.assetPathId ?? ""} onChange={(e) => onUpdateTemplate(selected.id, { captureFields: updateArrayItem(captureFields, index, { assetPathId: String(e.target.value || ""), attributeName: "" }) })}>
                                    {assetPaths.map((item) => (
                                      <MenuItem key={item.id} value={item.id}>
                                        {getAssetPathLabel(item, assetTemplateOptions)}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                <FormControl size="small" fullWidth>
                                  <Select
                                    value={field.attributeName ?? ""}
                                    onChange={(e) => {
                                      const attributeName = String(e.target.value || "");
                                      onUpdateTemplate(selected.id, { captureFields: updateArrayItem(captureFields, index, { attributeName, key: field.key || attributeName }) });
                                    }}
                                  >
                                    {attributeOptions.map((item) => (
                                      <MenuItem key={item} value={item}>
                                        {item}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button size="small" color="error" variant="outlined" onClick={() => onUpdateTemplate(selected.id, { captureFields: captureFields.filter((_item, itemIndex) => itemIndex !== index) })}>
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
