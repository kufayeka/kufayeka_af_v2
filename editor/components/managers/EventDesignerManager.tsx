
import { useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { FolderTree, Zap } from "lucide-react";
import EventTemplateManager from "./EventTemplateManager";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type {
  AssetFrameworkDefinition,
  EventActionBindingDefinition,
  EventActionDefinition,
  EventTemplateDefinition
} from "../../types/program";

interface EventDesignerManagerProps {
  eventActions: EventActionDefinition[];
  eventTemplates: EventTemplateDefinition[];
  assets: AssetFrameworkDefinition;
  selectedEventActionId: string;
  selectedEventTemplateId: string;
  onSelectEventAction: (id: string) => void;
  onSelectEventTemplate: (id: string) => void;
  onAddEventAction: () => void;
  onAddEventActionFromTemplate: (templateId: string) => void;
  onUpdateEventAction: (id: string, patch: Partial<EventActionDefinition>) => void;
  onRenameEventAction: (oldId: string, newId: string) => void;
  onRemoveEventAction: (id: string) => void;
  onAddEventTemplate: () => void;
  onAddPresetTemplate: (preset: "job_lifecycle" | "job_activity" | "machine_alarm") => void;
  onRemoveEventTemplate: (id: string) => void;
  onUpdateEventTemplate: (id: string, patch: Partial<EventTemplateDefinition>) => void;
}

interface AssetPathOption {
  id: string;
  path: string;
  templateIds: string[];
}

function buildEventHierarchyTree(eventActions: EventActionDefinition[], search: string): DataNode[] {
  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? eventActions.filter((item) => `${item.id} ${item.label ?? ""} ${item.description ?? ""}`.toLowerCase().includes(keyword))
    : eventActions;

  const folderChildren = new Map<string, Set<string>>();
  const eventChildren = new Map<string, EventActionDefinition[]>();
  const ensureFolder = (path: string) => {
    if (!folderChildren.has(path)) folderChildren.set(path, new Set<string>());
    if (!eventChildren.has(path)) eventChildren.set(path, []);
  };

  ensureFolder("event");
  for (const item of filtered) {
    const segments = item.id.split(".").filter(Boolean);
    const folders = segments.slice(0, -1);
    let parent = "event";
    for (const folder of folders) {
      const path = `${parent}.${folder}`;
      ensureFolder(path);
      folderChildren.get(parent)?.add(path);
      parent = path;
    }
    eventChildren.get(parent)?.push(item);
  }

  for (const [, list] of eventChildren) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const walk = (path: string): DataNode[] => {
    const childFolders = Array.from(folderChildren.get(path) || []).sort((a, b) => a.localeCompare(b));
    const folderNodes: DataNode[] = childFolders.map((folderPath) => ({
      key: `folder:${folderPath}`,
      title: (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <FolderTree size={15} />
          <Typography variant="body2">{folderPath.split(".").pop() || folderPath}</Typography>
        </Box>
      ),
      children: walk(folderPath)
    }));

    const eventNodes: DataNode[] = (eventChildren.get(path) || []).map((item) => ({
      key: `event:${item.id}`,
      title: (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Zap size={15} />
          <Typography variant="body2">{item.id.split(".").pop() || item.id}</Typography>
          {!!item.label?.trim() && (
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
          )}
        </Box>
      ),
      isLeaf: true
    }));
    return [...folderNodes, ...eventNodes];
  };

  return [{
    key: "category:event",
    title: (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Zap size={15} />
        <Typography variant="subtitle2">Event Actions</Typography>
      </Box>
    ),
    children: walk("event")
  }];
}

function getAssetPathOptions(assets: AssetFrameworkDefinition): AssetPathOption[] {
  const byId = new Map(assets.assets.map((asset) => [asset.id, asset]));
  const getPath = (assetId: string): string => {
    const asset = byId.get(assetId);
    if (!asset) return "";
    const parts = [asset.name];
    let parentId = asset.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId;
    }
    return parts.join(".");
  };
  return assets.assets
    .map((asset) => ({ id: asset.id, path: getPath(asset.id), templateIds: asset.templateIds || [] }))
    .filter((item) => item.path)
    .sort((a, b) => a.path.localeCompare(b.path));
}

function getAttributeTemplateName(assets: AssetFrameworkDefinition, templateId: string): string {
  return assets.attributeTemplates.find((item) => item.id === templateId)?.name || templateId || "Any Template";
}

function getAttributeOptionsForTemplate(assets: AssetFrameworkDefinition, templateId: string): string[] {
  const assetOptions = getAssetPathOptions(assets);
  const byAssetId = new Map(assetOptions.map((item) => [item.id, item]));
  const templateById = new Map(assets.attributeTemplates.map((item) => [item.id, item]));
  const result = new Set<string>();

  for (const asset of assets.assets) {
    if (templateId && !(asset.templateIds || []).includes(templateId)) continue;
    const assetPath = byAssetId.get(asset.id)?.path || "";
    if (!assetPath) continue;
    for (const key of Object.keys(asset.attributes || {})) result.add(`${assetPath}.${key}`);
    for (const currentTemplateId of asset.templateIds || []) {
      if (templateId && currentTemplateId !== templateId) continue;
      const template = templateById.get(currentTemplateId);
      if (!template) continue;
      for (const attr of template.attributes || []) {
        if (attr.enabled === false) continue;
        result.add(`${assetPath}.${attr.name}`);
      }
    }
  }
  return Array.from(result).sort((a, b) => a.localeCompare(b));
}

function collectTemplateVariables(template: EventTemplateDefinition | undefined): string[] {
  if (!template) return [];
  if ((template.bindings || []).length > 0) {
    return (template.bindings || []).map((item) => item.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
  const keys = new Set<string>();
  (template.eventPathBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.closePatternBuilder || []).forEach((segment) => {
    if (segment.type === "variable" && segment.value) keys.add(segment.value);
  });
  (template.assetPaths || []).forEach((item) => {
    if (item.source === "variable" && item.key) keys.add(item.key);
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
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function defaultBindingForVariable(name: string): EventActionBindingDefinition {
  if (name.toLowerCase().includes("asset")) return { source: "asset", attributePath: "" };
  if (name.toLowerCase().includes("time") || name.toLowerCase() === "timestamp") return { source: "msg_path", attributePath: "ts" };
  return { source: "msg_path", attributePath: `payload.${name}` };
}

function getVariableAssetTemplateMap(template: EventTemplateDefinition | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of template?.bindings || []) {
    if (item.source !== "asset" || !item.name) continue;
    result[item.name] = item.templateId || "";
  }
  for (const item of template?.assetPaths || []) {
    if (item.source !== "variable" || !item.key) continue;
    result[item.key] = item.templateId || "";
  }
  return result;
}

export default function EventDesignerManager({
  eventActions,
  eventTemplates,
  assets,
  selectedEventActionId,
  selectedEventTemplateId,
  onSelectEventAction,
  onSelectEventTemplate,
  onAddEventAction,
  onAddEventActionFromTemplate,
  onUpdateEventAction,
  onRenameEventAction,
  onRemoveEventAction,
  onAddEventTemplate,
  onAddPresetTemplate,
  onRemoveEventTemplate,
  onUpdateEventTemplate
}: EventDesignerManagerProps) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedTreeKey, setSelectedTreeKey] = useState("");
  const hierarchyTree = useMemo(() => buildEventHierarchyTree(eventActions, search), [eventActions, search]);
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(["category:event"]);

  const assetOptions = useMemo(() => getAssetPathOptions(assets), [assets]);
  const selectedEventAction = eventActions.find((item) => item.id === selectedEventActionId) || null;
  const selectedTemplate = eventTemplates.find((item) => item.id === selectedEventAction?.templateId) || null;
  const selectedTemplateForWizard = eventTemplates.find((item) => item.id === selectedEventTemplateId) || null;
  const templateVariables = useMemo(() => collectTemplateVariables(selectedTemplate || undefined), [selectedTemplate]);
  const variableTemplateMap = useMemo(() => getVariableAssetTemplateMap(selectedTemplate), [selectedTemplate]);

  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Paper variant="outlined" sx={{ px: 1, pt: 1 }}>
        <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
          <Tab label="Event Actions" />
          <Tab label="Event Templates" />
        </Tabs>
      </Paper>

      {tab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75 }}>
            <Box sx={{ display: "grid", gap: 0.5 }}>
              <Button variant="outlined" onClick={onAddEventAction}>
                Add Blank Event Action
              </Button>
              <Button
                variant="outlined"
                disabled={!selectedTemplateForWizard}
                onClick={() => {
                  if (!selectedTemplateForWizard) return;
                  onAddEventActionFromTemplate(selectedTemplateForWizard.id);
                  setTab(0);
                }}
              >
                Add Event Action From Selected Template
              </Button>
            </Box>
            <TextField size="small" label="Search Event Action" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Box sx={{ ...scrollBothOverflowSx, maxHeight: "calc(100vh - 240px)" }}>
              <Tree
                treeData={hierarchyTree}
                expandedKeys={expandedKeys}
                selectedKeys={selectedEventActionId ? [`event:${selectedEventActionId}`] : selectedTreeKey ? [selectedTreeKey] : []}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  if (!key) return;
                  setSelectedTreeKey(key);
                  if (key.startsWith("event:")) onSelectEventAction(key.slice("event:".length));
                }}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedEventAction && <Typography variant="body2" color="text.secondary">Select an event action from the left panel.</Typography>}
            {selectedEventAction && (
              <Box sx={{ display: "grid", gap: 1 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="h6">Event Action Detail</Typography>
                  <Button color="error" variant="outlined" onClick={() => onRemoveEventAction(selectedEventAction.id)}>
                    Remove
                  </Button>
                </Box>
                <Paper variant="outlined" sx={{ p: 1, backgroundColor: "#f0fdf4" }}>
                  <Typography variant="subtitle2">Event Flow Nodes</Typography>
                  <Typography variant="caption" color="text.secondary">
                    This event action creates two flow nodes automatically. Wire any trigger or script node into these nodes.
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: "monospace", mt: 0.75 }}>
                    open node: `event.open.{selectedEventAction.id}`
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                    close node: `event.close.{selectedEventAction.id}`
                  </Typography>
                </Paper>
                <TextField label="Event Action ID" value={selectedEventAction.id} onChange={(e) => onRenameEventAction(selectedEventAction.id, e.target.value)} helperText="Example: Taiyo1.Events.JobActivity" />
                <TextField label="Label" value={selectedEventAction.label ?? ""} onChange={(e) => onUpdateEventAction(selectedEventAction.id, { label: e.target.value })} />
                <TextField label="Description" value={selectedEventAction.description ?? ""} onChange={(e) => onUpdateEventAction(selectedEventAction.id, { description: e.target.value })} />
                <FormControlLabel control={<Switch checked={selectedEventAction.enabled !== false} onChange={(_e, checked) => onUpdateEventAction(selectedEventAction.id, { enabled: checked })} />} label="Event Action Enabled" />
                <FormControl size="small" fullWidth>
                  <Select value={selectedEventAction.templateId ?? ""} onChange={(e) => onUpdateEventAction(selectedEventAction.id, { templateId: e.target.value || undefined })}>
                    <MenuItem value="">(Select Event Template)</MenuItem>
                    {eventTemplates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>{template.id}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {selectedTemplate && (
                  <Paper variant="outlined" sx={{ p: 1, backgroundColor: "#eff6ff" }}>
                    <Typography variant="subtitle2">Template Preview</Typography>
                    <Typography variant="caption" color="text.secondary">open path: {selectedTemplate.eventPathTemplate}</Typography>
                    <br />
                    <Typography variant="caption" color="text.secondary">close pattern: {selectedTemplate.closePatternTemplate || selectedTemplate.eventPathTemplate}</Typography>
                  </Paper>
                )}
                <TextField label="Open Notes" value={selectedEventAction.openNotes ?? ""} onChange={(e) => onUpdateEventAction(selectedEventAction.id, { openNotes: e.target.value })} helperText='Optional. Supports placeholders like "{workOrder}"' />
                <TextField label="Close Notes" value={selectedEventAction.closeNotes ?? ""} onChange={(e) => onUpdateEventAction(selectedEventAction.id, { closeNotes: e.target.value })} helperText='Optional. Supports placeholders like "{workOrder}"' />
                <Box sx={{ display: "grid", gap: 0.75 }}>
                  <Typography variant="subtitle2">Required Bindings</Typography>
                  {!selectedTemplate && <Typography variant="caption" color="text.secondary">Pick an event template first. Required variables will appear here automatically from the template placeholders.</Typography>}
                  {selectedTemplate && templateVariables.length === 0 && <Typography variant="caption" color="text.secondary">This template has no variable placeholder.</Typography>}
                  {selectedTemplate && templateVariables.length > 0 && (
                    <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                      <Table size="small" sx={{ minWidth: 1120 }} stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ minWidth: 180 }}>Variable</TableCell>
                            <TableCell sx={{ minWidth: 170 }}>Source</TableCell>
                            <TableCell sx={{ minWidth: 420 }}>Value</TableCell>
                            <TableCell sx={{ minWidth: 220 }}>Template Info</TableCell>
                            <TableCell sx={{ minWidth: 100 }}>Action</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {templateVariables.map((name) => {
                            const binding = selectedEventAction.bindings?.[name] || defaultBindingForVariable(name);
                            const templateBinding = (selectedTemplate.bindings || []).find((item) => item.name === name);
                            const effectiveSource = templateBinding?.source || binding.source;
                            const templateId = variableTemplateMap[name] || "";
                            const templateName = getAttributeTemplateName(assets, templateId);
                            const filteredAssetOptions = assetOptions.filter((item) => !templateId || item.templateIds.includes(templateId)).map((item) => item.path);
                            const attributeOptions = templateId ? getAttributeOptionsForTemplate(assets, templateId) : getAttributeOptionsForTemplate(assets, "");
                            return (
                              <TableRow key={name}>
                                <TableCell>
                                  <TextField size="small" fullWidth value={name} disabled />
                                </TableCell>
                                <TableCell>
                                  <TextField size="small" fullWidth value={effectiveSource} disabled />
                                </TableCell>
                                <TableCell>
                                  {effectiveSource === "asset" && (
                                    <Autocomplete
                                      options={filteredAssetOptions}
                                      value={binding.attributePath ?? ""}
                                      onChange={(_e, value) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, attributePath: String(value || "") }
                                          }
                                        })
                                      }
                                      renderInput={(params) => <TextField {...params} size="small" placeholder="Select asset path" />}
                                    />
                                  )}
                                  {effectiveSource === "attribute" && (
                                    <Autocomplete
                                      options={attributeOptions}
                                      value={binding.attributePath ?? ""}
                                      onChange={(_e, value) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, attributePath: String(value || "") }
                                          }
                                        })
                                      }
                                      renderInput={(params) => <TextField {...params} size="small" placeholder="Select attribute path" />}
                                    />
                                  )}
                                  {effectiveSource === "msg_path" && (
                                    <TextField
                                      size="small"
                                      fullWidth
                                      value={binding.attributePath ?? ""}
                                      onChange={(e) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, attributePath: e.target.value }
                                          }
                                        })
                                      }
                                      placeholder='payload.workOrder / ts'
                                    />
                                  )}
                                  {effectiveSource === "static_string" && (
                                    <TextField
                                      size="small"
                                      fullWidth
                                      value={String(binding.staticValue ?? templateBinding?.defaultValue ?? "")}
                                      onChange={(e) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, staticValue: e.target.value }
                                          }
                                        })
                                      }
                                    />
                                  )}
                                  {effectiveSource === "static_number" && (
                                    <TextField
                                      size="small"
                                      type="number"
                                      fullWidth
                                      value={Number(binding.staticValue ?? templateBinding?.defaultValue ?? 0)}
                                      onChange={(e) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, staticValue: Number(e.target.value) }
                                          }
                                        })
                                      }
                                    />
                                  )}
                                  {effectiveSource === "static_boolean" && (
                                    <FormControl size="small" fullWidth>
                                      <Select
                                        value={String((binding.staticValue ?? templateBinding?.defaultValue) === true)}
                                        onChange={(e) =>
                                          onUpdateEventAction(selectedEventAction.id, {
                                            bindings: {
                                              ...(selectedEventAction.bindings || {}),
                                              [name]: { ...binding, source: effectiveSource, staticValue: e.target.value === "true" }
                                            }
                                          })
                                        }
                                      >
                                        <MenuItem value="true">true</MenuItem>
                                        <MenuItem value="false">false</MenuItem>
                                      </Select>
                                    </FormControl>
                                  )}
                                  {effectiveSource === "static_array" && (
                                    <TextField
                                      size="small"
                                      fullWidth
                                      value={typeof binding.staticValue === "string" ? binding.staticValue : JSON.stringify(binding.staticValue ?? templateBinding?.defaultValue ?? [])}
                                      onChange={(e) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, staticValue: e.target.value }
                                          }
                                        })
                                      }
                                      placeholder='[1,2,3]'
                                    />
                                  )}
                                  {effectiveSource === "static_object" && (
                                    <TextField
                                      size="small"
                                      fullWidth
                                      value={typeof binding.staticValue === "string" ? binding.staticValue : JSON.stringify(binding.staticValue ?? templateBinding?.defaultValue ?? {})}
                                      onChange={(e) =>
                                        onUpdateEventAction(selectedEventAction.id, {
                                          bindings: {
                                            ...(selectedEventAction.bindings || {}),
                                            [name]: { ...binding, source: effectiveSource, staticValue: e.target.value }
                                          }
                                        })
                                      }
                                      placeholder='{\"key\":\"value\"}'
                                    />
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Typography variant="caption" color="text.secondary">
                                    {templateId ? `Asset Template: ${templateName}` : templateBinding ? "Source locked by template" : "General binding"}
                                  </Typography>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() =>
                                      onUpdateEventAction(selectedEventAction.id, {
                                        bindings: {
                                          ...(selectedEventAction.bindings || {}),
                                          [name]: { ...defaultBindingForVariable(name), source: effectiveSource, staticValue: templateBinding?.defaultValue }
                                        }
                                      })
                                    }
                                  >
                                    Reset
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </Box>
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {tab === 1 && (
        <EventTemplateManager
          assets={assets}
          eventTemplates={eventTemplates}
          selectedTemplateId={selectedEventTemplateId}
          onSelectTemplate={onSelectEventTemplate}
          onAddTemplate={onAddEventTemplate}
          onAddPresetTemplate={onAddPresetTemplate}
          onRemoveTemplate={onRemoveEventTemplate}
          onUpdateTemplate={onUpdateEventTemplate}
        />
      )}
    </Box>
  );
}
