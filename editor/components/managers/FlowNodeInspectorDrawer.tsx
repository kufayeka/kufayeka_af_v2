import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  MenuItem,
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
import type { SelectChangeEvent } from "@mui/material/Select";
import { X } from "lucide-react";
import StableMonaco from "../common/StableMonaco";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type {
  AssetFrameworkDefinition,
  EventActionBindingDefinition,
  EventTemplateDefinition,
  FlowNodeDefinition,
  ScriptTemplateDefinition,
  ScriptVariableBindingDefinition
} from "../../types/program";

type InspectorTarget =
  | { kind: "action"; id: string }
  | { kind: "event"; id: string }
  | null;

interface FlowNodeInspectorDrawerProps {
  open: boolean;
  target: InspectorTarget;
  nodes: FlowNodeDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  eventTemplates: EventTemplateDefinition[];
  assets: AssetFrameworkDefinition;
  onClose: () => void;
  onRenameNode: (oldId: string, newId: string) => void;
  onUpdateNode: (id: string, patch: Partial<FlowNodeDefinition>) => void;
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function getAssetPathOptions(assets: AssetFrameworkDefinition): string[] {
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
    .map((asset) => getPath(asset.id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function getAssetAttributeOptions(assets: AssetFrameworkDefinition): string[] {
  const byId = new Map(assets.assets.map((asset) => [asset.id, asset]));
  const templateById = new Map(assets.attributeTemplates.map((template) => [template.id, template]));

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

  const options = new Set<string>();
  for (const asset of assets.assets) {
    const basePath = getPath(asset.id);
    if (!basePath) continue;
    for (const key of Object.keys(asset.attributes || {})) {
      options.add(`${basePath}.${key}`);
    }
    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attr of template.attributes || []) {
        if (attr.enabled === false) continue;
        options.add(`${basePath}.${attr.name}`);
      }
    }
  }

  return Array.from(options).sort((a, b) => a.localeCompare(b));
}

function defaultEventBindingForVariable(name: string): EventActionBindingDefinition {
  if (name.toLowerCase().includes("asset")) return { source: "asset", attributePath: "" };
  if (name.toLowerCase().includes("time") || name.toLowerCase() === "timestamp") {
    return { source: "msg_path", attributePath: "ts" };
  }
  return { source: "msg_path", attributePath: `payload.${name}` };
}

function collectEventTemplateVariables(template: EventTemplateDefinition | undefined): string[] {
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
  Object.values(template.contextBindings || {}).forEach((binding) => {
    if (binding.source === "variable" && binding.key) keys.add(binding.key);
  });
  (template.contextFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  (template.captureFields || []).forEach((field) => {
    if (field.source === "variable" && field.variableKey) keys.add(field.variableKey);
  });
  if (template.timeSource?.open?.source === "variable" && template.timeSource.open.key) keys.add(template.timeSource.open.key);
  if (template.timeSource?.close?.source === "variable" && template.timeSource.close.key) keys.add(template.timeSource.close.key);
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function ScriptNodeInspector({
  node,
  scriptTemplates,
  assets,
  onRenameNode,
  onUpdateNode
}: {
  node: FlowNodeDefinition;
  scriptTemplates: ScriptTemplateDefinition[];
  assets: AssetFrameworkDefinition;
  onRenameNode: (oldId: string, newId: string) => void;
  onUpdateNode: (id: string, patch: Partial<FlowNodeDefinition>) => void;
}) {
  const selectedTemplate = scriptTemplates.find((item) => item.id === node.templateId);
  const assetPaths = useMemo(() => getAssetPathOptions(assets), [assets]);
  const assetAttributePaths = useMemo(() => getAssetAttributeOptions(assets), [assets]);
  const config = (node.config || {}) as Record<string, unknown>;
  const templateBindingOverrides = (config.templateBindingOverrides || {}) as Record<string, ScriptVariableBindingDefinition>;
  const scriptValue = typeof config.script === "string" ? config.script : "";
  const description = typeof config.description === "string" ? config.description : "";
  const [scriptDraft, setScriptDraft] = useState(scriptValue);
  const scriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setScriptDraft(scriptValue);
  }, [node.id, node.templateId, scriptValue]);

  useEffect(() => {
    return () => {
      if (scriptTimerRef.current) clearTimeout(scriptTimerRef.current);
    };
  }, []);

  const bindingNames = useMemo(
    () =>
      (selectedTemplate?.variableBindings || [])
        .map((binding) => String(binding.name || "").trim())
        .filter(Boolean),
    [selectedTemplate?.variableBindings]
  );

  const scheduleSaveScript = (next: string) => {
    if (scriptTimerRef.current) clearTimeout(scriptTimerRef.current);
    scriptTimerRef.current = setTimeout(() => {
      onUpdateNode(node.id, {
        config: {
          ...config,
          script: next
        }
      });
      scriptTimerRef.current = null;
    }, 500);
  };

  return (
    <Box sx={{ display: "grid", gap: 1.25 }}>
      <Typography variant="h6">Action Detail</Typography>
      <TextField label="Node ID" value={node.id} onChange={(e) => onRenameNode(node.id, e.target.value)} />
      <TextField label="Label" value={node.label ?? ""} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })} />
      <TextField
        label="Description"
        value={description}
        onChange={(e) =>
          onUpdateNode(node.id, {
            config: {
              ...config,
              description: e.target.value
            }
          })
        }
      />
      <FormControlLabel
        control={<Switch checked={node.enabled !== false} onChange={(_e, checked) => onUpdateNode(node.id, { enabled: checked })} />}
        label="Action Enabled"
      />
      <FormControl size="small" fullWidth>
        <Select
          value={node.templateId ?? ""}
          onChange={(e: SelectChangeEvent<string>) => onUpdateNode(node.id, { templateId: e.target.value || undefined })}
        >
          <MenuItem value="">(None)</MenuItem>
          {scriptTemplates.map((template) => (
            <MenuItem key={template.id} value={template.id}>
              {template.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {selectedTemplate && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Typography variant="subtitle2">Template Bindings</Typography>
          <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 160 }}>Binding</TableCell>
                  <TableCell sx={{ minWidth: 130 }}>Source</TableCell>
                  <TableCell sx={{ minWidth: 320 }}>Value</TableCell>
                  <TableCell sx={{ minWidth: 100 }}>Override</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(selectedTemplate.variableBindings || []).map((binding) => {
                  const canOverride = binding.allowOverride === true;
                  const currentOverride = templateBindingOverrides?.[binding.name];
                  const effective = canOverride && currentOverride ? currentOverride : binding;

                  const commitOverride = (patch: Partial<ScriptVariableBindingDefinition>) => {
                    onUpdateNode(node.id, {
                      config: {
                        ...config,
                        templateBindingOverrides: {
                          ...templateBindingOverrides,
                          [binding.name]: {
                            ...binding,
                            ...currentOverride,
                            ...patch,
                            name: binding.name
                          }
                        }
                      }
                    });
                  };

                  return (
                    <TableRow key={binding.name}>
                      <TableCell>{binding.name}</TableCell>
                      <TableCell>{binding.source}</TableCell>
                      <TableCell>
                        {effective.source === "attribute" || effective.source === "asset" ? (
                          <Autocomplete
                            freeSolo
                            options={effective.source === "asset" ? assetPaths : assetAttributePaths}
                            value={effective.attributePath ?? ""}
                            disabled={!canOverride}
                            onInputChange={(_e, value) => {
                              if (!canOverride) return;
                              commitOverride({
                                source: effective.source,
                                attributePath: value
                              });
                            }}
                            renderInput={(params) => <TextField {...params} size="small" />}
                          />
                        ) : effective.source === "static_boolean" ? (
                          <Select
                            size="small"
                            fullWidth
                            disabled={!canOverride}
                            value={String(effective.staticValue === true)}
                            onChange={(e: SelectChangeEvent<string>) => {
                              if (!canOverride) return;
                              commitOverride({
                                source: "static_boolean",
                                staticValue: e.target.value === "true"
                              });
                            }}
                          >
                            <MenuItem value="true">true</MenuItem>
                            <MenuItem value="false">false</MenuItem>
                          </Select>
                        ) : effective.source === "static_number" ? (
                          <TextField
                            size="small"
                            type="number"
                            fullWidth
                            disabled={!canOverride}
                            value={Number(effective.staticValue ?? 0)}
                            onChange={(e) => {
                              if (!canOverride) return;
                              commitOverride({
                                source: "static_number",
                                staticValue: Number(e.target.value)
                              });
                            }}
                          />
                        ) : (
                          <TextField
                            size="small"
                            fullWidth
                            disabled={!canOverride}
                            value={String(effective.staticValue ?? "")}
                            onChange={(e) => {
                              if (!canOverride) return;
                              commitOverride({
                                source: effective.source || "static_string",
                                staticValue: e.target.value
                              });
                            }}
                          />
                        )}
                      </TableCell>
                      <TableCell>{canOverride ? "Yes" : "No"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Typography variant="subtitle2">Script</Typography>
      <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
        <StableMonaco
          path={`flow-node-action:${node.id}:${node.templateId || "none"}`}
          height="42vh"
          language="javascript"
          profile="script"
          bindingNames={bindingNames}
          value={scriptDraft}
          readOnly={Boolean(node.templateId)}
          onChangeText={(next) => {
            if (node.templateId) return;
            setScriptDraft(next);
            scheduleSaveScript(next);
          }}
        />
      </Box>
      {node.templateId && (
        <Typography variant="caption" color="text.secondary">
          Script is read-only because this node uses a template.
        </Typography>
      )}
    </Box>
  );
}

function EventNodeInspector({
  openNode,
  closeNode,
  eventTemplates,
  assets,
  onRenameNode,
  onUpdateNode
}: {
  openNode: FlowNodeDefinition;
  closeNode: FlowNodeDefinition;
  eventTemplates: EventTemplateDefinition[];
  assets: AssetFrameworkDefinition;
  onRenameNode: (oldId: string, newId: string) => void;
  onUpdateNode: (id: string, patch: Partial<FlowNodeDefinition>) => void;
}) {
  const assetPaths = useMemo(() => getAssetPathOptions(assets), [assets]);
  const assetAttributePaths = useMemo(() => getAssetAttributeOptions(assets), [assets]);
  const openConfig = (openNode.config || {}) as Record<string, unknown>;
  const closeConfig = (closeNode.config || {}) as Record<string, unknown>;
  const selectedTemplate = eventTemplates.find((item) => item.id === (openNode.templateId || closeNode.templateId));
  const templateVariables = useMemo(() => collectEventTemplateVariables(selectedTemplate), [selectedTemplate]);

  return (
    <Box sx={{ display: "grid", gap: 1.25 }}>
      <Typography variant="h6">Event Action Detail</Typography>
      <TextField
        label="Open Node ID"
        value={openNode.id}
        onChange={(e) => onRenameNode(openNode.id, e.target.value)}
      />
      <TextField
        label="Close Node ID"
        value={closeNode.id}
        onChange={(e) => onRenameNode(closeNode.id, e.target.value)}
      />
      <TextField label="Label" value={openNode.label ?? ""} onChange={(e) => {
        onUpdateNode(openNode.id, { label: `OPEN ${e.target.value}` });
        onUpdateNode(closeNode.id, { label: `CLOSE ${e.target.value}` });
      }} />
      <TextField
        label="Description"
        value={String(openConfig.description ?? "")}
        onChange={(e) => {
          onUpdateNode(openNode.id, { config: { ...openConfig, description: e.target.value } });
          onUpdateNode(closeNode.id, { config: { ...closeConfig, description: e.target.value } });
        }}
      />
      <FormControlLabel
        control={<Switch checked={openNode.enabled !== false} onChange={(_e, checked) => {
          onUpdateNode(openNode.id, { enabled: checked });
          onUpdateNode(closeNode.id, { enabled: checked });
        }} />}
        label="Event Action Enabled"
      />
      <FormControl size="small" fullWidth>
        <Select
          value={openNode.templateId ?? ""}
          onChange={(e) => {
            onUpdateNode(openNode.id, { templateId: e.target.value || undefined });
            onUpdateNode(closeNode.id, { templateId: e.target.value || undefined });
          }}
        >
          <MenuItem value="">(Select Event Template)</MenuItem>
          {eventTemplates.map((template) => (
            <MenuItem key={template.id} value={template.id}>
              {template.id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField label="Open Notes" value={String(openConfig.openNotes ?? "")} onChange={(e) => onUpdateNode(openNode.id, { config: { ...openConfig, openNotes: e.target.value } })} />
      <TextField label="Close Notes" value={String(closeConfig.closeNotes ?? "")} onChange={(e) => onUpdateNode(closeNode.id, { config: { ...closeConfig, closeNotes: e.target.value } })} />

      {selectedTemplate && (
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Typography variant="subtitle2">Bindings</Typography>
          <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 170 }}>Variable</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>Source</TableCell>
                  <TableCell sx={{ minWidth: 320 }}>Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templateVariables.map((name) => {
                  const openBindings = ((openConfig.bindings || {}) as Record<string, EventActionBindingDefinition>);
                  const closeBindings = ((closeConfig.bindings || {}) as Record<string, EventActionBindingDefinition>);
                  const binding = openBindings?.[name] || closeBindings?.[name] || defaultEventBindingForVariable(name);
                  const effectiveSource = binding.source;

                  const commitBinding = (patch: Partial<EventActionBindingDefinition>) => {
                    const nextBindings = {
                      ...openBindings,
                      [name]: {
                        ...binding,
                        ...patch
                      }
                    };
                    onUpdateNode(openNode.id, {
                      config: {
                        ...openConfig,
                        bindings: nextBindings
                      }
                    });
                    onUpdateNode(closeNode.id, {
                      config: {
                        ...closeConfig,
                        bindings: nextBindings
                      }
                    });
                  };

                  return (
                    <TableRow key={name}>
                      <TableCell>{name}</TableCell>
                      <TableCell>
                        <Select
                          size="small"
                          fullWidth
                          value={effectiveSource}
                          onChange={(e) => commitBinding({ source: e.target.value as EventActionBindingDefinition["source"] })}
                        >
                          <MenuItem value="asset">asset</MenuItem>
                          <MenuItem value="attribute">attribute</MenuItem>
                          <MenuItem value="msg_path">msg_path</MenuItem>
                          <MenuItem value="static_string">static_string</MenuItem>
                          <MenuItem value="static_number">static_number</MenuItem>
                          <MenuItem value="static_boolean">static_boolean</MenuItem>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {effectiveSource === "asset" || effectiveSource === "attribute" ? (
                          <Autocomplete
                            freeSolo
                            options={effectiveSource === "asset" ? assetPaths : assetAttributePaths}
                            value={binding.attributePath ?? ""}
                            onInputChange={(_e, value) => commitBinding({ attributePath: value })}
                            renderInput={(params) => <TextField {...params} size="small" />}
                          />
                        ) : effectiveSource === "static_boolean" ? (
                          <Select
                            size="small"
                            fullWidth
                            value={String(binding.staticValue === true)}
                            onChange={(e) => commitBinding({ staticValue: e.target.value === "true" })}
                          >
                            <MenuItem value="true">true</MenuItem>
                            <MenuItem value="false">false</MenuItem>
                          </Select>
                        ) : effectiveSource === "static_number" ? (
                          <TextField
                            size="small"
                            type="number"
                            fullWidth
                            value={Number(binding.staticValue ?? 0)}
                            onChange={(e) => commitBinding({ staticValue: Number(e.target.value) })}
                          />
                        ) : (
                          <TextField
                            size="small"
                            fullWidth
                            value={effectiveSource === "msg_path" ? String(binding.attributePath ?? "") : String(binding.staticValue ?? "")}
                            onChange={(e) => {
                              if (effectiveSource === "msg_path") {
                                commitBinding({ attributePath: e.target.value });
                              } else {
                                commitBinding({ staticValue: effectiveSource === "static_object" || effectiveSource === "static_array" ? parseMaybeJson(e.target.value) : e.target.value });
                              }
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}

export default function FlowNodeInspectorDrawer(props: FlowNodeInspectorDrawerProps) {
  const {
    open,
    target,
    nodes,
    scriptTemplates,
    eventTemplates,
    assets,
    onClose,
    onRenameNode,
    onUpdateNode
  } = props;

  const actionNode = target?.kind === "action" ? nodes.find((item) => item.id === target.id) || null : null;
  const openNode = target?.kind === "event" ? nodes.find((item) => item.kind === "event_open" && item.refId === target.id) || null : null;
  const closeNode = target?.kind === "event" ? nodes.find((item) => item.kind === "event_close" && item.refId === target.id) || null : null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: "100%", md: "70vw" },
          maxWidth: 1200
        }
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Node Inspector
        </Typography>
        <IconButton onClick={onClose}>
          <X size={18} />
        </IconButton>
      </Box>
      <Box sx={{ p: 1.5, overflow: "auto", ...scrollBothOverflowSx }}>
        {!target && <Typography variant="body2" color="text.secondary">Select a node.</Typography>}
        {target?.kind === "action" && actionNode && (
          <ScriptNodeInspector
            node={actionNode}
            scriptTemplates={scriptTemplates}
            assets={assets}
            onRenameNode={onRenameNode}
            onUpdateNode={onUpdateNode}
          />
        )}
        {target?.kind === "event" && openNode && closeNode && (
          <EventNodeInspector
            openNode={openNode}
            closeNode={closeNode}
            eventTemplates={eventTemplates}
            assets={assets}
            onRenameNode={onRenameNode}
            onUpdateNode={onUpdateNode}
          />
        )}
      </Box>
    </Drawer>
  );
}
