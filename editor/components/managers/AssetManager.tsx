import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  TextField,
  Tooltip,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2, RefreshCcw } from "lucide-react";
import { normalizeProgram } from "../../lib/programUtils";
import StableMonaco from "../common/StableMonaco";
import type {
  AssetDashboardInputMode,
  AssetAttributeType,
  AssetAttributeValue,
  AssetDefinition,
  AssetFrameworkDefinition,
  Program
} from "../../types/program";

const ATTRIBUTE_TYPES: AssetAttributeType[] = [
  "number",
  "boolean",
  "string",
  "array",
  "object"
];

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseDefaultByInputType(inputType: string, raw: string): unknown {
  if (inputType === "text" || inputType === "textarea") return raw;
  if (inputType === "number") {
    if (raw.trim() === "") return "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return parseMaybeJson(raw);
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function isLabeledValue(value: unknown): value is { label: string; value: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "label") &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}

function rawComparable(value: unknown): string {
  if (isLabeledValue(value)) return String(value.value);
  return String(value);
}

function buildChildrenMap(assets: AssetDefinition[]): Map<string | null, AssetDefinition[]> {
  const map = new Map<string | null, AssetDefinition[]>();
  for (const asset of assets) {
    const key = asset.parentId ?? null;
    const list = map.get(key) || [];
    list.push(asset);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

function getDescendantIds(assets: AssetDefinition[], parentId: string): Set<string> {
  const descendants = new Set<string>();
  const childrenMap = buildChildrenMap(assets);
  const queue = [...(childrenMap.get(parentId) || []).map((item) => item.id)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    for (const child of childrenMap.get(current) || []) {
      queue.push(child.id);
    }
  }
  return descendants;
}

function getAssetPath(asset: AssetDefinition, byId: Map<string, AssetDefinition>): string {
  const parts = [asset.name];
  let parentId = asset.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }
  return parts.join(".");
}

function getEffectiveAttributes(
  asset: AssetDefinition,
  templateById: Map<string, AssetFrameworkDefinition["attributeTemplates"][number]>
) {
  const rows = new Map<
    string,
    {
      name: string;
      valueType: AssetAttributeType | "custom";
      unit: string;
      value: unknown;
      source: string;
      overridden: boolean;
      dashboardVisible: boolean;
      dashboardEditable: boolean;
      nullable: boolean;
      inputType: string;
      options: Array<{ label: string; value: unknown }>;
      optionsScript: string;
    }
  >();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      if (attr.enabled === false) continue;
      if (!rows.has(attr.name)) {
        rows.set(attr.name, {
          name: attr.name,
          valueType: attr.valueType ?? "string",
          unit: attr.unit ?? "",
          value: attr.default,
          source: template.name,
          overridden: false,
          dashboardVisible: attr.dashboardVisible === true,
          dashboardEditable: attr.dashboardEditable !== false,
          nullable: attr.nullable === true,
          inputType: attr.inputType ?? "text",
          options: Array.isArray(attr.options) ? attr.options : [],
          optionsScript: attr.optionsScript ?? ""
        });
      } else {
        const prev = rows.get(attr.name);
        if (prev && attr.dashboardVisible === true) {
          rows.set(attr.name, { ...prev, dashboardVisible: true });
        }
      }
    }
  }

  for (const [name, val] of Object.entries(asset.attributes || {})) {
    const existing = rows.get(name);
    if (existing) {
      rows.set(name, { ...existing, value: val.value, overridden: true });
    } else {
      rows.set(name, {
        name,
        valueType: "custom",
        unit: "",
        value: val.value,
        source: "Custom",
        overridden: true,
        dashboardVisible: false,
        dashboardEditable: false,
        nullable: false,
        inputType: "text",
        options: [],
        optionsScript: ""
      });
    }
  }

  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

interface AssetManagerProps {
  assets: AssetFrameworkDefinition;
  onChange: (
    updater:
      | AssetFrameworkDefinition
      | ((assets: AssetFrameworkDefinition) => AssetFrameworkDefinition)
  ) => void;
}

export default function AssetManager({ assets, onChange }: AssetManagerProps) {
  const [mainTab, setMainTab] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [optionMap, setOptionMap] = useState<Record<string, Array<{ label: string; value: unknown }>>>({});
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [monacoFieldDrafts, setMonacoFieldDrafts] = useState<Record<string, string>>({});
  const monacoFieldTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const jsonMiniOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      fontSize: 12,
      lineNumbers: "off" as const,
      wordWrap: "on" as const,
      scrollBeyondLastLine: false
    }),
    []
  );

  const assetById = useMemo(
    () => new Map(assets.assets.map((asset) => [asset.id, asset])),
    [assets.assets]
  );
  const templateById = useMemo(
    () => new Map(assets.attributeTemplates.map((template) => [template.id, template])),
    [assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;
  const selectedTemplate = assets.attributeTemplates.find(
    (template) => template.id === selectedTemplateId
  );

  const updateAssets = (nextAssets: AssetDefinition[]) => {
    onChange((prev) => ({ ...prev, assets: nextAssets }));
  };

  const updateTemplates = (nextTemplates: AssetFrameworkDefinition["attributeTemplates"]) => {
    onChange((prev) => ({ ...prev, attributeTemplates: nextTemplates }));
  };

  const updateAssetWith = (
    assetId: string,
    updater: (asset: AssetDefinition) => AssetDefinition
  ) => {
    onChange((prev) => ({
      ...prev,
      assets: prev.assets.map((asset) => (asset.id === assetId ? updater(asset) : asset))
    }));
  };

  const addAsset = (parentId: string | null) => {
    const id = makeId("asset");
    const next: AssetDefinition = {
      id,
      name: `Asset_${assets.assets.length + 1}`,
      parentId,
      templateIds: [],
      attributes: {}
    };
    updateAssets([...assets.assets, next]);
    setSelectedAssetId(id);
    if (parentId) {
      setExpandedKeys((prev) => (prev.includes(`asset:${parentId}`) ? prev : [...prev, `asset:${parentId}`]));
    }
  };

  const removeAsset = (assetId: string) => {
    const descendants = getDescendantIds(assets.assets, assetId);
    const blocked = new Set([assetId, ...descendants]);
    updateAssets(assets.assets.filter((asset) => !blocked.has(asset.id)));
    if (selectedAssetId && blocked.has(selectedAssetId)) setSelectedAssetId("");
  };

  const updateAssetPatch = (assetId: string, patch: Partial<AssetDefinition>) => {
    updateAssetWith(assetId, (asset) => ({ ...asset, ...patch }));
  };

  const refreshAssetTemplateAttributes = (assetId: string) => {
    updateAssetWith(assetId, (asset) => {
      const allowedNames = new Set<string>();
      for (const templateId of asset.templateIds || []) {
        const template = templateById.get(templateId);
        if (!template) continue;
        for (const attribute of template.attributes || []) {
          if (attribute.enabled === false) continue;
          allowedNames.add(attribute.name);
        }
      }
      const nextAttributes = Object.fromEntries(
        Object.entries(asset.attributes || {}).filter(([name]) => allowedNames.has(name))
      );
      return { ...asset, attributes: nextAttributes };
    });
  };

  const addTemplate = () => {
    const id = makeId("template");
    const next = {
      id,
      name: `Template_${assets.attributeTemplates.length + 1}`,
      enabled: true,
      attributes: []
    };
    updateTemplates([...assets.attributeTemplates, next]);
    setSelectedTemplateId(id);
  };

  const removeTemplate = (templateId: string) => {
    updateTemplates(assets.attributeTemplates.filter((template) => template.id !== templateId));
    updateAssets(
      assets.assets.map((asset) => ({
        ...asset,
        templateIds: asset.templateIds.filter((id) => id !== templateId)
      }))
    );
    if (selectedTemplateId === templateId) setSelectedTemplateId("");
  };

  const updateTemplate = (
    templateId: string,
    patch: Partial<AssetFrameworkDefinition["attributeTemplates"][number]>
  ) => {
    onChange((prev) => ({
      ...prev,
      attributeTemplates: prev.attributeTemplates.map((template) =>
        template.id === templateId ? { ...template, ...patch } : template
      )
    }));
  };

  const updateTemplateWith = (
    templateId: string,
    updater: (
      template: AssetFrameworkDefinition["attributeTemplates"][number]
    ) => AssetFrameworkDefinition["attributeTemplates"][number]
  ) => {
    onChange((prev) => ({
      ...prev,
      attributeTemplates: prev.attributeTemplates.map((template) =>
        template.id === templateId ? updater(template) : template
      )
    }));
  };

  useEffect(() => {
    return () => {
      for (const timer of Object.values(monacoFieldTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

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
    const existing = monacoFieldTimersRef.current[fieldKey];
    if (existing) clearTimeout(existing);
    monacoFieldTimersRef.current[fieldKey] = setTimeout(() => {
      commit(next);
      delete monacoFieldTimersRef.current[fieldKey];
    }, 600);
  };

  const treeData = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const childrenMap = buildChildrenMap(assets.assets);
    const result: DataNode[] = [];

    const includeAsset = (asset: AssetDefinition, attrs: ReturnType<typeof getEffectiveAttributes>) => {
      if (!keyword) return true;
      const path = getAssetPath(asset, assetById).toLowerCase();
      const attrHit = attrs.some((attr) => `${attr.name} ${serializeValue(attr.value)}`.toLowerCase().includes(keyword));
      return path.includes(keyword) || attrHit;
    };

    const buildNode = (asset: AssetDefinition): DataNode | null => {
      const attrs = getEffectiveAttributes(asset, templateById);
      const childAssets = (childrenMap.get(asset.id) || [])
        .map(buildNode)
        .filter(Boolean) as DataNode[];
      const selfIncluded = includeAsset(asset, attrs);
      if (!selfIncluded && childAssets.length === 0) return null;

      const attrNodes: DataNode[] = attrs.map((attr) => ({
        key: `attr:${asset.id}:${attr.name}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <ArrowRight size={14} />
            <Typography variant="body2" sx={{ fontFamily: "monospace", opacity: 0.75 }}>
              {attr.name}:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: "bold" }}>
              {formatTreeValue(attr, asset)} {attr.unit || ""}
            </Typography>
          </Box>
        ),
        isLeaf: true
      }));

      return {
        key: `asset:${asset.id}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Building2 size={15} />
            <Typography variant="body2">{asset.name}</Typography>
          </Box>
        ),
        children: [...childAssets, ...attrNodes]
      };
    };

    for (const root of childrenMap.get(null) || []) {
      const node = buildNode(root);
      if (node) result.push(node);
    }
    return result;
  }, [assetById, assets.assets, optionMap, search, templateById]);

  useEffect(() => {
    const assetKeys = assets.assets.map((asset) => `asset:${asset.id}`);
    setExpandedKeys(assetKeys);
  }, [assets.assets.length]);

  const selectedAssetEffectiveAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);
  const runOptionsScript = async (script: string, context: Record<string, unknown>): Promise<unknown> => {
    if (!script.trim()) return [];
    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (...fnArgs: unknown[]) => Promise<unknown>;
      const fn = new AsyncFunction("context", "fetch", `"use strict";\n${script}`);
      return await fn(context, fetch);
    } catch {
      return [];
    }
  };

  const normalizeOptions = (input: unknown): Array<{ label: string; value: unknown }> => {
    const list = Array.isArray(input)
      ? input
      : input && typeof input === "object" && Array.isArray((input as { data?: unknown[] }).data)
        ? (input as { data: unknown[] }).data
        : [];
    return list
      .map((item) => {
        if (item && typeof item === "object") {
          const row = item as { label?: unknown; value?: unknown; name?: unknown; id?: unknown };
          const label = String(row.label ?? row.name ?? row.value ?? row.id ?? "");
          const value = row.value ?? row.id ?? row.label ?? row.name;
          return label ? { label, value } : null;
        }
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
          return { label: String(item), value: item };
        }
        return null;
      })
      .filter(Boolean) as Array<{ label: string; value: unknown }>;
  };

  const loadOptionProviders = async (
    templates: AssetFrameworkDefinition["attributeTemplates"] = assets.attributeTemplates
  ) => {
    setLoadingOptions(true);
    try {
      const providerDefs = templates
        .flatMap((template) =>
        template.attributes
          .filter((attr) =>
            attr.enabled !== false &&
            (attr.inputType === "select" || attr.inputType === "radio" || attr.inputType === "multiselect")
          )
          .map((attr) => ({
            key: `${template.id}:${attr.name}`,
            script: attr.optionsScript ?? "",
            defaultValue: attr.default
          }))
      );

      const results = await Promise.all(
        providerDefs.map(async (def): Promise<[string, Array<{ label: string; value: unknown }>]> => {
          try {
            const transformed = await runOptionsScript(def.script, {
              defaultValue: def.defaultValue
            });
            return [def.key, normalizeOptions(transformed)];
          } catch {
            return [def.key, []];
          }
        })
      );
      setOptionMap(Object.fromEntries(results));
    } finally {
      setLoadingOptions(false);
    }
  };

  useEffect(() => {
    void loadOptionProviders(assets.attributeTemplates);
  }, [assets.attributeTemplates]);

  const reloadFromRuntime = async () => {
    setLoadingRuntime(true);
    try {
      const res = await fetch("/api/program");
      const data = (await res.json()) as { program?: Program };
      const normalized = normalizeProgram(
        data.program ?? {
          meta: { name: "Kufayeka AF Program", version: 1 },
          triggers: [],
          actions: [],
          scriptTemplates: [],
          flows: { links: [] },
          assets: { assets: [], attributeTemplates: [] }
        }
      );
      onChange(normalized.assets);
      setSelectedAssetId((prev) => {
        if (prev && normalized.assets.assets.some((asset) => asset.id === prev)) {
          return prev;
        }
        return normalized.assets.assets[0]?.id || "";
      });
      setExpandedKeys(normalized.assets.assets.map((asset) => `asset:${asset.id}`));
      void loadOptionProviders(normalized.assets.attributeTemplates);
    } catch {
      // keep previous state when reload fails
    } finally {
      setLoadingRuntime(false);
    }
  };

  function formatTreeValue(
    attr: ReturnType<typeof getEffectiveAttributes>[number],
    asset: AssetDefinition
  ): string {
    if (attr.inputType !== "select" && attr.inputType !== "radio" && attr.inputType !== "multiselect") {
      return serializeValue(attr.value);
    }
    if (attr.inputType === "multiselect") {
      const values = Array.isArray(attr.value) ? attr.value : [];
      if (values.length === 0) return "[]";
      return values
        .map((item) => {
          if (isLabeledValue(item)) {
            return `${item.label} (${serializeValue(item.value)})`;
          }
          return serializeValue(item);
        })
        .join(", ");
    }
    if (isLabeledValue(attr.value)) {
      return `${attr.value.label} (${serializeValue(attr.value.value)})`;
    }

    // Fallback for legacy primitive value that hasn't been migrated yet.
    const keys = asset.templateIds.flatMap((templateId) => {
      const template = assets.attributeTemplates.find((item) => item.id === templateId);
      if (!template) return [];
      return template.attributes
        .filter((attribute) => attribute.name === attr.name)
        .map((attribute) => `${template.id}:${attribute.name}`);
    });
    const options = keys.flatMap((key) => optionMap[key] || []);
    const lookup = new Map(options.map((option) => [rawComparable(option.value), option.label]));

    const raw = serializeValue(attr.value);
    const label = lookup.get(rawComparable(attr.value));
    return label ? `${label} (${raw})` : raw;
  }

  return (
    <Box sx={{ p: 1.25, display: "grid", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 0.5 }}>
        <Tabs value={mainTab} onChange={(_e, v: number) => setMainTab(v)}>
          <Tab label="Asset Explorer" />
          <Tab label="Attribute Template" />
        </Tabs>
      </Paper>

      {mainTab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75 }}>
            <Box sx={{ display: "flex", gap: 0.75 }}>
              <Button variant="outlined" onClick={() => addAsset(null)}>
                Add Root Asset
              </Button>
              <Tooltip title="Reload latest assets + option labels">
                <span>
                  <Button
                    variant="outlined"
                    onClick={() => void reloadFromRuntime()}
                    disabled={loadingRuntime}
                    sx={{ minWidth: 40, px: 1 }}
                  >
                    <RefreshCcw size={15} />
                  </Button>
                </span>
              </Tooltip>
            </Box>
            <TextField
              size="small"
              label="Search Asset or Attribute"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Box sx={{ overflow: "auto", maxHeight: "calc(100vh - 260px)", border: "1px solid #e2e8f0", borderRadius: 0.5, p: 0.5 }}>
              <Tree
                treeData={treeData}
                expandedKeys={expandedKeys}
                selectedKeys={selectedAssetId ? [`asset:${selectedAssetId}`] : []}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(keys) => {
                  const key = String(keys[0] || "");
                  if (!key) return;
                  if (key.startsWith("asset:")) {
                    setSelectedAssetId(key.slice("asset:".length));
                    return;
                  }
                  if (key.startsWith("attr:")) {
                    const segments = key.split(":");
                    if (segments.length >= 2) setSelectedAssetId(segments[1]);
                  }
                }}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedAsset && (
              <Typography variant="body2" color="text.secondary">
                Pilih asset di tree explorer.
              </Typography>
            )}
            {selectedAsset && (
              <Box sx={{ display: "grid", gap: 1 }}>
                <Typography variant="h6">Asset Detail</Typography>
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <Button variant="outlined" onClick={() => addAsset(selectedAsset.id)}>
                    Add Child
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => refreshAssetTemplateAttributes(selectedAsset.id)}
                  >
                    Refresh Template Attr
                  </Button>
                  <Button color="error" variant="outlined" onClick={() => removeAsset(selectedAsset.id)}>
                    Remove Asset + Descendants
                  </Button>
                </Box>
                <TextField
                  label="Asset Name"
                  value={selectedAsset.name}
                  onChange={(e) => updateAssetPatch(selectedAsset.id, { name: e.target.value })}
                />
                <FormControl fullWidth>
                  <InputLabel>Parent</InputLabel>
                  <Select
                    label="Parent"
                    value={selectedAsset.parentId ?? ""}
                    onChange={(e: SelectChangeEvent<string>) =>
                      updateAssetPatch(selectedAsset.id, { parentId: e.target.value || null })
                    }
                  >
                    <MenuItem value="">(Root)</MenuItem>
                    {assets.assets
                      .filter((candidate) => {
                        if (candidate.id === selectedAsset.id) return false;
                        const descendants = getDescendantIds(assets.assets, selectedAsset.id);
                        return !descendants.has(candidate.id);
                      })
                      .map((candidate) => (
                        <MenuItem key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel>Attribute Templates</InputLabel>
                  <Select<string[]>
                    multiple
                    label="Attribute Templates"
                    value={selectedAsset.templateIds as string[]}
                    onChange={(e: SelectChangeEvent<string[]>) =>
                      updateAssetPatch(selectedAsset.id, { templateIds: e.target.value as string[] })
                    }
                    renderValue={(selected) => (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {(selected as string[]).map((id) => (
                          <Chip key={id} size="small" label={templateById.get(id)?.name || id} />
                        ))}
                      </Box>
                    )}
                  >
                    {assets.attributeTemplates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>
                        {template.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="subtitle2">
                  Resolved Path: {getAssetPath(selectedAsset, assetById)}
                </Typography>
                <Typography variant="subtitle2">Attributes</Typography>
                <Table size="small" sx={{ border: "1px solid #e2e8f0" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell>Source</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedAssetEffectiveAttributes.map((attribute) => (
                      <TableRow key={attribute.name}>
                        <TableCell>{attribute.name}</TableCell>
                        <TableCell>{attribute.valueType}</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={serializeValue(attribute.value)}
                            onChange={(e) => {
                              const patch: AssetAttributeValue = {
                                value: parseDefaultByInputType(attribute.inputType, e.target.value)
                              };
                              updateAssetWith(selectedAsset.id, (asset) => ({
                                ...asset,
                                attributes: { ...asset.attributes, [attribute.name]: patch }
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>{attribute.unit || "-"}</TableCell>
                        <TableCell>{attribute.overridden ? "Override" : attribute.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {mainTab === 1 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}>
            <Button variant="outlined" onClick={addTemplate}>
              Add Template
            </Button>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
              {assets.attributeTemplates.map((template) => (
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
                    {template.attributes.length} attributes
                  </Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.25, minHeight: "calc(100vh - 220px)" }}>
            {!selectedTemplate && (
              <Typography variant="body2" color="text.secondary">
                Pilih template di panel kiri.
              </Typography>
            )}
            {selectedTemplate && (
              <Box sx={{ display: "grid", gap: 0.75 }}>
                <Box sx={{ display: "flex", gap: 0.75 }}>
                  <TextField
                    fullWidth
                    label="Template Name"
                    value={selectedTemplate.name}
                    onChange={(e) => updateTemplate(selectedTemplate.id, { name: e.target.value })}
                  />
                  <Button color="error" variant="outlined" onClick={() => removeTemplate(selectedTemplate.id)}>
                    Remove
                  </Button>
                </Box>
                <TableContainer
                  sx={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 0.5,
                    overflowX: "auto",
                    overflowY: "auto",
                    maxHeight: "calc(100vh - 360px)"
                  }}
                >
                <Table size="small" stickyHeader sx={{ minWidth: 1880 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 220 }}>Name</TableCell>
                      <TableCell sx={{ minWidth: 110 }}>Enabled</TableCell>
                      <TableCell sx={{ minWidth: 130 }}>Type</TableCell>
                      <TableCell sx={{ minWidth: 260 }}>Default Value</TableCell>
                      <TableCell sx={{ minWidth: 180 }}>Unit</TableCell>
                      <TableCell sx={{ minWidth: 150 }}>Show in Dashboard</TableCell>
                      <TableCell sx={{ minWidth: 120 }}>Dashboard Editable</TableCell>
                      <TableCell sx={{ minWidth: 120 }}>Dashboard Nullable</TableCell>
                      <TableCell sx={{ minWidth: 150 }}>Field/Form Type</TableCell>
                      <TableCell sx={{ minWidth: 540 }}>Options Script (supports await fetch)</TableCell>
                      <TableCell sx={{ minWidth: 100 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedTemplate.attributes.map((attribute, idx) => (
                      <TableRow key={`template-attr-${idx}`}>
                        <TableCell>
                          <TextField
                            size="small"
                            sx={{ minWidth: 210 }}
                            value={attribute.name}
                            onChange={(e) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, name: e.target.value } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            size="small"
                            checked={attribute.enabled !== false}
                            onChange={(_e, checked) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, enabled: checked } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                              value={attribute.valueType}
                              onChange={(e: SelectChangeEvent<AssetAttributeType>) => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx
                                      ? { ...item, valueType: e.target.value as AssetAttributeType }
                                      : item
                                  )
                                }));
                              }}
                            >
                              {ATTRIBUTE_TYPES.map((type) => (
                                <MenuItem key={type} value={type}>
                                  {type}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell>
                          {attribute.inputType === "json" ||
                          attribute.inputType === "multiselect" ||
                          attribute.inputType === "select" ||
                          attribute.inputType === "radio" ? (
                            <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden", minWidth: 240 }}>
                              <StableMonaco
                                path={`template-default-json:${selectedTemplate.id}:${idx}`}
                                height="84px"
                                language="json"
                                value={getMonacoFieldDraft(
                                  `template-default-json:${selectedTemplate.id}:${idx}`,
                                  serializeValue(attribute.default)
                                )}
                                options={jsonMiniOptions}
                                onChangeText={(next) => {
                                  scheduleMonacoFieldSave(
                                    `template-default-json:${selectedTemplate.id}:${idx}`,
                                    next,
                                    (committed) => {
                                      updateTemplateWith(selectedTemplate.id, (template) => ({
                                        ...template,
                                        attributes: template.attributes.map((item, itemIdx) =>
                                          itemIdx === idx
                                            ? { ...item, default: parseMaybeJson(committed) }
                                            : item
                                        )
                                      }));
                                    }
                                  );
                                }}
                              />
                            </Box>
                          ) : (
                            <TextField
                              size="small"
                              sx={{ minWidth: 240 }}
                              value={serializeValue(attribute.default)}
                              onChange={(e) => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx
                                      ? { ...item, default: parseDefaultByInputType(attribute.inputType ?? "text", e.target.value) }
                                      : item
                                  )
                                }));
                              }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            sx={{ minWidth: 160 }}
                            value={attribute.unit || ""}
                            onChange={(e) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, unit: e.target.value } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            size="small"
                            checked={attribute.dashboardVisible === true}
                            onChange={(_e, checked) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, dashboardVisible: checked } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            size="small"
                            checked={attribute.dashboardEditable !== false}
                            onChange={(_e, checked) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, dashboardEditable: checked } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch
                            size="small"
                            checked={attribute.nullable === true}
                            onChange={(_e, checked) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, nullable: checked } : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                              value={attribute.inputType ?? "text"}
                              onChange={(e: SelectChangeEvent<string>) => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx
                                      ? { ...item, inputType: e.target.value as AssetDashboardInputMode }
                                      : item
                                  )
                                }));
                              }}
                            >
                              <MenuItem value="text">text</MenuItem>
                              <MenuItem value="number">number</MenuItem>
                              <MenuItem value="boolean">boolean</MenuItem>
                              <MenuItem value="json">json</MenuItem>
                              <MenuItem value="select">select</MenuItem>
                              <MenuItem value="radio">radio</MenuItem>
                              <MenuItem value="multiselect">multiselect</MenuItem>
                              <MenuItem value="textarea">textarea</MenuItem>
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell sx={{ minWidth: 520 }}>
                          {attribute.inputType === "select" ||
                          attribute.inputType === "radio" ||
                          attribute.inputType === "multiselect" ? (
                            <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                              <StableMonaco
                                path={`template-options-script:${selectedTemplate.id}:${idx}`}
                                height="150px"
                                language="javascript"
                                value={getMonacoFieldDraft(
                                  `template-options-script:${selectedTemplate.id}:${idx}`,
                                  attribute.optionsScript ??
                                    "const res = await fetch('https://example.com/api/options');\nconst rows = await res.json();\nreturn rows.map((item) => ({ label: String(item.name), value: item.id }));"
                                )}
                                options={jsonMiniOptions}
                                onChangeText={(next) => {
                                  scheduleMonacoFieldSave(
                                    `template-options-script:${selectedTemplate.id}:${idx}`,
                                    next,
                                    (committed) => {
                                      updateTemplateWith(selectedTemplate.id, (template) => ({
                                        ...template,
                                        attributes: template.attributes.map((item, itemIdx) =>
                                          itemIdx === idx
                                            ? { ...item, optionsScript: committed }
                                            : item
                                        )
                                      }));
                                    }
                                  );
                                }}
                              />
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Hanya untuk select/radio/multiselect.
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            color="error"
                            size="small"
                            onClick={() => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.filter(
                                  (_item, itemIdx) => itemIdx !== idx
                                )
                              }));
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
                <Button
                  variant="outlined"
                  onClick={() =>
                    updateTemplateWith(selectedTemplate.id, (template) => ({
                      ...template,
                      attributes: [
                        ...template.attributes,
                        {
                          enabled: true,
                          name: `attribute_${template.attributes.length + 1}`,
                          valueType: "number",
                          default: 0,
                          unit: "",
                          dashboardVisible: false,
                          dashboardEditable: true,
                          nullable: false,
                          inputType: "text",
                          options: [],
                          optionsScript: ""
                        }
                      ]
                    }))
                  }
                >
                  Add Attribute
                </Button>
              </Box>
            )}
          </Paper>
        </Box>
      )}

    </Box>
  );
}
