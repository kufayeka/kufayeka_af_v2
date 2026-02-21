import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
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
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2, RefreshCcw } from "lucide-react";
import { normalizeProgram } from "../../lib/programUtils";
import type { AssetAttributeType, AssetDefinition, AssetFrameworkDefinition, Program } from "../../types/program";

const ATTRIBUTE_TYPES: AssetAttributeType[] = ["number", "boolean", "string", "array", "object"];

interface EffectiveAttributeRow {
  name: string;
  valueType: AssetAttributeType | "custom";
  unit: string;
  value: unknown;
  source: string;
  overridden: boolean;
}

interface AssetManagerProps {
  assets: AssetFrameworkDefinition;
  onChange: (
    updater:
      | AssetFrameworkDefinition
      | ((assets: AssetFrameworkDefinition) => AssetFrameworkDefinition)
  ) => void;
}

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

function parseByType(type: AssetAttributeType, raw: string): unknown {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "boolean") {
    if (raw.trim().toLowerCase() === "true") return true;
    if (raw.trim().toLowerCase() === "false") return false;
    return raw;
  }
  if (type === "string") return raw;
  return parseMaybeJson(raw);
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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
): EffectiveAttributeRow[] {
  const rows = new Map<string, EffectiveAttributeRow>();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      if (attr.enabled === false) continue;
      if (!rows.has(attr.name)) {
        rows.set(attr.name, {
          name: attr.name,
          valueType: attr.valueType,
          unit: attr.unit ?? "",
          value: attr.default,
          source: template.name,
          overridden: false
        });
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
        overridden: true
      });
    }
  }

  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function AssetManager({ assets, onChange }: AssetManagerProps) {
  const [mainTab, setMainTab] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loadingRuntime, setLoadingRuntime] = useState(false);

  const assetById = useMemo(() => new Map(assets.assets.map((asset) => [asset.id, asset])), [assets.assets]);
  const templateById = useMemo(
    () => new Map(assets.attributeTemplates.map((template) => [template.id, template])),
    [assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;
  const selectedTemplate = assets.attributeTemplates.find((template) => template.id === selectedTemplateId);

  const updateAssets = (nextAssets: AssetDefinition[]) => {
    onChange((prev) => ({ ...prev, assets: nextAssets }));
  };

  const updateTemplates = (nextTemplates: AssetFrameworkDefinition["attributeTemplates"]) => {
    onChange((prev) => ({ ...prev, attributeTemplates: nextTemplates }));
  };

  const updateAssetWith = (assetId: string, updater: (asset: AssetDefinition) => AssetDefinition) => {
    onChange((prev) => ({
      ...prev,
      assets: prev.assets.map((asset) => (asset.id === assetId ? updater(asset) : asset))
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

  useEffect(() => {
    const assetKeys = assets.assets.map((asset) => `asset:${asset.id}`);
    setExpandedKeys(assetKeys);
  }, [assets.assets.length]);

  const selectedAssetEffectiveAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);

  const treeData = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const childrenMap = buildChildrenMap(assets.assets);
    const result: DataNode[] = [];

    const includeAsset = (asset: AssetDefinition, attrs: EffectiveAttributeRow[]) => {
      if (!keyword) return true;
      const path = getAssetPath(asset, assetById).toLowerCase();
      const attrHit = attrs.some((attr) => `${attr.name} ${serializeValue(attr.value)}`.toLowerCase().includes(keyword));
      return path.includes(keyword) || attrHit;
    };

    const buildNode = (asset: AssetDefinition): DataNode | null => {
      const attrs = getEffectiveAttributes(asset, templateById);
      const childAssets = (childrenMap.get(asset.id) || []).map(buildNode).filter(Boolean) as DataNode[];
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
              {serializeValue(attr.value)} {attr.unit || ""}
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
  }, [assetById, assets.assets, search, templateById]);

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
        if (prev && normalized.assets.assets.some((asset) => asset.id === prev)) return prev;
        return normalized.assets.assets[0]?.id || "";
      });
      setExpandedKeys(normalized.assets.assets.map((asset) => `asset:${asset.id}`));
    } finally {
      setLoadingRuntime(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      {/* <Paper sx={{ p: 1.25, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>

        <Typography variant="caption" color="text.secondary">
          Struktur template disederhanakan: hanya enabled, name, type, default, unit.
        </Typography>
      </Paper> */}

      <Paper sx={{ p: 1 }}>
        <Tabs value={mainTab} onChange={(_e, value: number) => setMainTab(value)}>
          <Tab label="Assets" />
          <Tab label="Attribute Templates" />
        </Tabs>
      </Paper>

      {mainTab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper sx={{ p: 1.25, maxHeight: "74vh", overflow: "auto" }}>
            <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
              <Button size="small" variant="contained" onClick={() => addAsset(null)}>
                Add Root
              </Button>
              <Button size="small" variant="outlined" onClick={() => selectedAsset && addAsset(selectedAsset.id)} disabled={!selectedAsset}>
                Add Child
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshCcw size={16} />}
                disabled={loadingRuntime}
                onClick={() => void reloadFromRuntime()}
              >
                {loadingRuntime ? "loading..." : ""}
              </Button>
            </Box>
            <TextField
              size="small"
              fullWidth
              placeholder="Search asset/attribute"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ mb: 1 }}
            />
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys)}
              selectedKeys={selectedAssetId ? [`asset:${selectedAssetId}`] : []}
              onSelect={(keys) => {
                const key = String(keys[0] ?? "");
                if (!key.startsWith("asset:")) return;
                setSelectedAssetId(key.slice("asset:".length));
              }}
            />
          </Paper>

          <Paper sx={{ p: 1.25, minHeight: "74vh", overflow: "auto" }}>
            {!selectedAsset ? (
              <Typography variant="body2" color="text.secondary">
                Pilih asset di panel kiri.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>

                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 0.75, mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Asset Detail
                  </Typography>
                    
                    <Button variant="contained" size="small" color="error" onClick={() => selectedAsset && removeAsset(selectedAsset.id)} disabled={!selectedAsset}>
                      Remove
                    </Button>
                </Box>

                <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
                <TextField
                  size="small"
                  label="Asset Name"
                  value={selectedAsset.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    updateAssetWith(selectedAsset.id, (asset) => ({ ...asset, name }));
                  }}
                  sx={{ minWidth: 460, maxWidth: 460 }}
                />

                <FormControl size="small" sx={{ minWidth: 460,  maxWidth: 460 }}>
                  <InputLabel id="asset-parent-label">Parent Asset</InputLabel>
                  <Select
                    labelId="asset-parent-label"
                    label="Parent Asset"
                    value={selectedAsset.parentId ?? ""}
                    onChange={(e: SelectChangeEvent<string>) => {
                      const nextParent = e.target.value || null;
                      if (nextParent === selectedAsset.id) return;
                      const descendants = getDescendantIds(assets.assets, selectedAsset.id);
                      if (nextParent && descendants.has(nextParent)) return;
                      updateAssetWith(selectedAsset.id, (asset) => ({ ...asset, parentId: nextParent }));
                    }}
                  >
                    <MenuItem value="">No parent</MenuItem>
                    {assets.assets
                      .filter((asset) => asset.id !== selectedAsset.id)
                      .map((asset) => (
                        <MenuItem key={asset.id} value={asset.id}>
                          {asset.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
                </Box>

                <FormControl size="small" sx={{ maxWidth: 720 }}>
                  <InputLabel id="asset-template-label">Templates</InputLabel>
                  <Select<string[]>
                    labelId="asset-template-label"
                    label="Templates"
                    multiple
                    value={selectedAsset.templateIds}
                    onChange={(e: SelectChangeEvent<string[]>) => {
                      const raw = e.target.value;
                      const nextTemplateIds = Array.isArray(raw) ? raw : raw.split(",").filter(Boolean);
                      updateAssetWith(selectedAsset.id, (asset) => ({ ...asset, templateIds: nextTemplateIds }));
                    }}
                    renderValue={(selected) =>
                      (selected as string[])
                        .map((id) => templateById.get(id)?.name || id)
                        .join(", ")
                    }
                  >
                    {assets.attributeTemplates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>
                        <Checkbox checked={selectedAsset.templateIds.includes(template.id)} />
                        <Typography variant="body2">{template.name}</Typography>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
                  
                </Box>
          
              <Box sx={{ display: "flex", flexDirection: "row", gap: 1.25 }}>
                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                  Effective Attributes ({selectedAssetEffectiveAttributes.length})
                </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    sx={{ alignSelf: "flex-start" }}
                    onClick={() => refreshAssetTemplateAttributes(selectedAsset.id)}
                  >
                    Refresh Attributes from Templates
                  </Button>
              </Box>

                <TableContainer sx={{ border: "1px solid #dbe3ef", borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Name</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Value</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Type</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Unit</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Source</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAssetEffectiveAttributes.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell sx={{ fontFamily: "monospace" }}>{row.name}</TableCell>
                          <TableCell sx={{ minWidth: 280 }}>
                            <TextField
                              size="small"
                              fullWidth
                              value={serializeValue(row.value)}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const nextValue = row.valueType === "custom" ? parseMaybeJson(raw) : parseByType(row.valueType, raw);
                                updateAssetWith(selectedAsset.id, (asset) => ({
                                  ...asset,
                                  attributes: {
                                    ...asset.attributes,
                                    [row.name]: { value: nextValue }
                                  }
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>{row.valueType}</TableCell>
                          <TableCell>{row.unit || "-"}</TableCell>
                          <TableCell>{row.source}{row.overridden ? " (override)" : ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {mainTab === 1 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 1.25 }}>
          <Paper sx={{ p: 1.25, maxHeight: "74vh", overflow: "auto" }}>
            <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
              <Button size="small" variant="contained" onClick={addTemplate}>
                Add Template
              </Button>
              <Button size="small" color="error" onClick={() => selectedTemplate && removeTemplate(selectedTemplate.id)} disabled={!selectedTemplate}>
                Remove
              </Button>
            </Box>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              {assets.attributeTemplates.map((template) => (
                <Button
                  key={template.id}
                  variant={selectedTemplateId === template.id ? "contained" : "outlined"}
                  size="small"
                  onClick={() => setSelectedTemplateId(template.id)}
                  sx={{ justifyContent: "flex-start" }}
                >
                  {template.name}
                </Button>
              ))}
            </Box>
          </Paper>

          <Paper sx={{ p: 1.25, minHeight: "74vh", overflow: "auto" }}>
            {!selectedTemplate ? (
              <Typography variant="body2" color="text.secondary">
                Pilih template di panel kiri.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                <TextField
                  size="small"
                  label="Template Name"
                  value={selectedTemplate.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    updateTemplateWith(selectedTemplate.id, (template) => ({ ...template, name }));
                  }}
                  sx={{ maxWidth: 460 }}
                />

                <TableContainer sx={{ border: "1px solid #dbe3ef", borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Enabled</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Name</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Type</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Default</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Unit</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedTemplate.attributes.map((attribute, idx) => (
                        <TableRow key={`${attribute.name}-${idx}`}>
                          <TableCell>
                            <FormControlLabel
                              control={
                                <Checkbox
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
                              }
                              label=""
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={attribute.name}
                              onChange={(e) => {
                                const name = e.target.value;
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, name } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" sx={{ minWidth: 130 }}>
                              <Select
                                value={attribute.valueType}
                                onChange={(e: SelectChangeEvent<AssetAttributeType>) => {
                                  const valueType = e.target.value as AssetAttributeType;
                                  updateTemplateWith(selectedTemplate.id, (template) => ({
                                    ...template,
                                    attributes: template.attributes.map((item, itemIdx) =>
                                      itemIdx === idx ? { ...item, valueType } : item
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
                            <TextField
                              size="small"
                              value={serializeValue(attribute.default)}
                              onChange={(e) => {
                                const next = parseByType(attribute.valueType, e.target.value);
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, default: next } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={attribute.unit ?? ""}
                              onChange={(e) => {
                                const unit = e.target.value;
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, unit } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              color="error"
                              onClick={() => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.filter((_item, itemIdx) => itemIdx !== idx)
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
                  size="small"
                  sx={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    updateTemplateWith(selectedTemplate.id, (template) => ({
                      ...template,
                      attributes: [
                        ...template.attributes,
                        {
                          enabled: true,
                          name: `attribute_${template.attributes.length + 1}`,
                          valueType: "number",
                          default: 0,
                          unit: ""
                        }
                      ]
                    }));
                  }}
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
