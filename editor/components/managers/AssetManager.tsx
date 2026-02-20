import { useEffect, useMemo, useState } from "react";
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
  TextField,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2 } from "lucide-react";
import type {
  AssetAttributeType,
  AssetAttributeValue,
  AssetDefinition,
  AssetFrameworkDefinition
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
) {
  const rows = new Map<
    string,
    {
      name: string;
      type: AssetAttributeType | "custom";
      unit: string;
      value: unknown;
      source: string;
      overridden: boolean;
      dashboardVisible: boolean;
    }
  >();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      if (!rows.has(attr.name)) {
        rows.set(attr.name, {
          name: attr.name,
          type: attr.type,
          unit: attr.unit ?? "",
          value: attr.defaultValue,
          source: template.name,
          overridden: false,
          dashboardVisible: attr.dashboardVisible === true
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
        type: "custom",
        unit: "",
        value: val.value,
        source: "Custom",
        overridden: true,
        dashboardVisible: false
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
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {attr.name}: {serializeValue(attr.value)} {attr.unit || ""}
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

  useEffect(() => {
    const assetKeys = assets.assets.map((asset) => `asset:${asset.id}`);
    setExpandedKeys(assetKeys);
  }, [assets.assets.length]);

  const selectedAssetEffectiveAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);
  const selectedAssetDashboardAttributes = useMemo(
    () => selectedAssetEffectiveAttributes.filter((attribute) => attribute.dashboardVisible),
    [selectedAssetEffectiveAttributes]
  );

  return (
    <Box sx={{ p: 1.25, display: "grid", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 0.5 }}>
        <Tabs value={mainTab} onChange={(_e, v: number) => setMainTab(v)}>
          <Tab label="Asset Explorer" />
          <Tab label="Attribute Template" />
          <Tab label="Asset Dashboard Setting" />
        </Tabs>
      </Paper>

      {mainTab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75 }}>
            <Button variant="outlined" onClick={() => addAsset(null)}>
              Add Root Asset
            </Button>
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
                        <TableCell>{attribute.type}</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={serializeValue(attribute.value)}
                            onChange={(e) => {
                              const patch: AssetAttributeValue = { value: parseMaybeJson(e.target.value) };
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
                <Table size="small" sx={{ border: "1px solid #e2e8f0" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Default Value</TableCell>
                      <TableCell>Unit</TableCell>
                      <TableCell>Dashboard</TableCell>
                      <TableCell>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedTemplate.attributes.map((attribute, idx) => (
                      <TableRow key={`template-attr-${idx}`}>
                        <TableCell>
                          <TextField
                            size="small"
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
                          <FormControl size="small" sx={{ minWidth: 120 }}>
                            <Select
                              value={attribute.type}
                              onChange={(e: SelectChangeEvent<AssetAttributeType>) => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx
                                      ? { ...item, type: e.target.value as AssetAttributeType }
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
                          <TextField
                            size="small"
                            value={serializeValue(attribute.defaultValue)}
                            onChange={(e) => {
                              updateTemplateWith(selectedTemplate.id, (template) => ({
                                ...template,
                                attributes: template.attributes.map((item, itemIdx) =>
                                  itemIdx === idx
                                    ? { ...item, defaultValue: parseMaybeJson(e.target.value) }
                                    : item
                                )
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
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
                <Button
                  variant="outlined"
                  onClick={() =>
                    updateTemplateWith(selectedTemplate.id, (template) => ({
                      ...template,
                      attributes: [
                        ...template.attributes,
                        {
                          name: `attribute_${template.attributes.length + 1}`,
                          type: "number",
                          defaultValue: 0,
                          unit: "",
                          dashboardVisible: false
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

      {mainTab === 2 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}>
            <Typography variant="subtitle2">Asset Tree Selector</Typography>
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
                Pilih asset di tree selector.
              </Typography>
            )}
            {selectedAsset && (
              <Box sx={{ display: "grid", gap: 0.75 }}>
                <Typography variant="h6">Dashboard Attribute Editor</Typography>
                <Typography variant="caption" color="text.secondary">
                  Hanya attribute template dengan flag Dashboard aktif yang muncul di sini.
                </Typography>
                <Table size="small" sx={{ border: "1px solid #e2e8f0" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell>Unit</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedAssetDashboardAttributes.map((attribute) => (
                      <TableRow key={`dashboard-${attribute.name}`}>
                        <TableCell>{attribute.name}</TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            fullWidth
                            value={serializeValue(attribute.value)}
                            onChange={(e) => {
                              const patch: AssetAttributeValue = { value: parseMaybeJson(e.target.value) };
                              updateAssetWith(selectedAsset.id, (asset) => ({
                                ...asset,
                                attributes: { ...asset.attributes, [attribute.name]: patch }
                              }));
                            }}
                          />
                        </TableCell>
                        <TableCell>{attribute.unit || "-"}</TableCell>
                      </TableRow>
                    ))}
                    {selectedAssetDashboardAttributes.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Typography variant="caption" color="text.secondary">
                            Tidak ada attribute yang di-expose ke dashboard.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Paper>
        </Box>
      )}
    </Box>
  );
}
