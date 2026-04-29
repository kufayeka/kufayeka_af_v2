import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  IconButton
} from "@mui/material";
import { scrollBothOverflowSx } from "../common/scrollSx";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { Database, RefreshCcw } from "lucide-react";
import AttributeValueEditorCells from "../domains/asset/AttributeValueEditorCells";
import DebouncedSearchField from "../domains/asset/DebouncedSearchField";
import AssetManagerHistorianTab from "../domains/asset/AssetManagerHistorianTab";
import {
  ATTRIBUTE_TYPES,
  DEFAULT_HISTORIAN_TARGET,
  TREE_BOTTOM_SPACER_KEY,
  buildChildrenMap,
  collectTreeKeys,
  getAssetPath,
  getDescendantIds,
  getEffectiveAttributes,
  makeId,
  parseByType,
  parseMaybeJson,
  serializeValue,
  type EffectiveAttributeRow,
  useDebouncedValue
} from "../domains/asset/assetManagerUtils";
import {
  buildAssetAttributePaths,
  buildAssetTreeData,
  buildAutoExpandedKeys,
  buildVisibleAttributeRows,
  filterEffectiveAttributeRows
} from "../domains/asset/assetTreeSelectors";
import {
  useAssetHistorianHandlers,
  type HistorianQueryResponse,
  type MonitorLogEntry,
  type MonitorLogsKind,
  type QueryMode,
  type QueryOrder,
  type QueryTimeFmt
} from "../domains/asset/useAssetHistorianHandlers";
import type {
  AssetAttributeType,
  AssetDefinition,
  AssetFrameworkDefinition,
  HistorianTargetDefinition,
} from "../../types/program";

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
  const [assetSearch, setAssetSearch] = useState("");
  const [attributeSearch, setAttributeSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedTreeKey, setSelectedTreeKey] = useState<Key>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [refreshingAttributeKeys, setRefreshingAttributeKeys] = useState<Record<string, boolean>>({});
  const [refreshingSelectedAssetValues, setRefreshingSelectedAssetValues] = useState(false);
  const [attributeTableScrollTop, setAttributeTableScrollTop] = useState(0);
  const [notice, setNotice] = useState<{ open: boolean; kind: "success" | "error"; message: string }>({
    open: false,
    kind: "success",
    message: ""
  });
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monitorTarget, setMonitorTarget] = useState<HistorianTargetDefinition | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorMetrics, setMonitorMetrics] = useState<Record<string, unknown> | null>(null);
  const [monitorLogs, setMonitorLogs] = useState<MonitorLogEntry[]>([]);
  const [monitorLogsKind, setMonitorLogsKind] = useState<MonitorLogsKind>("system");
  const [monitorLogsLimit, setMonitorLogsLimit] = useState(50);
  const [monitorError, setMonitorError] = useState("");
  const [queryMode, setQueryMode] = useState<QueryMode>("raw");
  const [queryPath, setQueryPath] = useState("");
  const [queryFrom, setQueryFrom] = useState(() => {
    const d = new Date(Date.now() - 60 * 60 * 1000);
    return d.toISOString();
  });
  const [queryTo, setQueryTo] = useState(() => new Date().toISOString());
  const [queryBucketMs, setQueryBucketMs] = useState("1000");
  const [queryAgg, setQueryAgg] = useState("avg");
  const [queryLimit, setQueryLimit] = useState("1000");
  const [queryOrder, setQueryOrder] = useState<QueryOrder>("desc");
  const [queryTime, setQueryTime] = useState<QueryTimeFmt>("iso");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<HistorianQueryResponse | null>(null);
  const [queryError, setQueryError] = useState("");
  const runtimeApiBase = useMemo(() => {
    return "/api/runtime";
  }, []);
  const debouncedAssetSearch = useDebouncedValue(assetSearch, 1500);
  const debouncedAttributeSearch = useDebouncedValue(attributeSearch, 1500);
  const assetsViewportHeight = "calc(100vh - 190px)";
  const attributeRefreshCooldownRef = useRef<Record<string, number>>({});
  const assetRefreshCooldownRef = useRef<Record<string, number>>({});
  const effectiveTableRowHeight = 57;
  const effectiveTableViewportHeight = 560;

  const assetById = useMemo(() => new Map(assets.assets.map((asset) => [asset.id, asset])), [assets.assets]);
  const templateById = useMemo(
    () => new Map(assets.attributeTemplates.map((template) => [template.id, template])),
    [assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;
  const selectedTemplate = assets.attributeTemplates.find((template) => template.id === selectedTemplateId);
  const selectedAssetPath = selectedAsset ? getAssetPath(selectedAsset, assetById) : "";
  const historianTargets = useMemo<HistorianTargetDefinition[]>(() => {
    const list = assets.historians || [];
    if (list.some((x) => x.id === "default")) return list;
    return [DEFAULT_HISTORIAN_TARGET, ...list];
  }, [assets.historians]);
  const effectiveAttributesByAssetId = useMemo(() => {
    const map = new Map<string, EffectiveAttributeRow[]>();
    for (const asset of assets.assets) {
      map.set(asset.id, getEffectiveAttributes(asset, templateById));
    }
    return map;
  }, [assets.assets, templateById]);

  const updateAssets = (nextAssets: AssetDefinition[]) => {
    onChange((prev) => ({ ...prev, assets: nextAssets }));
  };

  const updateTemplates = (nextTemplates: AssetFrameworkDefinition["attributeTemplates"]) => {
    onChange((prev) => ({ ...prev, attributeTemplates: nextTemplates }));
  };

  const updateHistorians = (nextHistorians: HistorianTargetDefinition[]) => {
    onChange((prev) => ({ ...prev, historians: nextHistorians }));
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
    return effectiveAttributesByAssetId.get(selectedAsset.id) || [];
  }, [effectiveAttributesByAssetId, selectedAsset]);
  const filteredSelectedAssetEffectiveAttributes = useMemo(() => {
    return filterEffectiveAttributeRows(selectedAssetEffectiveAttributes, debouncedAttributeSearch);
  }, [debouncedAttributeSearch, selectedAssetEffectiveAttributes]);

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedTreeKey("");
      return;
    }
    setSelectedTreeKey(`asset:${selectedAssetId}`);
  }, [selectedAssetId]);

  const formatAttributeTimestamp = (ts?: string): string => {
    if (!ts) return "-";
    const parsed = new Date(ts);
    if (Number.isNaN(parsed.getTime())) return ts;
    return parsed.toLocaleString();
  };
  const assetAttributePaths = useMemo(
    () => buildAssetAttributePaths(assets.assets, assetById, templateById),
    [assetById, assets.assets, templateById]
  );

  useEffect(() => {
    if (queryPath.trim()) return;
    if (assetAttributePaths.length === 0) return;
    setQueryPath(assetAttributePaths[0]);
  }, [assetAttributePaths, queryPath]);

  useEffect(() => {
    if (mainTab > 1) setMainTab(1);
  }, [mainTab]);

  const treeData = useMemo(
    () =>
      buildAssetTreeData({
        assets: assets.assets,
        assetById,
        effectiveAttributesByAssetId,
        assetSearch: debouncedAssetSearch,
        attributeSearch: debouncedAttributeSearch
      }),
    [assetById, assets.assets, debouncedAssetSearch, debouncedAttributeSearch, effectiveAttributesByAssetId]
  );
  const autoExpandedKeys = useMemo(
    () => buildAutoExpandedKeys(treeData, expandedKeys, debouncedAssetSearch, debouncedAttributeSearch),
    [debouncedAssetSearch, debouncedAttributeSearch, expandedKeys, treeData]
  );
  const visibleAttributeRows = useMemo(
    () =>
      buildVisibleAttributeRows({
        scrollTop: attributeTableScrollTop,
        rows: filteredSelectedAssetEffectiveAttributes,
        rowHeight: effectiveTableRowHeight,
        viewportHeight: effectiveTableViewportHeight
      }),
    [attributeTableScrollTop, filteredSelectedAssetEffectiveAttributes]
  );

  const reloadFromRuntime = async () => {
    setLoadingRuntime(true);
    try {
      const runtimeRes = await fetch(`${runtimeApiBase}/assets/system`);
      const runtimeData = (await runtimeRes.json()) as { data?: AssetFrameworkDefinition; error?: string };
      if (!runtimeRes.ok) {
        throw new Error(runtimeData.error || `Runtime API error ${runtimeRes.status}`);
      }
      const runtimeAssets = runtimeData.data;
      if (!runtimeAssets || typeof runtimeAssets !== "object") {
        throw new Error("Runtime API returned empty asset system");
      }
      onChange({
        assets: Array.isArray(runtimeAssets.assets) ? runtimeAssets.assets : [],
        attributeTemplates: Array.isArray(runtimeAssets.attributeTemplates) ? runtimeAssets.attributeTemplates : [],
        historians: Array.isArray(runtimeAssets.historians) ? runtimeAssets.historians : []
      });
      setSelectedAssetId((prev) => {
        if (prev && Array.isArray(runtimeAssets.assets) && runtimeAssets.assets.some((asset) => asset.id === prev)) return prev;
        return runtimeAssets.assets?.[0]?.id || "";
      });
      setExpandedKeys((runtimeAssets.assets || []).map((asset) => `asset:${asset.id}`));
      showNotice("success", `Reloaded ${(runtimeAssets.assets || []).length} assets from runtime`);
    } catch (error) {
      showNotice("error", `Reload failed: ${(error instanceof Error ? error.message : String(error))}`);
    } finally {
      setLoadingRuntime(false);
    }
  };

  const showNotice = (kind: "success" | "error", message: string) => {
    setNotice({ open: true, kind, message });
  };

  const isAttributeRefreshCoolingDown = (path: string): boolean => {
    const until = attributeRefreshCooldownRef.current[path] || 0;
    return until > Date.now();
  };

  const readJsonLike = async (res: Response): Promise<Record<string, unknown>> => {
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: `Non-JSON response (${res.status})` };
    }
  };

  const {
    deleteHistorianByPath,
    deleteHistorianByTemplateAttribute,
    loadMonitorData,
    openMonitor,
    refreshSelectedAssetValues,
    refreshSingleAttributeValue,
    runQueryTester
  } = useAssetHistorianHandlers({
    runtimeApiBase,
    assetById,
    showNotice,
    updateAssetWith,
    selectedAsset,
    selectedAssetPath,
    selectedAssetEffectiveAttributes,
    attributeRefreshCooldownRef,
    assetRefreshCooldownRef,
    setRefreshingAttributeKeys,
    setRefreshingSelectedAssetValues,
    setMonitorTarget,
    setMonitorOpen,
    setMonitorLoading,
    setMonitorError,
    setMonitorMetrics,
    setMonitorLogs,
    monitorLogsKind,
    monitorLogsLimit,
    queryPath,
    queryTime,
    queryMode,
    queryFrom,
    queryTo,
    queryOrder,
    queryLimit,
    queryBucketMs,
    queryAgg,
    setQueryLoading,
    setQueryError,
    setQueryResult
  });

  return (
    <>
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
        <Box sx={{ display: "grid", gridTemplateColumns: "500px 1fr", gap: 1.25, height: assetsViewportHeight }}>
          <Paper sx={{ p: 1.25, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  addAsset(null);
                  showNotice("success", "Root asset created");
                }}
              >
                Add Root
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (!selectedAsset) return;
                  addAsset(selectedAsset.id);
                  showNotice("success", `Child asset created under "${selectedAsset.name}"`);
                }}
                disabled={!selectedAsset}
              >
                Add Child
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshCcw size={16} />}
                aria-label="Reload assets and attribute values from runtime"
                title="Reload assets and attribute values from runtime"
                disabled={loadingRuntime}
                onClick={() => void reloadFromRuntime()}
              >
                {loadingRuntime ? "Loading..." : "Reload Runtime"}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  setExpandedKeys(collectTreeKeys(treeData).filter((key) => String(key).startsWith("asset:")))
                }
                disabled={treeData.length === 0}
              >
                Expand All
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => setExpandedKeys([])}
                disabled={treeData.length === 0}
              >
                Collapse All
              </Button>
            </Box>
            <DebouncedSearchField
              fullWidth
              placeholder="Search asset"
              initialValue={assetSearch}
              onCommit={setAssetSearch}
              sx={{ mb: 1 }}
            />
            <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
              <Tree
                treeData={treeData}
                expandedKeys={autoExpandedKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                selectedKeys={selectedTreeKey ? [selectedTreeKey] : []}
                virtual
                height={Math.max(240, 800)}
                itemHeight={30}
                onSelect={(keys) => {
                  const key = String(keys[0] ?? "");
                  if (!key) return;
                  setSelectedTreeKey(key);
                  if (key.startsWith("asset:")) {
                    setSelectedAssetId(key.slice("asset:".length));
                  }
                }}
              />
            </Box>
          </Paper>

          <Paper sx={{ p: 1.25, height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            {!selectedAsset ? (
              <Typography variant="body2" color="text.secondary">
                Select an asset from the left panel.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, height: "100%", minHeight: 0 }}>

                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 0.75, mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Asset Detail
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <IconButton
                      size="small"
                      aria-label={`Refresh effective attributes for asset ${selectedAsset.name} from assigned templates`}
                      title={`Refresh effective attributes for asset ${selectedAsset.name} from assigned templates`}
                      onClick={() => {
                        refreshAssetTemplateAttributes(selectedAsset.id);
                        showNotice("success", `Effective attributes refreshed for "${selectedAsset.name}"`);
                      }}
                    >
                      <RefreshCcw size={16} />
                    </IconButton>
                    <Button
                      variant="contained"
                      size="small"
                      color="error"
                      onClick={() => {
                        if (!selectedAsset) return;
                        if (!window.confirm(`Remove asset "${selectedAsset.name}" and all descendants?`)) return;
                        const targetName = selectedAsset.name;
                        removeAsset(selectedAsset.id);
                        showNotice("success", `Asset "${targetName}" removed`);
                      }}
                      disabled={!selectedAsset}
                    >
                      Remove
                    </Button>
                  </Box>
                </Box>

                <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
                <TextField
                  key={`asset-name:${selectedAsset.id}:${selectedAsset.name}`}
                  size="small"
                  label="Asset Name"
                  defaultValue={selectedAsset.name}
                  onBlur={(e) => {
                    const committed = e.target.value;
                    if (committed === selectedAsset.name) return;
                    updateAssetWith(selectedAsset.id, (asset) => ({ ...asset, name: committed }));
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
          
                <Box
                  sx={{
                    display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.25,
                  flexShrink: 0
                }}
              >
                <Box>
                  <Typography variant="subtitle2">
                    Effective Attributes ({selectedAssetEffectiveAttributes.length})
                  </Typography>
                </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<RefreshCcw size={16} />}
                    aria-label={`Refresh runtime values for all visible attributes on asset ${selectedAsset.name}`}
                    title={`Refresh runtime values for all visible attributes on asset ${selectedAsset.name}`}
                    onClick={() => void refreshSelectedAssetValues()}
                    disabled={refreshingSelectedAssetValues}
                  >
                    {refreshingSelectedAssetValues ? "Refreshing..." : "Refresh Visible Values"}
                  </Button>
              </Box>

                <DebouncedSearchField
                  fullWidth
                  placeholder="Search effective attributes"
                  initialValue={attributeSearch}
                  onCommit={setAttributeSearch}
                  sx={{ flexShrink: 0 }}
                />

                <TableContainer
                  sx={{
                    border: "1px solid #dbe3ef",
                    borderRadius: 1,
                    flex: 1,
                    minHeight: 0,
                    maxHeight: "100%",
                    overflow: "auto",
                    ...scrollBothOverflowSx
                  }}
                  onScroll={(event) => {
                    setAttributeTableScrollTop(event.currentTarget.scrollTop);
                  }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Name</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Value</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Action</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Type</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Unit</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Updated</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Historian</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Source</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleAttributeRows.topSpacerHeight > 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ p: 0, border: 0, height: `${visibleAttributeRows.topSpacerHeight}px` }} />
                        </TableRow>
                      ) : null}
                      {visibleAttributeRows.rows.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell sx={{ fontFamily: "monospace" }}>{row.name}</TableCell>
                          <AttributeValueEditorCells
                            assetId={selectedAsset.id}
                            attributeName={row.name}
                            initialValue={serializeValue(row.value, row)}
                            fullPath={`${selectedAssetPath}.${row.name}`}
                            isRefreshing={
                              refreshingAttributeKeys[`${selectedAssetPath}.${row.name}`] === true ||
                              isAttributeRefreshCoolingDown(`${selectedAssetPath}.${row.name}`)
                            }
                            historianEnabled={row.historianEnabled}
                            onRefresh={() => void refreshSingleAttributeValue(selectedAsset, row.name)}
                            onApply={async (draftValue) => {
                              try {
                                if (!selectedAssetPath) {
                                  throw new Error("Asset path is empty");
                                }
                                const fullPath = `${selectedAssetPath}.${row.name}`;
                                const nextValue =
                                  row.valueType === "custom"
                                    ? parseMaybeJson(draftValue)
                                    : parseByType(row.valueType, draftValue);
                                const res = await fetch(
                                  `${runtimeApiBase}/assets/value/${encodeURIComponent(fullPath)}`,
                                  {
                                    method: "PUT",
                                    headers: { "content-type": "application/json" },
                                    body: JSON.stringify({ value: nextValue })
                                  }
                                );
                                const data = await readJsonLike(res);
                                if (!res.ok) {
                                  throw new Error(String(data.error || `Runtime API error ${res.status}`));
                                }
                                const matched = Number(data.matchedCount ?? data.count ?? 0);
                                if (matched <= 0) {
                                  throw new Error("Runtime did not match any attribute");
                                }
                                const nextMatch = Array.isArray(data.matches) && data.matches.length > 0
                                  ? (data.matches[0] as { value?: unknown; ts?: string })
                                  : null;
                                updateAssetWith(selectedAsset.id, (asset) => ({
                                  ...asset,
                                  attributes: {
                                    ...(asset.attributes || {}),
                                    [row.name]: {
                                      value: nextMatch && Object.prototype.hasOwnProperty.call(nextMatch, "value")
                                        ? nextMatch.value
                                        : nextValue,
                                      ts:
                                        nextMatch && typeof nextMatch.ts === "string" && nextMatch.ts.trim()
                                          ? nextMatch.ts
                                          : new Date().toISOString()
                                    }
                                  }
                                }));
                                showNotice("success", `Applied value for ${fullPath}`);
                              } catch (error) {
                                showNotice(
                                  "error",
                                  `Failed applying ${row.name}: ${
                                    error instanceof Error ? error.message : String(error)
                                  }`
                                );
                                throw error;
                              }
                            }}
                            onDeleteHistorian={
                              row.historianEnabled
                                ? () => {
                                    const fullPath = `${selectedAssetPath}.${row.name}`;
                                    if (
                                      !window.confirm(
                                        `Delete historian records for attribute "${fullPath}"? This cannot be undone.`
                                      )
                                    ) {
                                      return;
                                    }
                                    void deleteHistorianByPath(fullPath);
                                  }
                                : undefined
                            }
                          />
                          <TableCell>{row.valueType}</TableCell>
                          <TableCell>{row.unit || "-"}</TableCell>
                          <TableCell>{formatAttributeTimestamp(row.ts)}</TableCell>
                          <TableCell>{row.historianEnabled ? "enabled" : "-"}</TableCell>
                          <TableCell>{row.source}{row.overridden ? " (override)" : ""}</TableCell>
                        </TableRow>
                      ))}
                      {visibleAttributeRows.bottomSpacerHeight > 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ p: 0, border: 0, height: `${visibleAttributeRows.bottomSpacerHeight}px` }} />
                        </TableRow>
                      ) : null}
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
          <Paper sx={{ p: 1.25, maxHeight: "74vh", ...scrollBothOverflowSx }}>
            <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  addTemplate();
                  showNotice("success", "Template created");
                }}
              >
                Add Template
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => {
                  if (!selectedTemplate) return;
                  if (!window.confirm(`Remove template "${selectedTemplate.name}"?`)) return;
                  const targetName = selectedTemplate.name;
                  removeTemplate(selectedTemplate.id);
                  showNotice("success", `Template "${targetName}" removed`);
                }}
                disabled={!selectedTemplate}
              >
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

          <Paper sx={{ p: 1.25, minHeight: "74vh", ...scrollBothOverflowSx }}>
            {!selectedTemplate ? (
              <Typography variant="body2" color="text.secondary">
                Select a template from the left panel.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                <TextField
                  key={`template-name:${selectedTemplate.id}:${selectedTemplate.name}`}
                  size="small"
                  label="Template Name"
                  defaultValue={selectedTemplate.name}
                  onBlur={(e) => {
                    const committed = e.target.value;
                    if (committed === selectedTemplate.name) return;
                    updateTemplateWith(selectedTemplate.id, (template) => ({ ...template, name: committed }));
                  }}
                  sx={{ maxWidth: 460 }}
                />

                <TableContainer sx={{ border: "1px solid #dbe3ef", borderRadius: 1, ...scrollBothOverflowSx }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Enabled</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 400 }}>Name</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Type</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Default</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Unit</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Historian</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 400 }}>Time Source</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 180 }}>Historian Target</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedTemplate.attributes.map((attribute, idx) => (
                        <TableRow key={`template-attr:${selectedTemplate.id}:${idx}`}>
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
                              fullWidth
                              key={`template-attr-name:${selectedTemplate.id}:${idx}:${attribute.name}`}
                              size="small"
                              defaultValue={attribute.name}
                              onBlur={(e) => {
                                const committed = e.target.value;
                                if (committed === attribute.name) return;
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, name: committed } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" sx={{ minWidth: 130 }}>
                              <Select
                                value={attribute.valueType}
                                disabled={attribute.historianEnabled === true}
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
                              key={`template-attr-default:${selectedTemplate.id}:${idx}:${serializeValue(attribute.default)}`}
                              size="small"
                              defaultValue={serializeValue(attribute.default)}
                              onBlur={(e) => {
                                const committed = e.target.value;
                                const currentSerialized = serializeValue(attribute.default);
                                if (committed === currentSerialized) return;
                                const next = parseByType(attribute.valueType, committed);
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
                              key={`template-attr-unit:${selectedTemplate.id}:${idx}:${attribute.unit ?? ""}`}
                              size="small"
                              defaultValue={attribute.unit ?? ""}
                              onBlur={(e) => {
                                const committed = e.target.value;
                                if (committed === (attribute.unit ?? "")) return;
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, unit: committed } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Checkbox
                              checked={attribute.historianEnabled === true}
                              onChange={(_e, checked) => {
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, historianEnabled: checked } : item
                                  )
                                }));
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              fullWidth
                              key={`template-attr-time-source:${selectedTemplate.id}:${idx}:${attribute.historianTimeSourcePath ?? ""}`}
                              size="small"
                              defaultValue={attribute.historianTimeSourcePath ?? ""}
                              onBlur={(e) => {
                                const committed = e.target.value;
                                if (committed === (attribute.historianTimeSourcePath ?? "")) return;
                                updateTemplateWith(selectedTemplate.id, (template) => ({
                                  ...template,
                                  attributes: template.attributes.map((item, itemIdx) =>
                                    itemIdx === idx ? { ...item, historianTimeSourcePath: committed } : item
                                  )
                                }));
                              }}
                              placeholder="AssetA.Machine1.EventTime"
                              inputProps={{ list: "asset-attribute-paths" }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControl size="small" sx={{ minWidth: 170 }}>
                              <Select
                                value={attribute.historianTargetId || "default"}
                                onChange={(e: SelectChangeEvent<string>) => {
                                  const historianTargetId = e.target.value;
                                  updateTemplateWith(selectedTemplate.id, (template) => ({
                                    ...template,
                                    attributes: template.attributes.map((item, itemIdx) =>
                                      itemIdx === idx ? { ...item, historianTargetId } : item
                                    )
                                  }));
                                }}
                              >
                                {historianTargets.map((target) => (
                                  <MenuItem key={target.id} value={target.id}>
                                    {target.name || target.id}
                                  </MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => {
                                if (attribute.historianEnabled === true) {
                                  if (
                                    !window.confirm(
                                      `Delete historian records for all assets inheriting "${attribute.name}" from template "${selectedTemplate.name}"? This cannot be undone.`
                                    )
                                  ) {
                                    return;
                                  }
                                  void deleteHistorianByTemplateAttribute(selectedTemplate.id, attribute.name);
                                  return;
                                }
                              }}
                              disabled={attribute.historianEnabled !== true}
                            >
                              Delete Historian
                            </Button>
                              <Button
                                size="small"
                                color="error"
                                onClick={() => {
                                  if (!window.confirm(`Remove template attribute "${attribute.name}"?`)) return;
                                  updateTemplateWith(selectedTemplate.id, (template) => ({
                                    ...template,
                                    attributes: template.attributes.filter((_item, itemIdx) => itemIdx !== idx)
                                  }));
                                  showNotice("success", `Template attribute "${attribute.name}" removed`);
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
                          valueType: "float64",
                          default: 0,
                          unit: "",
                          historianEnabled: false,
                          historianTimeSourcePath: "",
                          historianTargetId: "default"
                        }
                      ]
                    }));
                    showNotice("success", "Template attribute added");
                  }}
                >
                  Add Attribute
                </Button>
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {mainTab === 2 && (
        <AssetManagerHistorianTab
          assetAttributePaths={assetAttributePaths}
          historianTargets={historianTargets}
          queryAgg={queryAgg}
          queryBucketMs={queryBucketMs}
          queryError={queryError}
          queryFrom={queryFrom}
          queryLimit={queryLimit}
          queryLoading={queryLoading}
          queryMode={queryMode}
          queryOrder={queryOrder}
          queryPath={queryPath}
          queryResult={queryResult}
          queryTime={queryTime}
          queryTo={queryTo}
          onAddHistorian={() => {
            const next: HistorianTargetDefinition = {
              id: `hist_${Date.now()}`,
              name: `Historian ${historianTargets.length + 1}`,
              timestampUnit: "us",
              enabled: true
            };
            updateHistorians([...historianTargets, next]);
            showNotice("success", `Historian target "${next.name}" created`);
          }}
          onOpenMonitor={(target) => {
            void openMonitor(target);
          }}
          onRemoveHistorian={(idx) => {
            const target = historianTargets[idx];
            if (!target) return;
            if (target.id === "default") {
              showNotice("error", "default historian cannot be removed");
              return;
            }
            if (!window.confirm(`Remove historian target "${target.name}"?`)) return;
            updateHistorians(historianTargets.filter((_item, itemIdx) => itemIdx !== idx));
            showNotice("success", `Historian target "${target.name}" removed`);
          }}
          onRunQuery={() => {
            void runQueryTester();
          }}
          onSetHistorianEnabled={(idx, enabled) =>
            updateHistorians(historianTargets.map((item, itemIdx) => (itemIdx === idx ? { ...item, enabled } : item)))
          }
          onSetHistorianId={(idx, id) =>
            updateHistorians(historianTargets.map((item, itemIdx) => (itemIdx === idx ? { ...item, id } : item)))
          }
          onSetHistorianName={(idx, name) =>
            updateHistorians(historianTargets.map((item, itemIdx) => (itemIdx === idx ? { ...item, name } : item)))
          }
          onSetHistorianTimestampUnit={(idx, unit) =>
            updateHistorians(
              historianTargets.map((item, itemIdx) => (itemIdx === idx ? { ...item, timestampUnit: unit } : item))
            )
          }
          onSetQueryAgg={setQueryAgg}
          onSetQueryBucketMs={setQueryBucketMs}
          onSetQueryFrom={setQueryFrom}
          onSetQueryLimit={setQueryLimit}
          onSetQueryMode={setQueryMode}
          onSetQueryOrder={setQueryOrder}
          onSetQueryPath={setQueryPath}
          onSetQueryTime={setQueryTime}
          onSetQueryTo={setQueryTo}
          serializeValue={(value) => serializeValue(value)}
        />
      )}
    </Box>
    <datalist id="asset-attribute-paths">
      {assetAttributePaths.map((path) => (
        <option key={`asset-attr-path:${path}`} value={path} />
      ))}
    </datalist>
    <Dialog open={monitorOpen} onClose={() => setMonitorOpen(false)} maxWidth="lg" fullWidth>
      <DialogTitle>
        Historian Monitor
        {monitorTarget ? ` - ${monitorTarget.name || monitorTarget.id}` : ""}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1.25 }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Log Type</InputLabel>
            <Select
              label="Log Type"
              value={monitorLogsKind}
              onChange={(e: SelectChangeEvent<MonitorLogsKind>) =>
                setMonitorLogsKind(e.target.value as MonitorLogsKind)
              }
            >
              <MenuItem value="">all</MenuItem>
              <MenuItem value="system">system</MenuItem>
              <MenuItem value="ingest">ingest</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            type="number"
            label="Log Limit"
            value={monitorLogsLimit}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              if (!Number.isFinite(next)) {
                setMonitorLogsLimit(50);
                return;
              }
              setMonitorLogsLimit(Math.max(1, Math.min(5000, next)));
            }}
            sx={{ width: 130 }}
          />
          <Button
            variant="contained"
            size="small"
            disabled={monitorLoading || !monitorTarget}
            onClick={() => {
              if (!monitorTarget) return;
              void loadMonitorData(monitorTarget, monitorLogsKind, monitorLogsLimit);
            }}
          >
            {monitorLoading ? "Loading..." : "Refresh"}
          </Button>
        </Box>

        {monitorError ? (
          <Alert severity="error" sx={{ mb: 1 }}>
            {monitorError}
          </Alert>
        ) : null}

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
          <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
              Metrics
            </Typography>
            {!monitorMetrics ? (
              <Typography variant="body2" color="text.secondary">
                No metrics loaded.
              </Typography>
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
                {Object.entries(monitorMetrics).map(([section, value]) => (
                  <Paper key={`metric-section:${section}`} sx={{ p: 0.75, border: "1px solid #edf1f7" }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {section}
                    </Typography>
                    {value && typeof value === "object" ? (
                      <Box sx={{ mt: 0.5 }}>
                        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
                          <Typography key={`metric-${section}-${k}`} variant="caption" sx={{ display: "block" }}>
                            {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                          </Typography>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                        {String(value)}
                      </Typography>
                    )}
                  </Paper>
                ))}
              </Box>
            )}
          </Paper>

          <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
              Logs ({monitorLogs.length})
            </Typography>
            <Box sx={{ maxHeight: 420, ...scrollBothOverflowSx, border: "1px solid #edf1f7", borderRadius: 1 }}>
              {monitorLogs.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                  No logs found.
                </Typography>
              ) : (
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ minWidth: 160 }}>time</TableCell>
                      <TableCell sx={{ minWidth: 80 }}>level</TableCell>
                      <TableCell>message</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {monitorLogs.map((log, idx) => (
                      <TableRow key={`monitor-log:${idx}`}>
                        <TableCell sx={{ fontFamily: "monospace" }}>
                          {String(log.ts || log.time || "-")}
                        </TableCell>
                        <TableCell>{String(log.level || "-")}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                          {String(log.msg || log.message || JSON.stringify(log))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Paper>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setMonitorOpen(false)}>Close</Button>
      </DialogActions>
    </Dialog>
    <Snackbar
      open={notice.open}
      autoHideDuration={2400}
      onClose={() => setNotice((prev) => ({ ...prev, open: false }))}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
    >
      <Alert
        onClose={() => setNotice((prev) => ({ ...prev, open: false }))}
        severity={notice.kind}
        variant="filled"
        sx={{ width: "100%" }}
      >
        {notice.message}
      </Alert>
    </Snackbar>
    </>
  );
}

