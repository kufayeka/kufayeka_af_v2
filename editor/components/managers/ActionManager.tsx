import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
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
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { FileCode2, FolderTree } from "lucide-react";
import type {
  ActionDefinition,
  ScriptTemplateDefinition
} from "../../types/program";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface ActionManagerProps {
  actions: ActionDefinition[];
  scriptTemplates: ScriptTemplateDefinition[];
  selectedActionId: string;
  onSelectAction: (id: string) => void;
  onAddAction: (parentPath?: string) => void;
  onRemoveAction: (id: string) => void;
  onRenameAction: (oldId: string, newId: string) => void;
  onUpdateAction: (id: string, patch: Partial<ActionDefinition>) => void;
  onAddScriptTemplate: () => void;
  onRemoveScriptTemplate: (id: string) => void;
  onUpdateScriptTemplate: (id: string, patch: Partial<ScriptTemplateDefinition>) => void;
}

function buildHierarchyTree(actions: ActionDefinition[], search: string): DataNode[] {
  const keyword = search.trim().toLowerCase();
  const filteredActions = keyword
    ? actions.filter((action) =>
        `${action.id} ${action.description ?? ""} ${action.type}`.toLowerCase().includes(keyword)
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
        </Box>
      ),
      isLeaf: true
    }));

    return [...folderNodes, ...actionNodes];
  };

  return walk("");
}

export default function ActionManager({
  actions,
  scriptTemplates,
  selectedActionId,
  onSelectAction,
  onAddAction,
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
  const [maxEditor, setMaxEditor] = useState(false);

  const selectedAction = actions.find((item) => item.id === selectedActionId);
  const selectedTemplate = scriptTemplates.find((item) => item.id === selectedTemplateId);
  const hierarchyTree = useMemo(() => buildHierarchyTree(actions, search), [actions, search]);

  const selectedFolderPath = useMemo(() => {
    if (!selectedHierarchyKey.startsWith("folder:")) return "";
    return selectedHierarchyKey.slice("folder:".length);
  }, [selectedHierarchyKey]);

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
              <Button fullWidth variant="outlined" onClick={() => onAddAction(selectedFolderPath || undefined)}>
                Add Action Script
              </Button>
              <TextField
                size="small"
                label="Search Script Hierarchy"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </Box>
            <Box sx={{ border: "1px solid #e2e8f0", borderRadius: 0.5, overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
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
                Pilih action script di panel hierarchy kiri.
              </Typography>
            )}
            {selectedAction && (
              <Box sx={{ display: "grid", gap: 1.25 }}>
                <Typography variant="h6">Action Detail</Typography>
                <TextField
                  label="Action Name (Hierarchy Path)"
                  value={selectedAction.id}
                  onChange={(e) => onRenameAction(selectedAction.id, e.target.value)}
                  helperText="Contoh: areaA.line1.printer.offset.startup"
                />
                <TextField
                  label="Description"
                  value={selectedAction.description ?? ""}
                  onChange={(e) =>
                    onUpdateAction(selectedAction.id, { description: e.target.value })
                  }
                />
                <FormControl fullWidth>
                  <InputLabel>Script Template</InputLabel>
                  <Select
                    label="Script Template"
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
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      const template = scriptTemplates.find((item) => item.id === selectedAction.templateId);
                      if (!template) return;
                      onUpdateAction(selectedAction.id, { script: template.script });
                    }}
                  >
                    Apply Selected Template
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
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button size="small" variant="outlined" onClick={() => setMaxEditor(true)}>
                    Maximize Editor
                  </Button>
                </Box>
                <Box sx={{ border: "1px solid #bbbcbd", borderRadius: 0.5, overflow: "hidden" }}>
                  <MonacoEditor
                    height="calc(100vh - 410px)"
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
      )}

      {mainTab === 1 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}>
            <Button variant="outlined" onClick={onAddScriptTemplate}>
              Add Script Template
            </Button>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: "calc(100vh - 260px)", overflow: "auto" }}>
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
                  <Typography variant="subtitle2">{template.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {template.description || "No description"}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedTemplate && (
              <Typography variant="body2" color="text.secondary">
                Pilih script template di panel kiri.
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
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="subtitle2">Template Script</Typography>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={() => onRemoveScriptTemplate(selectedTemplate.id)}
                  >
                    Remove Template
                  </Button>
                </Box>
                <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                  <MonacoEditor
                    height="calc(100vh - 420px)"
                    defaultLanguage="javascript"
                    value={selectedTemplate.script}
                    onChange={(value) =>
                      onUpdateScriptTemplate(selectedTemplate.id, { script: value ?? "" })
                    }
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      wordWrap: "on"
                    }}
                  />
                </Box>
              </Box>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
