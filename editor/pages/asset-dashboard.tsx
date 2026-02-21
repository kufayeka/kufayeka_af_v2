import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Snackbar,
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
import StableMonaco from "../components/common/StableMonaco";
import type { AssetDefinition, Program } from "../types/program";

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

function getRawValue(value: unknown): unknown {
  if (isLabeledValue(value)) return value.value;
  return value;
}

function toLabeledValue(option: { label: string; value: unknown }): { label: string; value: unknown } {
  return { label: option.label, value: option.value };
}

async function runOptionsScript(script: string, context: Record<string, unknown>): Promise<unknown> {
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
}

function normalizeOptions(input: unknown): Array<{ label: string; value: unknown }> {
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
      default: unknown;
      unit: string;
      dashboardVisible: boolean;
      dashboardEditable: boolean;
      nullable: boolean;
      inputType: string;
      options: Array<{ label: string; value: unknown }>;
      optionsScript: string;
      optionKeys: string[];
    }
  >();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      if (attr.enabled === false) continue;
      const prev = rows.get(attr.name);
      if (!prev) {
        rows.set(attr.name, {
          name: attr.name,
          value: attr.default,
          default: attr.default,
          unit: attr.unit ?? "",
          dashboardVisible: attr.dashboardVisible === true,
          dashboardEditable: attr.dashboardEditable !== false,
          nullable: attr.nullable === true,
          inputType: attr.inputType ?? "text",
          options: Array.isArray(attr.options) ? attr.options : [],
          optionsScript: attr.optionsScript ?? "",
          optionKeys: [`${template.id}:${attr.name}`]
        });
      } else {
        const nextKeys = prev.optionKeys.includes(`${template.id}:${attr.name}`)
          ? prev.optionKeys
          : [...prev.optionKeys, `${template.id}:${attr.name}`];
        rows.set(attr.name, {
          ...prev,
          dashboardVisible: prev.dashboardVisible || attr.dashboardVisible === true,
          optionKeys: nextKeys
        });
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
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
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
  const [toast, setToast] = useState<{
    open: boolean;
    severity: "success" | "error";
    message: string;
  }>({ open: false, severity: "success", message: "" });

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

  useEffect(() => {
    setJsonDrafts({});
    setJsonErrors({});
  }, [selectedAssetId]);

  const assetById = useMemo(
    () => new Map(program.assets.assets.map((asset) => [asset.id, asset])),
    [program.assets.assets]
  );
  const templateById = useMemo(
    () => new Map(program.assets.attributeTemplates.map((template) => [template.id, template])),
    [program.assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;

  useEffect(() => {
    const loadOptionProviders = async () => {
      const providerDefs = program.assets.attributeTemplates.flatMap((template) =>
        template.attributes
          .filter(
            (attr) =>
              attr.inputType === "select" || attr.inputType === "radio" || attr.inputType === "multiselect"
          )
          .map((attr) => ({
            key: `${template.id}:${attr.name}`,
            script: attr.optionsScript ?? "",
            defaultValue: attr.default
          }))
      );

      const entries: Array<[string, Array<{ label: string; value: unknown }>]> = [];
      for (const def of providerDefs) {
        try {
          const transformed = await runOptionsScript(def.script, {
            defaultValue: def.defaultValue
          });
          entries.push([def.key, normalizeOptions(transformed)]);
        } catch {
          entries.push([def.key, []]);
        }
      }
      setOptionMap(Object.fromEntries(entries));
    };

    void loadOptionProviders();
  }, [program.assets.attributeTemplates]);

  const getAttributeOptions = (
    attribute: {
      inputType: string;
      options: Array<{ label: string; value: unknown }>;
      optionKeys: string[];
    }
  ): Array<{ label: string; value: unknown }> => {
    if (
      attribute.inputType !== "select" &&
      attribute.inputType !== "radio" &&
      attribute.inputType !== "multiselect"
    ) {
      return [];
    }

    const resolved = attribute.optionKeys.flatMap((key) => optionMap[key] || []);
    if (resolved.length > 0) return resolved;
    return attribute.options || [];
  };

  const formatTreeAttributeValue = (
    attribute: {
      inputType: string;
      value: unknown;
      options: Array<{ label: string; value: unknown }>;
      optionKeys: string[];
    }
  ): string => {
    if (
      attribute.inputType !== "select" &&
      attribute.inputType !== "radio" &&
      attribute.inputType !== "multiselect"
    ) {
      return serializeValue(attribute.value);
    }

    if (attribute.inputType === "multiselect") {
      const values = Array.isArray(attribute.value) ? attribute.value : [];
      if (values.length === 0) return "[]";
      return values
        .map((value) => {
          if (isLabeledValue(value)) {
            return `${value.label} (${serializeValue(value.value)})`;
          }
          return serializeValue(value);
        })
        .join(", ");
    }

    if (isLabeledValue(attribute.value)) {
      return `${attribute.value.label} (${serializeValue(attribute.value.value)})`;
    }

    // Fallback for legacy primitive values.
    const options = getAttributeOptions(attribute);
    const lookup = new Map(options.map((opt) => [rawComparable(opt.value), opt.label]));
    const raw = serializeValue(attribute.value);
    const label = lookup.get(rawComparable(attribute.value));
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
                <Typography variant="body2" sx={{ fontFamily: "monospace", opacity: 0.75 }}>
                  {attr.name}:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: "bold" }}>
                  {formatTreeAttributeValue(attr)} {attr.unit || ""}
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

  const invalidAttributeNames = useMemo(() => {
    const invalid = new Set<string>();
    for (const attribute of dashboardAttributes) {
      if (!attribute.dashboardEditable || attribute.nullable) continue;
      const raw = getRawValue(attribute.value);
      if (raw === null || raw === undefined) {
        invalid.add(attribute.name);
        continue;
      }
      if (typeof raw === "string" && raw.trim() === "") {
        invalid.add(attribute.name);
      }
    }
    return invalid;
  }, [dashboardAttributes]);
  const hasValidationError = invalidAttributeNames.size > 0 || Object.keys(jsonErrors).length > 0;

  const parseInputByType = (inputType: string, rawValue: string): unknown => {
    if (inputType === "number") {
      if (rawValue.trim() === "") return "";
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : rawValue;
    }
    if (inputType === "text" || inputType === "textarea") {
      return rawValue;
    }
    return parseMaybeJson(rawValue);
  };

  const updateAttributeValue = (attributeName: string, inputType: string, rawValue: string) => {
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
                  [attributeName]: { value: parseInputByType(inputType, rawValue) }
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
    if (hasValidationError) {
      const message = "Save dibatalkan: masih ada field wajib yang kosong/null.";
      setStatus(message);
      setToast({ open: true, severity: "error", message });
      return;
    }
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
        const message = `Save error: ${data.error ?? "unknown error"}`;
        setStatus(message);
        setToast({ open: true, severity: "error", message });
        return;
      }
      const result = (await res.json()) as {
        runtimeSynced?: boolean;
        runtimeError?: string;
      };
      setProgram(nextProgram);
      if (result.runtimeSynced === false) {
        const message = `Saved file only, runtime sync failed: ${result.runtimeError ?? "unknown error"}`;
        setStatus(message);
        setToast({ open: true, severity: "error", message });
      } else {
        const message = "Saved (runtime synced)";
        setStatus(message);
        setToast({ open: true, severity: "success", message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusMessage = `Save error: ${message}`;
      setStatus(statusMessage);
      setToast({ open: true, severity: "error", message: statusMessage });
    }
  };

  return (
    <>
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
              <Button variant="contained" size="small" onClick={saveProgram} disabled={loading || hasValidationError}>
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
                        {(() => {
                          const isInvalid = invalidAttributeNames.has(attribute.name);
                          const errorText = isInvalid ? "Field wajib tidak boleh kosong/null." : "";
                          return (
                            <>
                        {attribute.inputType === "boolean" ? (
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
                        ) : attribute.inputType === "radio" ? (
                          <FormControl error={isInvalid}>
                            <RadioGroup
                              row
                              value={rawComparable(getRawValue(attribute.value) ?? "")}
                              onChange={(e) => {
                                const options = getAttributeOptions(attribute);
                                const selected = options.find(
                                  (option) => rawComparable(option.value) === String(e.target.value)
                                );
                                if (selected) {
                                  updateAttributeUnknown(attribute.name, toLabeledValue(selected));
                                  return;
                                }
                                updateAttributeUnknown(attribute.name, {
                                  label: String(e.target.value),
                                  value: e.target.value
                                });
                              }}
                            >
                              {getAttributeOptions(attribute).map((option) => (
                                <FormControlLabel
                                  key={`${attribute.name}-${String(option.value)}`}
                                  value={rawComparable(option.value)}
                                  control={<Radio />}
                                  label={option.label}
                                  disabled={!attribute.dashboardEditable}
                                />
                              ))}
                            </RadioGroup>
                            {isInvalid && <FormHelperText>{errorText}</FormHelperText>}
                          </FormControl>
                        ) : attribute.inputType === "multiselect" ? (
                          <FormControl fullWidth error={isInvalid}>
                            <FormLabel sx={{ mb: 0.5 }}>Multi Select</FormLabel>
                            <FormGroup row>
                              {getAttributeOptions(attribute).map((option) => {
                                const current = Array.isArray(attribute.value) ? attribute.value : [];
                                const checked = current.some(
                                  (item) => rawComparable(getRawValue(item)) === rawComparable(option.value)
                                );
                                return (
                                  <FormControlLabel
                                    key={`${attribute.name}-${String(option.value)}`}
                                    control={
                                      <Checkbox
                                        checked={checked}
                                        disabled={!attribute.dashboardEditable}
                                        onChange={(_e, nextChecked) => {
                                          const base = Array.isArray(attribute.value) ? [...attribute.value] : [];
                                          const nextValue = toLabeledValue(option);
                                          const next = nextChecked
                                            ? [...base, nextValue]
                                            : base.filter(
                                                (item) =>
                                                  rawComparable(getRawValue(item)) !== rawComparable(option.value)
                                              );
                                          updateAttributeUnknown(attribute.name, next);
                                        }}
                                      />
                                    }
                                    label={option.label}
                                  />
                                );
                              })}
                            </FormGroup>
                            {isInvalid && <FormHelperText>{errorText}</FormHelperText>}
                          </FormControl>
                        ) : attribute.inputType === "select" ? (
                          <FormControl fullWidth size="small" error={isInvalid}>
                            <Select
                              value={rawComparable(getRawValue(attribute.value) ?? "")}
                              onChange={(e: SelectChangeEvent<string>) => {
                                const options = getAttributeOptions(attribute);
                                const selected = options.find(
                                  (option) => rawComparable(option.value) === String(e.target.value)
                                );
                                if (selected) {
                                  updateAttributeUnknown(attribute.name, toLabeledValue(selected));
                                  return;
                                }
                                updateAttributeUnknown(attribute.name, {
                                  label: String(e.target.value),
                                  value: e.target.value
                                });
                              }}
                              disabled={!attribute.dashboardEditable}
                            >
                              {getAttributeOptions(attribute).map((option) => (
                                <MenuItem
                                  key={`${attribute.name}-${String(option.value)}`}
                                  value={rawComparable(option.value)}
                                >
                                  {option.label}
                                </MenuItem>
                              ))}
                            </Select>
                            {isInvalid && <FormHelperText>{errorText}</FormHelperText>}
                          </FormControl>
                        ) : attribute.inputType === "json" ? (
                          <Box sx={{ border: "1px solid #cbd5e1", borderRadius: 0.5, overflow: "hidden" }}>
                            <StableMonaco
                              path={`dashboard-json:${selectedAsset.id}:${attribute.name}`}
                              height="110px"
                              language="json"
                              value={
                                Object.prototype.hasOwnProperty.call(jsonDrafts, attribute.name)
                                  ? jsonDrafts[attribute.name]
                                  : serializeValue(attribute.value)
                              }
                              options={jsonMiniOptions}
                              readOnly={!attribute.dashboardEditable}
                              onChangeText={(next) => {
                                if (!attribute.dashboardEditable) return;
                                setJsonDrafts((prev) => ({ ...prev, [attribute.name]: next }));
                                try {
                                  const parsed = JSON.parse(next || "null");
                                  updateAttributeUnknown(attribute.name, parsed);
                                  setJsonErrors((prev) => {
                                    if (!Object.prototype.hasOwnProperty.call(prev, attribute.name)) return prev;
                                    const copy = { ...prev };
                                    delete copy[attribute.name];
                                    return copy;
                                  });
                                } catch {
                                  setJsonErrors((prev) => ({
                                    ...prev,
                                    [attribute.name]: "JSON tidak valid."
                                  }));
                                }
                              }}
                            />
                            {Object.prototype.hasOwnProperty.call(jsonErrors, attribute.name) && (
                              <FormHelperText error sx={{ px: 1 }}>
                                {jsonErrors[attribute.name]}
                              </FormHelperText>
                            )}
                          </Box>
                        ) : (
                          <TextField
                            size="small"
                            fullWidth
                            multiline={attribute.inputType === "textarea"}
                            minRows={attribute.inputType === "textarea" ? 3 : 1}
                            type={attribute.inputType === "number" ? "number" : "text"}
                            value={serializeValue(attribute.value)}
                            onChange={(e) => updateAttributeValue(attribute.name, attribute.inputType, e.target.value)}
                            disabled={!attribute.dashboardEditable}
                            error={isInvalid}
                            helperText={errorText}
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
                            </>
                          );
                        })()}
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
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}

