import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  TextField,
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2, RefreshCcw } from "lucide-react";
import { normalizeProgram } from "../lib/programUtils";
import type { AssetDefinition, AssetOptionSource, Program } from "../types/program";

const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  triggers: [],
  actions: [],
  scriptTemplates: [],
  flows: { links: [] },
  assets: { assets: [], attributeTemplates: [] }
};

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

function getEffectiveDashboardAttributes(
  asset: AssetDefinition,
  templateById: Map<string, Program["assets"]["attributeTemplates"][number]>
) {
  const rows = new Map<
    string,
    {
      name: string;
      value: unknown;
      defaultValue: unknown;
      unit: string;
      dashboardVisible: boolean;
      dashboardEditable: boolean;
      nullable: boolean;
      inputMode: string;
      optionsSource: AssetOptionSource;
      options: Array<{ label: string; value: unknown }>;
      optionsApiUrl: string;
      optionsTransformScript: string;
    }
  >();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      const prev = rows.get(attr.name);
      if (!prev) {
        rows.set(attr.name, {
          name: attr.name,
          value: attr.defaultValue,
          defaultValue: attr.defaultValue,
          unit: attr.unit ?? "",
          dashboardVisible: attr.dashboardVisible === true,
          dashboardEditable: attr.dashboardEditable !== false,
          nullable: attr.nullable === true,
          inputMode: attr.inputMode ?? "text",
          optionsSource: attr.optionsSource ?? "static",
          options: Array.isArray(attr.options) ? attr.options : [],
          optionsApiUrl: attr.optionsApiUrl ?? "",
          optionsTransformScript: attr.optionsTransformScript ?? ""
        });
      } else if (attr.dashboardVisible === true) {
        rows.set(attr.name, { ...prev, dashboardVisible: true });
      }
    }
  }

  for (const [name, val] of Object.entries(asset.attributes || {})) {
    const prev = rows.get(name);
    if (prev) {
      rows.set(name, { ...prev, value: val.value });
    }
  }

  return Array.from(rows.values())
    .filter((item) => item.dashboardVisible)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function AssetDashboardPage() {
  const [program, setProgram] = useState<Program>(EMPTY_PROGRAM);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [loading, setLoading] = useState(false);
  const [optionMap, setOptionMap] = useState<Record<string, Array<{ label: string; value: unknown }>>>({});

  const loadProgram = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/program");
      const data = (await res.json()) as { program?: Program };
      const next = normalizeProgram(data.program ?? EMPTY_PROGRAM);
      setProgram(next);
      setSelectedAssetId((prev) => prev || next.assets.assets[0]?.id || "");
      setExpandedKeys(next.assets.assets.map((asset) => `asset:${asset.id}`));
      setStatus("Program loaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Load error: ${message}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadProgram();
  }, []);

  const assetById = useMemo(
    () => new Map(program.assets.assets.map((asset) => [asset.id, asset])),
    [program.assets.assets]
  );
  const templateById = useMemo(
    () => new Map(program.assets.attributeTemplates.map((template) => [template.id, template])),
    [program.assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;

  const formatTreeAttributeValue = (
    attribute: {
      inputMode: string;
      value: unknown;
      optionsSource: AssetOptionSource;
      options: Array<{ label: string; value: unknown }>;
      name: string;
    }
  ): string => {
    if (
      attribute.inputMode !== "select" &&
      attribute.inputMode !== "radio" &&
      attribute.inputMode !== "multiselect"
    ) {
      return serializeValue(attribute.value);
    }

    const options =
      attribute.optionsSource === "api" || attribute.optionsSource === "scriptTransform"
        ? optionMap[attribute.name] || []
        : attribute.options || [];
    const lookup = new Map(options.map((opt) => [String(opt.value), opt.label]));

    if (attribute.inputMode === "multiselect") {
      const values = Array.isArray(attribute.value) ? attribute.value : [];
      if (values.length === 0) return "[]";
      return values
        .map((value) => {
          const raw = serializeValue(value);
          const label = lookup.get(String(value));
          return label ? `${label} (${raw})` : raw;
        })
        .join(", ");
    }

    const raw = serializeValue(attribute.value);
    const label = lookup.get(String(attribute.value));
    return label ? `${label} (${raw})` : raw;
  };

  const treeData = useMemo(() => {
    const childrenMap = buildChildrenMap(program.assets.assets);
    const buildNode = (asset: AssetDefinition): DataNode => {
      const attrs = getEffectiveDashboardAttributes(asset, templateById);
      return {
        key: `asset:${asset.id}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Building2 size={15} />
            <Typography variant="body2">{asset.name}</Typography>
          </Box>
        ),
        children: [
          ...(childrenMap.get(asset.id) || []).map(buildNode),
          ...attrs.map((attr) => ({
            key: `attr:${asset.id}:${attr.name}`,
            title: (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ArrowRight size={14} />
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {attr.name}: {formatTreeAttributeValue(attr)} {attr.unit || ""}
                </Typography>
              </Box>
            ),
            isLeaf: true
          }))
        ]
      };
    };

    return (childrenMap.get(null) || []).map(buildNode);
  }, [optionMap, program.assets.assets, templateById]);

  const dashboardAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveDashboardAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);

  useEffect(() => {
    const apiAttributes = dashboardAttributes.filter(
      (attribute) =>
        (attribute.optionsSource === "api" || attribute.optionsSource === "scriptTransform") &&
        attribute.optionsApiUrl
    );
    if (apiAttributes.length === 0) return;

    let cancelled = false;
    const loadOptions = async () => {
      const entries: Array<[string, Array<{ label: string; value: unknown }>]> = [];
      for (const attribute of apiAttributes) {
        try {
          const res = await fetch(attribute.optionsApiUrl);
          const raw = (await res.json()) as unknown;
          const transformed = (() => {
            if (attribute.optionsSource !== "scriptTransform" || !attribute.optionsTransformScript?.trim()) {
              return raw;
            }
            try {
              const fn = new Function("input", attribute.optionsTransformScript);
              return fn(raw);
            } catch {
              return raw;
            }
          })();
          const list = Array.isArray(transformed)
            ? transformed
            : transformed && typeof transformed === "object" && Array.isArray((transformed as { data?: unknown[] }).data)
              ? (transformed as { data: unknown[] }).data
              : [];
          const normalized = list
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
          entries.push([attribute.name, normalized]);
        } catch {
          entries.push([attribute.name, []]);
        }
      }
      if (cancelled) return;
      setOptionMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    };

    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [dashboardAttributes]);

  useEffect(() => {
    const localOptionAttrs = dashboardAttributes.filter(
      (attribute) =>
        attribute.optionsSource === "static"
    );
    if (localOptionAttrs.length === 0) return;
    const nextMap = Object.fromEntries(
      localOptionAttrs.map((attribute) => [attribute.name, attribute.options || []])
    );
    setOptionMap((prev) => ({ ...prev, ...nextMap }));
  }, [dashboardAttributes]);

  const updateAttributeValue = (attributeName: string, rawValue: string) => {
    if (!selectedAsset) return;
    setProgram((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: prev.assets.assets.map((asset) =>
          asset.id !== selectedAsset.id
            ? asset
            : {
                ...asset,
                attributes: {
                  ...asset.attributes,
                  [attributeName]: { value: parseMaybeJson(rawValue) }
                }
              }
        )
      }
    }));
  };

  const updateAttributeUnknown = (attributeName: string, value: unknown) => {
    if (!selectedAsset) return;
    setProgram((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: prev.assets.assets.map((asset) =>
          asset.id !== selectedAsset.id
            ? asset
            : {
                ...asset,
                attributes: {
                  ...asset.attributes,
                  [attributeName]: { value }
                }
              }
        )
      }
    }));
  };

  const saveProgram = async () => {
    try {
      const nextProgram: Program = {
        ...program,
        assets: {
          ...program.assets,
          assets: program.assets.assets.map((asset) => {
            const attrs = getEffectiveDashboardAttributes(asset, templateById);
            const removeSet = new Set(
              attrs
                .filter((attribute) => attribute.nullable && attribute.value === null)
                .map((attribute) => attribute.name)
            );
            if (removeSet.size === 0) return asset;
            const nextAttributes = Object.fromEntries(
              Object.entries(asset.attributes || {}).filter(([name]) => !removeSet.has(name))
            );
            return { ...asset, attributes: nextAttributes };
          })
        }
      };

      const res = await fetch("/api/program", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program: nextProgram })
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setStatus(`Save error: ${data.error ?? "unknown error"}`);
        return;
      }
      setProgram(nextProgram);
      setStatus("Saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Save error: ${message}`);
    }
  };

  return (
    <Box
      sx={{
        p: 1.25,
        height: "100vh",
        boxSizing: "border-box",
        background: "#f8fafc"
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25, height: "100%" }}>
        <Paper
          variant="outlined"
          sx={{ height: "100%", p: 1, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 0.75, minHeight: 0 }}
        >
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Typography variant="subtitle2">Asset Explorer</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Tooltip title="Refresh latest data">
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={loading}
                    onClick={() => void loadProgram()}
                    sx={{ minWidth: 36, px: 1 }}
                  >
                    <RefreshCcw size={16} />
                  </Button>
                </span>
              </Tooltip>
              <Button variant="contained" size="small" onClick={saveProgram}>
                Save
              </Button>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {status}
          </Typography>
          <Box sx={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 0.5, p: 0.5, minHeight: 0 }}>
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

        <Paper
          variant="outlined"
          sx={{ height: "100%", p: 1.25, minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}
        >
          {!selectedAsset && (
            <Typography variant="body2" color="text.secondary">
              Pilih asset di tree explorer.
            </Typography>
          )}
          {selectedAsset && (
            <Box sx={{ display: "grid", gap: 0.75, minHeight: 0 }}>
              <Typography variant="h6">Asset Attribute Editor</Typography>
              <Box sx={{ overflow: "auto", minHeight: 0, border: "1px solid #e2e8f0", borderRadius: 0.5 }}>
                <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Unit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dashboardAttributes.map((attribute) => (
                    <TableRow key={`dashboard-${attribute.name}`}>
                      <TableCell>{attribute.name}</TableCell>
                      <TableCell sx={{ minWidth: 220 }}>
                        {attribute.inputMode === "boolean" ? (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={Boolean(attribute.value)}
                                disabled={!attribute.dashboardEditable}
                                onChange={(_e, checked) => updateAttributeUnknown(attribute.name, checked)}
                              />
                            }
                            label="Enabled"
                          />
                        ) : attribute.inputMode === "radio" ? (
                          <FormControl>
                            <RadioGroup
                              row
                              value={String(attribute.value ?? "")}
                              onChange={(e) => updateAttributeUnknown(attribute.name, e.target.value)}
                            >
                              {(attribute.optionsSource === "api" || attribute.optionsSource === "scriptTransform"
                                ? optionMap[attribute.name] || []
                                : attribute.options || []
                              ).map((option) => (
                                <FormControlLabel
                                  key={`${attribute.name}-${String(option.value)}`}
                                  value={String(option.value)}
                                  control={<Radio />}
                                  label={option.label}
                                  disabled={!attribute.dashboardEditable}
                                />
                              ))}
                            </RadioGroup>
                          </FormControl>
                        ) : attribute.inputMode === "multiselect" ? (
                          <FormControl fullWidth>
                            <FormLabel sx={{ mb: 0.5 }}>Multi Select</FormLabel>
                            <FormGroup row>
                              {(attribute.optionsSource === "api" || attribute.optionsSource === "scriptTransform"
                                ? optionMap[attribute.name] || []
                                : attribute.options || []
                              ).map((option) => {
                                const current = Array.isArray(attribute.value) ? attribute.value : [];
                                const checked = current.some((item) => item === option.value);
                                return (
                                  <FormControlLabel
                                    key={`${attribute.name}-${String(option.value)}`}
                                    control={
                                      <Checkbox
                                        checked={checked}
                                        disabled={!attribute.dashboardEditable}
                                        onChange={(_e, nextChecked) => {
                                          const base = Array.isArray(attribute.value) ? [...attribute.value] : [];
                                          const next = nextChecked
                                            ? [...base, option.value]
                                            : base.filter((item) => item !== option.value);
                                          updateAttributeUnknown(attribute.name, next);
                                        }}
                                      />
                                    }
                                    label={option.label}
                                  />
                                );
                              })}
                            </FormGroup>
                          </FormControl>
                        ) : attribute.inputMode === "select" ? (
                          <FormControl fullWidth size="small">
                            <Select
                              value={String(attribute.value ?? "")}
                              onChange={(e: SelectChangeEvent<string>) =>
                                updateAttributeUnknown(attribute.name, e.target.value)
                              }
                              disabled={!attribute.dashboardEditable}
                            >
                              {(attribute.optionsSource === "api" || attribute.optionsSource === "scriptTransform"
                                ? optionMap[attribute.name] || []
                                : attribute.options || []
                              ).map((option) => (
                                <MenuItem key={`${attribute.name}-${String(option.value)}`} value={String(option.value)}>
                                  {option.label}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : (
                          <TextField
                            size="small"
                            fullWidth
                            multiline={attribute.inputMode === "textarea"}
                            minRows={attribute.inputMode === "textarea" ? 3 : 1}
                            type={attribute.inputMode === "number" ? "number" : "text"}
                            value={serializeValue(attribute.value)}
                            onChange={(e) => updateAttributeValue(attribute.name, e.target.value)}
                            disabled={!attribute.dashboardEditable}
                          />
                        )}
                        {attribute.nullable && attribute.dashboardEditable && (
                          <Button
                            size="small"
                            variant="text"
                            sx={{ mt: 0.5 }}
                            onClick={() => updateAttributeUnknown(attribute.name, null)}
                          >
                            Set Null (revert to default on save)
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>{attribute.unit || "-"}</TableCell>
                    </TableRow>
                  ))}
                  {dashboardAttributes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="caption" color="text.secondary">
                          Tidak ada attribute yang di-expose untuk dashboard pada asset ini.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </Box>
            </Box>
          )}
        </Paper>

      </Box>
    </Box>
  );
}
