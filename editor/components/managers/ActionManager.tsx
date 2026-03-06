import { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogContent,
  FormControl,
  FormControlLabel,
  InputLabel,
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
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { FileCode2, FolderTree } from "lucide-react";
import StableMonaco from "../common/StableMonaco";
import type {
  ActionDefinition,
  AssetFrameworkDefinition,
  ScriptBindingSource,
  ScriptVariableBindingDefinition,
  ScriptTemplateDefinition
} from "../../types/program";

interface ActionManagerProps {
  actions: ActionDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  assets: AssetFrameworkDefinition;
  selectedActionId: string;
  onSelectAction: (id: string) => void;
  onAddAction: (parentPath?: string) => void;
  onDuplicateAction: (id: string) => void;
  onRemoveAction: (id: string) => void;
  onRenameAction: (oldId: string, newId: string) => void;
  onUpdateAction: (id: string, patch: Partial<ActionDefinition>) => void;
  onAddScriptTemplate: () => void;
  onRemoveScriptTemplate: (id: string) => void;
  onUpdateScriptTemplate: (id: string, patch: Partial<ScriptTemplateDefinition>) => void;
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

function defaultBinding(): ScriptVariableBindingDefinition {
  return {
    name: "binding_1",
    source: "static_string",
    staticValue: "",
    attributePath: "",
    allowOverride: false
  };
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
    .filter((path) => path.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function getAssetAttributeOptions(assets: AssetFrameworkDefinition): Array<{
  kind: "attribute";
  path: string;
  assetId: string;
  attributeName: string;
  value: unknown;
  type: string;
  unit: string;
}> {
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

  const options: Array<{
    kind: "attribute";
    path: string;
    assetId: string;
    attributeName: string;
    value: unknown;
    type: string;
    unit: string;
  }> = [];
  for (const asset of assets.assets) {
    const basePath = getPath(asset.id);
    const attrMap = new Map<string, { value: unknown; type: string; unit: string }>();
    for (const templateId of asset.templateIds) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attr of template.attributes) {
        if (attr.enabled === false) continue;
        if (!attrMap.has(attr.name)) {
          attrMap.set(attr.name, {
            value:
              (attr as { default?: unknown; defaultValue?: unknown }).default ??
              (attr as { defaultValue?: unknown }).defaultValue,
            type: String((attr as { valueType?: string; type?: string }).valueType || (attr as { type?: string }).type || "string"),
            unit: String(attr.unit || "")
          });
        }
      }
    }
    for (const [attrName, attr] of Object.entries(asset.attributes || {})) {
      const typed = attr as { value?: unknown };
      const prev = attrMap.get(attrName);
      attrMap.set(attrName, {
        value: Object.prototype.hasOwnProperty.call(typed, "value") ? typed.value : typed,
        type: prev?.type || "string",
        unit: prev?.unit || ""
      });
    }
    for (const [attributeName, attr] of attrMap.entries()) {
      options.push({
        kind: "attribute",
        path: `${basePath}.${attributeName}`,
        assetId: asset.id,
        attributeName,
        value: attr.value,
        type: attr.type,
        unit: attr.unit
      });
    }
  }

  options.sort((a, b) => a.path.localeCompare(b.path));
  return options;
}

function resolveAttributePath(
  path: string,
  options: Array<{
    kind: "attribute";
    path: string;
    assetId: string;
    attributeName: string;
    value: unknown;
    type: string;
    unit: string;
  }>
) {
  const found = options.find((item) => item.path === path);
  return found?.path || path;
}

function resolveAssetPath(path: string, options: string[]) {
  const found = options.find((item) => item === path);
  return found || path;
}

function buildHierarchyTree(actions: ActionDefinition[], search: string): DataNode[] {
  const keyword = search.trim().toLowerCase();
  const filteredActions = keyword
    ? actions.filter((action) =>
        `${action.id} ${action.label ?? ""} ${action.description ?? ""} ${action.type}`.toLowerCase().includes(keyword)
      )
    : actions;

  const folderChildren = new Map<string, Set<string>>();
  const actionChildren = new Map<string, ActionDefinition[]>();
  const ensureFolder = (path: string) => {
    if (!folderChildren.has(path)) folderChildren.set(path, new Set<string>());
    if (!actionChildren.has(path)) actionChildren.set(path, []);
  };

  ensureFolder("");
  for (const action of filteredActions) {
    const segments = action.id.split(".").filter(Boolean);
    const folders = segments.slice(0, -1);
    let parent = "";
    ensureFolder(parent);
    for (const folder of folders) {
      const path = parent ? `${parent}.${folder}` : folder;
      ensureFolder(path);
      folderChildren.get(parent)?.add(path);
      parent = path;
    }
    actionChildren.get(parent)?.push(action);
  }

  for (const [, list] of actionChildren) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const walk = (path: string): DataNode[] => {
    const childFolders = Array.from(folderChildren.get(path) || []).sort((a, b) => a.localeCompare(b));
    const folderNodes: DataNode[] = childFolders.map((folderPath) => {
      const label = folderPath.split(".").pop() || folderPath;
      return {
        key: `folder:${folderPath}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <FolderTree size={15} />
            <Typography variant="body2">{label}</Typography>
          </Box>
        ),
        children: walk(folderPath)
      };
    });

    const actionNodes: DataNode[] = (actionChildren.get(path) || []).map((action) => ({
      key: `action:${action.id}`,
      title: (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <FileCode2 size={15} />
          <Typography variant="body2">{action.id.split(".").pop() || action.id}</Typography>
          {!!action.label?.trim() && (
            <Typography variant="caption" color="text.secondary">
              {action.label}
            </Typography>
          )}
        </Box>
      ),
      isLeaf: true
    }));

    return [...folderNodes, ...actionNodes];
  };

  return walk("");
}

function getTemplateScriptForAction(
  action: ActionDefinition,
  scriptTemplates: ScriptTemplateDefinition[]
): string {
  if (!action.templateId) return action.script;
  const template = scriptTemplates.find((item) => item.id === action.templateId);
  return template?.script ?? action.script;
}

export default function ActionManager({
  actions,
  scriptTemplates,
  assets,
  selectedActionId,
  onSelectAction,
  onAddAction,
  onDuplicateAction,
  onRemoveAction,
  onRenameAction,
  onUpdateAction,
  onAddScriptTemplate,
  onRemoveScriptTemplate,
  onUpdateScriptTemplate
}: ActionManagerProps) {
  const [mainTab, setMainTab] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedHierarchyKey, setSelectedHierarchyKey] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [maxEditor, setMaxEditor] = useState(false); // action editor
  const [maxTemplateEditor, setMaxTemplateEditor] = useState(false); // template editor
  const [actionScriptDraft, setActionScriptDraft] = useState("");
  const [templateScriptDraft, setTemplateScriptDraft] = useState("");
  const [monacoFieldDrafts, setMonacoFieldDrafts] = useState<Record<string, string>>({});
  const actionScriptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const templateScriptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const actionTypingUntilRef = useRef(0);
  const actionTypingForIdRef = useRef("");
  const templateTypingUntilRef = useRef(0);
  const templateTypingForIdRef = useRef("");

  const selectedAction = actions.find((item) => item.id === selectedActionId);
  const selectedTemplate = scriptTemplates.find((item) => item.id === selectedTemplateId);
  const selectedActionTemplate = scriptTemplates.find((item) => item.id === selectedAction?.templateId);
  const isTemplateDuplicationBlocked =
    !!selectedActionTemplate && selectedActionTemplate.allowTemplateReuse === false;
  const isActionDuplicationBlocked = selectedAction?.allowTreeDuplicate === false;
  const isSelectedActionDuplicationBlocked = isTemplateDuplicationBlocked || isActionDuplicationBlocked;
  const selectedActionBindingNames = useMemo(
    () =>
      (selectedActionTemplate?.variableBindings || [])
        .map((binding) => String(binding.name || "").trim())
        .filter((name) => name.length > 0),
    [selectedActionTemplate?.variableBindings]
  );
  const selectedTemplateBindingNames = useMemo(
    () =>
      (selectedTemplate?.variableBindings || [])
        .map((binding) => String(binding.name || "").trim())
        .filter((name) => name.length > 0),
    [selectedTemplate?.variableBindings]
  );
  const hierarchyTree = useMemo(() => buildHierarchyTree(actions, search), [actions, search]);
  const assetPaths = useMemo(() => getAssetPathOptions(assets), [assets]);
  const attributeOptions = useMemo(() => getAssetAttributeOptions(assets), [assets]);
  const assetAttributePaths = useMemo(
    () => attributeOptions.map((item) => item.path),
    [attributeOptions]
  );

  const selectedFolderPath = useMemo(() => {
    if (!selectedHierarchyKey.startsWith("folder:")) return "";
    return selectedHierarchyKey.slice("folder:".length);
  }, [selectedHierarchyKey]);

  useEffect(() => {
    if (!selectedAction) {
      setActionScriptDraft("");
      return;
    }
    if (
      Date.now() < actionTypingUntilRef.current &&
      actionTypingForIdRef.current === selectedAction.id
    ) {
      return;
    }
    const next = getTemplateScriptForAction(selectedAction, scriptTemplates);
    setActionScriptDraft((prev) => (prev === next ? prev : next));
  }, [selectedAction?.id, selectedAction?.script, selectedAction?.templateId, scriptTemplates]);

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateScriptDraft("");
      return;
    }
    if (
      Date.now() < templateTypingUntilRef.current &&
      templateTypingForIdRef.current === selectedTemplate.id
    ) {
      return;
    }
    const next = selectedTemplate.script ?? "";
    setTemplateScriptDraft((prev) => (prev === next ? prev : next));
  }, [selectedTemplate?.id, selectedTemplate?.script]);

  useEffect(() => {
    return () => {
      if (actionScriptSaveTimerRef.current) {
        clearTimeout(actionScriptSaveTimerRef.current);
      }
      if (templateScriptSaveTimerRef.current) {
        clearTimeout(templateScriptSaveTimerRef.current);
      }
      for (const timer of Object.values(fieldSaveTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const scheduleSaveActionScript = (actionId: string, script: string) => {
    if (actionScriptSaveTimerRef.current) {
      clearTimeout(actionScriptSaveTimerRef.current);
    }
    actionScriptSaveTimerRef.current = setTimeout(() => {
      onUpdateAction(actionId, { script });
      actionScriptSaveTimerRef.current = null;
    }, 600);
  };

  const scheduleSaveTemplateScript = (templateId: string, script: string) => {
    if (templateScriptSaveTimerRef.current) {
      clearTimeout(templateScriptSaveTimerRef.current);
    }
    templateScriptSaveTimerRef.current = setTimeout(() => {
      onUpdateScriptTemplate(templateId, { script });
      templateScriptSaveTimerRef.current = null;
    }, 600);
  };

  const getMonacoFieldDraft = (fieldKey: string, source: string): string =>
    Object.prototype.hasOwnProperty.call(monacoFieldDrafts, fieldKey)
      ? monacoFieldDrafts[fieldKey]
      : source;

  const scheduleMonacoFieldSave = (
    fieldKey: string,
    next: string,
    commit: (value: string) => void
  ) => {
    setMonacoFieldDrafts((prev) => ({ ...prev, [fieldKey]: next }));
    const existing = fieldSaveTimersRef.current[fieldKey];
    if (existing) clearTimeout(existing);
    fieldSaveTimersRef.current[fieldKey] = setTimeout(() => {
      commit(next);
      delete fieldSaveTimersRef.current[fieldKey];
    }, 600);
  };

  useEffect(() => {
    const nextExpanded: Key[] = [];
    const walk = (nodes: DataNode[]) => {
      for (const node of nodes) {
        const key = String(node.key || "");
        if (key.startsWith("folder:")) nextExpanded.push(node.key as Key);
        if (node.children) walk(node.children as DataNode[]);
      }
    };
    walk(hierarchyTree);
    setExpandedKeys(nextExpanded);
  }, [hierarchyTree]);

  return (
    <Box sx={{ p: 1.25, display: "grid", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 0.5 }}>
        <Tabs value={mainTab} onChange={(_e, value: number) => setMainTab(value)}>
          <Tab label="Action Script" />
          <Tab label="Script Template" />
        </Tabs>
      </Paper>

      {mainTab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
            <Box sx={{ display: "grid", gap: 0.75 }}>
              <Box sx={{ display: "grid", gap: 0.75, gridTemplateColumns: "1fr 1fr" }}>
                <Button fullWidth variant="outlined" onClick={() => onAddAction(selectedFolderPath || undefined)}>
                  Add Action
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  disabled={!selectedAction || isSelectedActionDuplicationBlocked}
                  onClick={() => selectedAction && onDuplicateAction(selectedAction.id)}
                >
                  Duplicate
                </Button>
              </Box>
              <TextField
                size="small"
                label="Search Script Hierarchy"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Box>
            <Box sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx, maxHeight: "calc(100vh - 260px)" }}>
              <Tree
                treeData={hierarchyTree}
                expandedKeys={expandedKeys}
                selectedKeys={
                  selectedActionId
                    ? [`action:${selectedActionId}`]
                    : selectedHierarchyKey
                      ? [selectedHierarchyKey]
                      : []
                }
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  if (!key) return;
                  setSelectedHierarchyKey(key);
                  if (key.startsWith("action:")) {
                    onSelectAction(key.slice("action:".length));
                  }
                }}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedAction && (
              <Typography variant="body2" color="text.secondary">
                Select an action script from the left hierarchy panel.
              </Typography>
            )}
            {selectedAction && (
              <Box sx={{ display: "grid", gap: 1.25 }}>
                <Typography variant="h6">Action Detail</Typography>
                <TextField
                  label="Action Name (Hierarchy Path)"
                  value={selectedAction.id}
                  onChange={(e) => onRenameAction(selectedAction.id, e.target.value)}
                  helperText="Example: areaA.line1.printer.offset.startup"
                />

                <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, maxHeight: 260, ...scrollBothOverflowSx }}>
                  <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell  sx={{ minWidth: 160, backgroundColor: "#d0dfdb" }}>Field</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb" }}>Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Action Label</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={selectedAction.label ?? ""}
                        onChange={(e) => onUpdateAction(selectedAction.id, { label: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell>Description</TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={selectedAction.description ?? ""}
                        onChange={(e) => onUpdateAction(selectedAction.id, { description: e.target.value })}
                      />
                    </TableCell>
                  </TableRow>

                  <TableRow>
                    <TableCell>Script Template</TableCell>
                    <TableCell>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={selectedAction.templateId ?? ""}
                          onChange={(e: SelectChangeEvent<string>) =>
                            onUpdateAction(selectedAction.id, { templateId: e.target.value || undefined })
                          }
                        >
                          <MenuItem value="">(None)</MenuItem>
                          {scriptTemplates.map((template) => (
                            <MenuItem key={template.id} value={template.id}>
                              {template.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

                <Typography variant="caption" color="text.secondary">
                  If a template is selected, the action script follows the template and updates in real time when the template changes.
                </Typography>
                {selectedActionTemplate && (
                  <Box sx={{ display: "grid", gap: 0.75 }}>
                    <Typography variant="subtitle2">Template Bindings</Typography>
                    <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, maxHeight: 260, ...scrollBothOverflowSx }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Binding</TableCell>
                            <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 130 }}>Source</TableCell>
                            <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 320 }}>Value</TableCell>
                            <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Override</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(selectedActionTemplate.variableBindings || []).map((binding) => {
                            const canOverride = binding.allowOverride === true;
                            const currentOverride = selectedAction.templateBindingOverrides?.[binding.name];
                            const effective = canOverride && currentOverride ? currentOverride : binding;
                            return (
                              <TableRow key={`action-binding-${binding.name}`}>
                                <TableCell>{binding.name}</TableCell>
                                <TableCell>{binding.source}</TableCell>
                                <TableCell>
                                  {effective.source === "attribute" || effective.source === "asset" ? (
                                    <Autocomplete
                                      freeSolo
                                      options={
                                        effective.source === "asset" ? assetPaths : assetAttributePaths
                                      }
                                      value={effective.attributePath ?? ""}
                                      disabled={!canOverride}
                                      onInputChange={(_e, value) => {
                                        if (!canOverride) return;
                                        const isAsset = effective.source === "asset";
                                        onUpdateAction(selectedAction.id, {
                                          templateBindingOverrides: {
                                            ...(selectedAction.templateBindingOverrides || {}),
                                            [binding.name]: {
                                              ...binding,
                                              ...currentOverride,
                                              source: isAsset ? "asset" : "attribute",
                                              attributePath: isAsset
                                                ? resolveAssetPath(value, assetPaths)
                                                : resolveAttributePath(value, attributeOptions)
                                            }
                                          }
                                        });
                                      }}
                                      renderInput={(params) => (
                                        <TextField
                                          {...params}
                                          size="small"
                                          placeholder={
                                            effective.source === "asset"
                                              ? "Jasuindo.Taiyo1"
                                              : "Jasuindo.Taiyo1.Operator"
                                          }
                                        />
                                      )}
                                    />
                                  ) : effective.source === "static_boolean" ? (
                                    <FormControl size="small" sx={{ minWidth: 120 }}>
                                      <Select
                                        value={String(effective.staticValue === true)}
                                        disabled={!canOverride}
                                        onChange={(e: SelectChangeEvent<string>) => {
                                          if (!canOverride) return;
                                          onUpdateAction(selectedAction.id, {
                                            templateBindingOverrides: {
                                              ...(selectedAction.templateBindingOverrides || {}),
                                              [binding.name]: {
                                                ...binding,
                                                ...currentOverride,
                                                source: "static_boolean",
                                                staticValue: e.target.value === "true"
                                              }
                                            }
                                          });
                                        }}
                                      >
                                        <MenuItem value="true">true</MenuItem>
                                        <MenuItem value="false">false</MenuItem>
                                      </Select>
                                    </FormControl>
                                  ) : effective.source === "static_number" ? (
                                    <TextField
                                      size="small"
                                      type="number"
                                      fullWidth
                                      disabled={!canOverride}
                                      value={Number(effective.staticValue ?? 0)}
                                      onChange={(e) => {
                                        if (!canOverride) return;
                                        onUpdateAction(selectedAction.id, {
                                          templateBindingOverrides: {
                                            ...(selectedAction.templateBindingOverrides || {}),
                                            [binding.name]: {
                                              ...binding,
                                              ...currentOverride,
                                              source: "static_number",
                                              staticValue: Number(e.target.value)
                                            }
                                          }
                                        });
                                      }}
                                    />
                                  ) : effective.source === "static_array" || effective.source === "static_object" ? (
                                    <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                                      <StableMonaco
                                        path={`action-binding-json:${selectedAction.id}:${binding.name}`}
                                        height="84px"
                                        language="json"
                                        profile="jsonMini"
                                        readOnly={!canOverride}
                                        value={getMonacoFieldDraft(
                                          `action-binding-json:${selectedAction.id}:${binding.name}`,
                                          serializeValue(
                                            effective.staticValue ??
                                              (effective.source === "static_array" ? [] : {})
                                          )
                                        )}
                                        onChangeText={(next) => {
                                          if (!canOverride) return;
                                          scheduleMonacoFieldSave(
                                            `action-binding-json:${selectedAction.id}:${binding.name}`,
                                            next,
                                            (committed) => {
                                              onUpdateAction(selectedAction.id, {
                                                templateBindingOverrides: {
                                                  ...(selectedAction.templateBindingOverrides || {}),
                                                  [binding.name]: {
                                                    ...binding,
                                                    ...currentOverride,
                                                    source: effective.source,
                                                    staticValue: parseMaybeJson(committed)
                                                  }
                                                }
                                              });
                                            }
                                          );
                                        }}
                                      />
                                    </Box>
                                  ) : (
                                    <TextField
                                      size="small"
                                      fullWidth
                                      disabled={!canOverride}
                                      value={String(effective.staticValue ?? "")}
                                      onChange={(e) => {
                                        if (!canOverride) return;
                                        onUpdateAction(selectedAction.id, {
                                          templateBindingOverrides: {
                                            ...(selectedAction.templateBindingOverrides || {}),
                                            [binding.name]: {
                                              ...binding,
                                              ...currentOverride,
                                              source: "static_string",
                                              staticValue: e.target.value
                                            }
                                          }
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
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isSelectedActionDuplicationBlocked}
                    onClick={() => onDuplicateAction(selectedAction.id)}
                  >
                    Duplicate Action
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={() => onRemoveAction(selectedAction.id)}
                  >
                    Remove Action
                  </Button>
                </Box>
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
                <FormControlLabel
                  control={
                    <Switch
                      checked={selectedAction.allowTreeDuplicate !== false}
                      onChange={(_event, checked) =>
                        onUpdateAction(selectedAction.id, { allowTreeDuplicate: checked })
                      }
                    />
                  }
                  label="Allow Tree Duplicate"
                />
                <Typography variant="caption" color="text.secondary">
                  If disabled, this action instance cannot be duplicated from the action list.
                </Typography>
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button size="small" variant="outlined" onClick={() => setMaxEditor(true)}>
                    Maximize Editor
                  </Button>
                </Box>
                <Box sx={{ border: "1px solid #bbbcbd", borderRadius: 0.5, overflow: "hidden" }}>
                  <StableMonaco
                    path={`action:${selectedAction.id}:${selectedAction.templateId || "none"}`}
                    height="calc(100vh - 410px)"
                    language="javascript"
                    profile="script"
                    bindingNames={selectedActionBindingNames}
                    value={actionScriptDraft}
                    readOnly={!!selectedAction.templateId}
                    onChangeText={(next) => {
                      if (selectedAction.templateId) return;
                      actionTypingForIdRef.current = selectedAction.id;
                      actionTypingUntilRef.current = Date.now() + 1000;
                      setActionScriptDraft(next);
                      scheduleSaveActionScript(selectedAction.id, next);
                    }}
                  />
                </Box>
                {selectedAction.templateId && (
                  <Typography variant="caption" color="text.secondary">
                    Script is locked because this action uses a template. Edit it from the Script Template tab.
                  </Typography>
                )}

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
                      <StableMonaco
                        path={`action-full:${selectedAction.id}:${selectedAction.templateId || "none"}`}
                        height="calc(100vh - 96px)"
                        language="javascript"
                        profile="script"
                        bindingNames={selectedActionBindingNames}
                        value={actionScriptDraft}
                        readOnly={!!selectedAction.templateId}
                        onChangeText={(next) => {
                          if (selectedAction.templateId) return;
                          actionTypingForIdRef.current = selectedAction.id;
                          actionTypingUntilRef.current = Date.now() + 1000;
                          setActionScriptDraft(next);
                          scheduleSaveActionScript(selectedAction.id, next);
                        }}
                      />
                    </Box>
                  </DialogContent>
                </Dialog>
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {mainTab === 1 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}>
            <Button variant="outlined" onClick={onAddScriptTemplate}>
              Add Script Template
            </Button>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: "calc(100vh - 260px)", ...scrollBothOverflowSx }}>
              {scriptTemplates.map((template) => (
                <Box
                  key={template.id}
                  onClick={() => setSelectedTemplateId(template.id)}
                  sx={{
                    p: 0.75,
                    border: "1px solid #cbd5e1",
                    borderRadius: "3px",
                    borderColor: selectedTemplateId === template.id ? "#0f766e" : undefined,
                    cursor: "pointer"
                  }}
                >
 
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="subtitle2">{template.name}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="caption" color="text.secondary">
                      {template.description || "No description"}
                    </Typography>                    
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => onRemoveScriptTemplate(template.id)}
                    >
                      Remove
                    </Button>
                  </Box>

                </Box>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedTemplate && (
              <Typography variant="body2" color="text.secondary">
                Select a script template from the left panel.
              </Typography>
            )}
            {selectedTemplate && (
              <Box sx={{ display: "grid", gap: 1 }}>
                <Typography variant="h6">Script Template Detail</Typography>
                <TextField
                  label="Template Name"
                  value={selectedTemplate.name}
                  onChange={(e) =>
                    onUpdateScriptTemplate(selectedTemplate.id, { name: e.target.value })
                  }
                />
                <TextField
                  label="Description"
                  value={selectedTemplate.description ?? ""}
                  onChange={(e) =>
                    onUpdateScriptTemplate(selectedTemplate.id, { description: e.target.value })
                  }
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={selectedTemplate.allowTemplateReuse !== false}
                      onChange={(_event, checked) =>
                        onUpdateScriptTemplate(selectedTemplate.id, { allowTemplateReuse: checked })
                      }
                    />
                  }
                  label="Allow Template Reuse"
                />
                <Typography variant="caption" color="text.secondary">
                  If disabled, this template becomes singleton: only one action instance can use it.
                </Typography>

                <Box sx={{ display: "grid", gap: 0.75 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="subtitle2">Variable Bindings</Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        onUpdateScriptTemplate(selectedTemplate.id, {
                          variableBindings: [
                            ...(selectedTemplate.variableBindings || []),
                            {
                              ...defaultBinding(),
                              name: `binding_${(selectedTemplate.variableBindings || []).length + 1}`
                            }
                          ]
                        })
                      }
                    >
                      Add Binding
                    </Button>
                  </Box>
                  <TableContainer sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, ...scrollBothOverflowSx }}>
                    <Table size="small" sx={{ minWidth: 1120 }} stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 180 }}>Name</TableCell>
                          <TableCell sx={{ minWidth: 150 }}>Source</TableCell>
                          <TableCell sx={{ minWidth: 380 }}>Value</TableCell>
                          <TableCell sx={{ minWidth: 140 }}>Allow Override</TableCell>
                          <TableCell sx={{ minWidth: 100 }}>Action</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(selectedTemplate.variableBindings || []).map((binding, index) => (
                          <TableRow key={`template-binding-${index}`}>
                            <TableCell>
                              <TextField
                                size="small"
                                fullWidth
                                value={binding.name}
                                onChange={(e) =>
                                  onUpdateScriptTemplate(selectedTemplate.id, {
                                    variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                      itemIdx === index ? { ...item, name: e.target.value } : item
                                    )
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <FormControl size="small" sx={{ minWidth: 130 }}>
                                <Select
                                  value={binding.source}
                                  onChange={(e: SelectChangeEvent<ScriptBindingSource>) =>
                                    onUpdateScriptTemplate(selectedTemplate.id, {
                                      variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                        itemIdx === index
                                          ? {
                                              ...item,
                                              source: e.target.value as ScriptBindingSource,
                                              attributePath:
                                                e.target.value === "attribute"
                                                  ? resolveAttributePath(item.attributePath ?? "", attributeOptions)
                                                  : e.target.value === "asset"
                                                    ? resolveAssetPath(item.attributePath ?? "", assetPaths)
                                                    : item.attributePath
                                            }
                                          : item
                                      )
                                    })
                                  }
                                >
                                  <MenuItem value="static_string">static_string</MenuItem>
                                  <MenuItem value="static_number">static_number</MenuItem>
                                  <MenuItem value="static_boolean">static_boolean</MenuItem>
                                  <MenuItem value="static_array">static_array</MenuItem>
                                  <MenuItem value="static_object">static_object</MenuItem>
                                  <MenuItem value="asset">asset</MenuItem>
                                  <MenuItem value="attribute">attribute</MenuItem>
                                </Select>
                              </FormControl>
                            </TableCell>
                            <TableCell>
                              {(binding.source === "attribute" || binding.source === "asset") && (
                                <Autocomplete
                                  freeSolo
                                  options={binding.source === "asset" ? assetPaths : assetAttributePaths}
                                  value={binding.attributePath ?? ""}
                                  onInputChange={(_e, value) =>
                                    onUpdateScriptTemplate(selectedTemplate.id, {
                                      variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                        itemIdx === index
                                          ? {
                                              ...item,
                                              attributePath:
                                                binding.source === "asset"
                                                  ? resolveAssetPath(value, assetPaths)
                                                  : resolveAttributePath(value, attributeOptions)
                                            }
                                          : item
                                      )
                                    })
                                  }
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      size="small"
                                      placeholder={
                                        binding.source === "asset"
                                          ? "Jasuindo.Taiyo1"
                                          : "Jasuindo.Taiyo1.Operator"
                                      }
                                    />
                                  )}
                                />
                              )}
                              {binding.source === "static_boolean" && (
                                <FormControl size="small" sx={{ minWidth: 120 }}>
                                  <Select
                                    value={String(binding.staticValue === true)}
                                    onChange={(e: SelectChangeEvent<string>) =>
                                      onUpdateScriptTemplate(selectedTemplate.id, {
                                        variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                          itemIdx === index ? { ...item, staticValue: e.target.value === "true" } : item
                                        )
                                      })
                                    }
                                  >
                                    <MenuItem value="true">true</MenuItem>
                                    <MenuItem value="false">false</MenuItem>
                                  </Select>
                                </FormControl>
                              )}
                              {binding.source === "static_number" && (
                                <TextField
                                  size="small"
                                  fullWidth
                                  type="number"
                                  value={Number(binding.staticValue ?? 0)}
                                  onChange={(e) =>
                                    onUpdateScriptTemplate(selectedTemplate.id, {
                                      variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                        itemIdx === index ? { ...item, staticValue: Number(e.target.value) } : item
                                      )
                                    })
                                  }
                                />
                              )}
                              {(binding.source === "static_array" || binding.source === "static_object") && (
                                <Box sx={{ display: "grid", gap: 0.5 }}>
                                  <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                                    <StableMonaco
                                      path={`template-binding-json:${selectedTemplate.id}:${index}`}
                                      height="80px"
                                      language="json"
                                      profile="jsonMini"
                                      value={getMonacoFieldDraft(
                                        `template-binding-json:${selectedTemplate.id}:${index}`,
                                        serializeValue(
                                          binding.staticValue ??
                                            (binding.source === "static_array" ? [] : {})
                                        )
                                      )}
                                      onChangeText={(next) => {
                                        scheduleMonacoFieldSave(
                                          `template-binding-json:${selectedTemplate.id}:${index}`,
                                          next,
                                          (committed) => {
                                            onUpdateScriptTemplate(selectedTemplate.id, {
                                              variableBindings: (selectedTemplate.variableBindings || []).map(
                                                (item, itemIdx) =>
                                                  itemIdx === index
                                                    ? { ...item, staticValue: parseMaybeJson(committed) }
                                                    : item
                                              )
                                            });
                                          }
                                        );
                                      }}
                                    />
                                  </Box>
                                </Box>
                              )}
                              {binding.source === "static_string" && (
                                <TextField
                                  size="small"
                                  fullWidth
                                  value={String(binding.staticValue ?? "")}
                                  onChange={(e) =>
                                    onUpdateScriptTemplate(selectedTemplate.id, {
                                      variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                        itemIdx === index ? { ...item, staticValue: e.target.value } : item
                                      )
                                    })
                                  }
                                />
                              )}
                            </TableCell>
                            <TableCell sx={{ minWidth: 110 }}>
                              <FormControlLabel
                                sx={{ m: 0 }}
                                control={
                                  <Switch
                                    size="small"
                                    checked={binding.allowOverride === true}
                                    onChange={(_event, checked) =>
                                      onUpdateScriptTemplate(selectedTemplate.id, {
                                        variableBindings: (selectedTemplate.variableBindings || []).map((item, itemIdx) =>
                                          itemIdx === index ? { ...item, allowOverride: checked } : item
                                        )
                                      })
                                    }
                                  />
                                }
                                label=""
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                size="small"
                                color="error"
                                onClick={() =>
                                  onUpdateScriptTemplate(selectedTemplate.id, {
                                    variableBindings: (selectedTemplate.variableBindings || []).filter(
                                      (_item, itemIdx) => itemIdx !== index
                                    )
                                  })
                                }
                              >
                                Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {(selectedTemplate.variableBindings || []).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <Typography variant="caption" color="text.secondary">
                                No variable bindings yet.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="subtitle2">Template Script</Typography>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={() => setMaxTemplateEditor(true)}
                  >
                    Maximise Editor
                  </Button>
                </Box>

                <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                  <StableMonaco
                    path={`template:${selectedTemplate.id}`}
                    height="calc(100vh - 420px)"
                    language="javascript"
                    profile="script"
                    bindingNames={selectedTemplateBindingNames}
                    value={templateScriptDraft}
                    onChangeText={(next) => {
                      templateTypingForIdRef.current = selectedTemplate.id;
                      templateTypingUntilRef.current = Date.now() + 1000;
                      setTemplateScriptDraft(next);
                      scheduleSaveTemplateScript(selectedTemplate.id, next);
                    }}
                  />
                </Box>
                <Dialog fullScreen open={maxTemplateEditor} onClose={() => setMaxTemplateEditor(false)}>
                <DialogContent sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="subtitle1">
                      Template Script Editor: {selectedTemplate.name}
                    </Typography>
                    <Button variant="outlined" onClick={() => setMaxTemplateEditor(false)}>
                      Close
                    </Button>
                  </Box>

                    <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                      <StableMonaco
                        path={`template-full:${selectedTemplate.id}`}
                        height="calc(100vh - 96px)"
                        language="javascript"
                        profile="script"
                        bindingNames={selectedTemplateBindingNames}
                        value={templateScriptDraft}
                        onChangeText={(next) => {
                          templateTypingForIdRef.current = selectedTemplate.id;
                          templateTypingUntilRef.current = Date.now() + 1000;
                          setTemplateScriptDraft(next);
                          scheduleSaveTemplateScript(selectedTemplate.id, next);
                        }}
                    />
                  </Box>
                </DialogContent>
              </Dialog>
              </Box>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
