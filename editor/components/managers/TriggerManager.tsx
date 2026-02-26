import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { AlarmClock, Eye, FolderTree } from "lucide-react";
import type { TriggerDefinition } from "../../types/program";

interface TriggerManagerProps {
  triggers: TriggerDefinition[];
  watchPathOptions?: string[];
  selectedTriggerId: string;
  onSelectTrigger: (id: string) => void;
  onAddTrigger: (type: TriggerDefinition["type"]) => void;
  onRemoveTrigger: (id: string) => void;
  onRenameTrigger: (oldId: string, newId: string) => void;
  onUpdateTrigger: (id: string, patch: Partial<TriggerDefinition>) => void;
  onUpdateTriggerPayload: (id: string, rawPayload: string) => void;
}

function buildTriggerHierarchyTree(triggers: TriggerDefinition[], search: string): DataNode[] {
  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? triggers.filter((trigger) =>
        `${trigger.id} ${trigger.label ?? ""} ${trigger.type} ${trigger.watchPath ?? ""}`
          .toLowerCase()
          .includes(keyword)
      )
    : triggers;

  const categories: Array<{ type: TriggerDefinition["type"]; label: string; icon: ReactNode }> = [
    { type: "interval", label: "Interval", icon: <AlarmClock size={15} /> },
    { type: "watcher_set", label: "Watcher (Set)", icon: <Eye size={15} /> },
    { type: "watcher_valuechange", label: "Watcher (Value Change)", icon: <Eye size={15} /> },
    {
      type: "watcher_valuechange_with_trigger",
      label: "Watcher (Value Change + Trigger)",
      icon: <Eye size={15} />
    }
  ];

  const tree: DataNode[] = [];

  for (const category of categories) {
    const categoryTriggers = filtered.filter((trigger) => trigger.type === category.type);
    const folderChildren = new Map<string, Set<string>>();
    const triggerChildren = new Map<string, TriggerDefinition[]>();

    const ensureFolder = (path: string) => {
      if (!folderChildren.has(path)) folderChildren.set(path, new Set<string>());
      if (!triggerChildren.has(path)) triggerChildren.set(path, []);
    };

    const rootPath = String(category.type);
    ensureFolder(rootPath);

    for (const trigger of categoryTriggers) {
      const segments = trigger.id.split(".").filter(Boolean);
      const folders = segments.slice(0, -1);
      let parent: string = rootPath;
      for (const folder of folders) {
        const path = `${parent}.${folder}`;
        ensureFolder(path);
        folderChildren.get(parent)?.add(path);
        parent = path;
      }
      triggerChildren.get(parent)?.push(trigger);
    }

    for (const [, list] of triggerChildren) {
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

      const triggerNodes: DataNode[] = (triggerChildren.get(path) || []).map((trigger) => ({
        key: `trigger:${trigger.id}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            {category.type === "interval" ? <AlarmClock size={15} /> : <Eye size={15} />}
            <Typography variant="body2">{trigger.id.split(".").pop() || trigger.id}</Typography>
            {!!trigger.label?.trim() && (
              <Typography variant="caption" color="text.secondary">
                {trigger.label}
              </Typography>
            )}
          </Box>
        ),
        isLeaf: true
      }));

      return [...folderNodes, ...triggerNodes];
    };

    tree.push({
      key: `category:${category.type}`,
      title: (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {category.icon}
          <Typography variant="subtitle2">{category.label}</Typography>
        </Box>
      ),
      children: walk(rootPath)
    });
  }

  return tree;
}

export default function TriggerManager({
  triggers,
  watchPathOptions = [],
  selectedTriggerId,
  onSelectTrigger,
  onAddTrigger,
  onRemoveTrigger,
  onRenameTrigger,
  onUpdateTrigger,
  onUpdateTriggerPayload
}: TriggerManagerProps) {
  const [search, setSearch] = useState("");
  const [selectedTreeKey, setSelectedTreeKey] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const selectedTrigger = triggers.find((item) => item.id === selectedTriggerId);
  const hierarchyTree = useMemo(() => buildTriggerHierarchyTree(triggers, search), [triggers, search]);

  useEffect(() => {
    const nextExpanded: Key[] = [];
    const walk = (nodes: DataNode[]) => {
      for (const node of nodes) {
        const key = String(node.key || "");
        if (key.startsWith("category:") || key.startsWith("folder:")) {
          nextExpanded.push(node.key as Key);
        }
        if (node.children) walk(node.children as DataNode[]);
      }
    };
    walk(hierarchyTree);
    setExpandedKeys(nextExpanded);
  }, [hierarchyTree]);

  return (
    <Box sx={{ p: 1.25, display: "grid", gridTemplateColumns: "320px 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 1 }}>
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
            <Button fullWidth variant="outlined" onClick={() => onAddTrigger("interval")}>
              Add Interval
            </Button>
            <Button fullWidth variant="outlined" onClick={() => onAddTrigger("watcher_set")}>
              Add Watcher (Set)
            </Button>
            <Button fullWidth variant="outlined" onClick={() => onAddTrigger("watcher_valuechange")}>
              Add Watcher (Value)
            </Button>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => onAddTrigger("watcher_valuechange_with_trigger")}
            >
              Add Watcher (Value+Trigger)
            </Button>
          </Box>
          <TextField
            size="small"
            label="Search Trigger"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Box
          sx={{
            overflow: "auto",
            maxHeight: "calc(100vh - 220px)"
          }}
        >
          <Tree
            treeData={hierarchyTree}
            expandedKeys={expandedKeys}
            selectedKeys={
              selectedTriggerId
                ? [`trigger:${selectedTriggerId}`]
                : selectedTreeKey
                  ? [selectedTreeKey]
                  : []
            }
            onExpand={(keys) => setExpandedKeys(keys)}
            onSelect={(keys) => {
              const key = String(keys[0] || "");
              if (!key) return;
              setSelectedTreeKey(key);
              if (key.startsWith("trigger:")) {
                onSelectTrigger(key.slice("trigger:".length));
              }
            }}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
        {!selectedTrigger && (
          <Typography variant="body2" color="text.secondary">
            Select a trigger from the left panel.
          </Typography>
        )}

        {selectedTrigger && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="h6">Trigger Detail</Typography>
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => onRemoveTrigger(selectedTrigger.id)}
              >
                Remove Trigger
              </Button>
            </Box>
            <TextField
              label="Trigger ID"
              value={selectedTrigger.id}
              onChange={(e) => onRenameTrigger(selectedTrigger.id, e.target.value)}
            />
            <TextField
              label="Trigger Type"
              value={selectedTrigger.type}
              disabled
            />
            <TextField
              label="Trigger Label"
              value={selectedTrigger.label ?? ""}
              onChange={(e) => onUpdateTrigger(selectedTrigger.id, { label: e.target.value })}
              helperText="Flow node display label (internal ID is unchanged)."
            />
            {selectedTrigger.type === "interval" && (
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
            )}
            {(selectedTrigger.type === "watcher_set" ||
              selectedTrigger.type === "watcher_valuechange" ||
              selectedTrigger.type === "watcher_valuechange_with_trigger") && (
                <Autocomplete
                  freeSolo
                  options={watchPathOptions}
                  value={selectedTrigger.watchPath ?? "*.*.*"}
                  onInputChange={(_e, value) =>
                    onUpdateTrigger(selectedTrigger.id, { watchPath: value })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Watch Path (wildcard supported)"
                      helperText='Example: "Jasuindo.*.Operator" or "*.*.*"'
                    />
                  )}
                />
              )}
            {selectedTrigger.type === "watcher_valuechange_with_trigger" && (
              <TextField
                label="Compare Interval (ms)"
                type="number"
                value={selectedTrigger.intervalMs}
                onChange={(e) =>
                  onUpdateTrigger(selectedTrigger.id, {
                    intervalMs: Math.max(10, Number(e.target.value) || 1000)
                  })
                }
                helperText="Used for manual polling (read + compare)."
              />
            )}
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
