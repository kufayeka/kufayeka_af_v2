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
  Typography
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2, RefreshCcw } from "lucide-react";
import { normalizeProgram } from "../../lib/programUtils";
import type {
  AssetAttributeType,
  AssetDefinition,
  AssetFrameworkDefinition,
  HistorianTargetDefinition,
  Program
} from "../../types/program";

const ATTRIBUTE_TYPES: AssetAttributeType[] = [
  "int8",
  "uint8",
  "int16",
  "uint16",
  "int32",
  "uint32",
  "float32",
  "float64",
  "boolean",
  "string",
  "array",
  "object"
];

const DEFAULT_HISTORIAN_TARGET: HistorianTargetDefinition = {
  id: "default",
  name: "Default Historian",
  udpHost: "127.0.0.1",
  udpPort: 9900,
  httpBaseUrl: "http://127.0.0.1:8080",
  timestampUnit: "us",
  enabled: true
};

interface EffectiveAttributeRow {
  name: string;
  valueType: AssetAttributeType | "custom";
  unit: string;
  value: unknown;
  source: string;
  overridden: boolean;
  historianEnabled: boolean;
}

interface AssetManagerProps {
  assets: AssetFrameworkDefinition;
  onChange: (
    updater:
      | AssetFrameworkDefinition
      | ((assets: AssetFrameworkDefinition) => AssetFrameworkDefinition)
  ) => void;
}

type MonitorLogsKind = "system" | "ingest" | "";

interface MonitorLogEntry {
  ts?: string;
  time?: string;
  level?: string;
  msg?: string;
  message?: string;
  [key: string]: unknown;
}

type QueryMode = "raw" | "range" | "last";
type QueryTimeFmt = "epoch" | "iso";
type QueryOrder = "asc" | "desc";

interface HistorianQueryMatch {
  path: string;
  assetId: string;
  attributeName: string;
  tagId: number;
  historianTargetId?: string;
  type?: string;
  unit?: string;
  latestValue?: unknown;
  latestTs?: string | null;
  historianEnabled?: boolean;
  historianTimeSourcePath?: string;
}

interface HistorianQueryResponse {
  error?: string;
  path?: string;
  paths?: string[];
  matches?: HistorianQueryMatch[];
  rows?: Array<Record<string, unknown>>;
  truncated?: boolean;
  agg?: string;
  historianTargetId?: string;
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
  if (
    type === "int8" ||
    type === "uint8" ||
    type === "int16" ||
    type === "uint16" ||
    type === "int32" ||
    type === "uint32"
  ) {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === "float32" || type === "float64") {
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
          overridden: false,
          historianEnabled: attr.historianEnabled === true
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
        overridden: true,
        historianEnabled: false
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
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
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
  const fieldTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const runtimeApiBase = useMemo(() => {
    if (process.env.NEXT_PUBLIC_RUNTIME_API_BASE) return process.env.NEXT_PUBLIC_RUNTIME_API_BASE;
    if (typeof window !== "undefined") {
      return `${window.location.protocol}//${window.location.hostname}:4000`;
    }
    return "http://127.0.0.1:4000";
  }, []);

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

  const getDraft = (fieldKey: string, source: string): string =>
    Object.prototype.hasOwnProperty.call(fieldDrafts, fieldKey) ? fieldDrafts[fieldKey] : source;

  const scheduleDraftCommit = (fieldKey: string, next: string, commit: (value: string) => void) => {
    setFieldDrafts((prev) => ({ ...prev, [fieldKey]: next }));
    const existing = fieldTimersRef.current[fieldKey];
    if (existing) clearTimeout(existing);
    fieldTimersRef.current[fieldKey] = setTimeout(() => {
      commit(next);
      setFieldDrafts((prev) => {
        const cloned = { ...prev };
        delete cloned[fieldKey];
        return cloned;
      });
      delete fieldTimersRef.current[fieldKey];
    }, 350);
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

  useEffect(() => {
    return () => {
      for (const timer of Object.values(fieldTimersRef.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  const selectedAssetEffectiveAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);
  const assetAttributePaths = useMemo(() => {
    const options: string[] = [];
    for (const asset of assets.assets) {
      const basePath = getAssetPath(asset, assetById);
      const names = new Set<string>();
      for (const templateId of asset.templateIds) {
        const template = templateById.get(templateId);
        if (!template) continue;
        for (const attribute of template.attributes) {
          if (attribute.enabled === false) continue;
          names.add(attribute.name);
        }
      }
      for (const name of Object.keys(asset.attributes || {})) {
        names.add(name);
      }
      for (const name of names) {
        options.push(`${basePath}.${name}`);
      }
    }
    options.sort((a, b) => a.localeCompare(b));
    return options;
  }, [assetById, assets.assets, templateById]);

  useEffect(() => {
    if (queryPath.trim()) return;
    if (assetAttributePaths.length === 0) return;
    setQueryPath(assetAttributePaths[0]);
  }, [assetAttributePaths, queryPath]);

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
      showNotice("success", `Reloaded ${normalized.assets.assets.length} assets from runtime`);
    } catch (error) {
      showNotice("error", `Reload failed: ${(error instanceof Error ? error.message : String(error))}`);
    } finally {
      setLoadingRuntime(false);
    }
  };

  const showNotice = (kind: "success" | "error", message: string) => {
    setNotice({ open: true, kind, message });
  };

  const readJsonLike = async (res: Response): Promise<Record<string, unknown>> => {
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: `Non-JSON response (${res.status})` };
    }
  };

  const toLogEntries = (payload: Record<string, unknown>): MonitorLogEntry[] => {
    const items = payload.items;
    if (Array.isArray(items)) {
      return items.filter((item) => item && typeof item === "object") as MonitorLogEntry[];
    }
    const direct = payload.logs;
    if (Array.isArray(direct)) {
      return direct.filter((item) => item && typeof item === "object") as MonitorLogEntry[];
    }
    if (direct && typeof direct === "object") {
      const byKind = direct as Record<string, unknown>;
      const merged: MonitorLogEntry[] = [];
      for (const value of Object.values(byKind)) {
        if (!Array.isArray(value)) continue;
        merged.push(...(value.filter((item) => item && typeof item === "object") as MonitorLogEntry[]));
      }
      return merged;
    }
    return [];
  };

  const loadMonitorData = async (
    target: HistorianTargetDefinition,
    kind: MonitorLogsKind,
    limit: number
  ) => {
    setMonitorLoading(true);
    setMonitorError("");
    try {
      const [metricsRes, logsRes] = await Promise.all([
        fetch(`${runtimeApiBase}/api/historian/target-metrics?targetId=${encodeURIComponent(target.id)}`),
        fetch(
          `${runtimeApiBase}/api/historian/target-logs?targetId=${encodeURIComponent(target.id)}&kind=${encodeURIComponent(
            kind
          )}&limit=${encodeURIComponent(String(limit))}`
        )
      ]);
      const metricsJson = await readJsonLike(metricsRes);
      const logsJson = await readJsonLike(logsRes);
      if (!metricsRes.ok) {
        setMonitorError(String(metricsJson.error || `Metrics request failed (${metricsRes.status})`));
      }
      if (!logsRes.ok) {
        setMonitorError((prev) =>
          prev
            ? `${prev}; ${String(logsJson.error || `Logs request failed (${logsRes.status})`)}`
            : String(logsJson.error || `Logs request failed (${logsRes.status})`)
        );
      }
      setMonitorMetrics(metricsJson);
      setMonitorLogs(toLogEntries(logsJson));
    } catch (error) {
      setMonitorError(`Monitor request failed: ${(error as Error).message}`);
    } finally {
      setMonitorLoading(false);
    }
  };

  const openMonitor = async (target: HistorianTargetDefinition) => {
    setMonitorTarget(target);
    setMonitorOpen(true);
    await loadMonitorData(target, monitorLogsKind, monitorLogsLimit);
  };

  const runQueryTester = async () => {
    const path = queryPath.trim();
    if (!path) {
      setQueryError("Path is required. You can pass multiple paths separated by commas.");
      return;
    }
    setQueryLoading(true);
    setQueryError("");
    try {
      const params = new URLSearchParams();
      params.set("path", path);
      params.set("time", queryTime);
      if (queryMode !== "last") {
        params.set("from", queryFrom.trim());
        params.set("to", queryTo.trim());
        params.set("order", queryOrder);
      }
      if (queryMode === "raw") {
        params.set("limit", queryLimit.trim() || "1000");
      }
      if (queryMode === "range") {
        params.set("bucketMs", queryBucketMs.trim() || "1000");
        params.set("agg", queryAgg);
      }
      const res = await fetch(`${runtimeApiBase}/api/historian/${queryMode}?${params.toString()}`);
      const json = (await readJsonLike(res)) as HistorianQueryResponse;
      if (!res.ok) {
        setQueryResult(json);
        setQueryError(String(json.error || `Query failed (${res.status})`));
        return;
      }
      setQueryResult(json);
    } catch (error) {
      setQueryError(`Query failed: ${(error as Error).message}`);
    } finally {
      setQueryLoading(false);
    }
  };

  const deleteHistorianByPath = async (path: string) => {
    try {
      const res = await fetch(`${runtimeApiBase}/api/historian/delete-attribute?path=${encodeURIComponent(path)}`, {
        method: "DELETE"
      });
      const json = (await readJsonLike(res)) as {
        error?: string;
        message?: string;
        deletedRecords?: number;
      };
      if (!res.ok) {
        showNotice("error", json.error || "Failed deleting historian records");
        return;
      }
      showNotice(
        "success",
        `${json.message || "historian has been deleted"} (${json.deletedRecords ?? 0} records)`
      );
    } catch (error) {
      showNotice("error", `Failed deleting historian records: ${(error as Error).message}`);
    }
  };

  const deleteHistorianByTemplateAttribute = async (templateId: string, attributeName: string) => {
    try {
      const res = await fetch(
        `${runtimeApiBase}/api/historian/delete-template-attribute?templateId=${encodeURIComponent(templateId)}&attributeName=${encodeURIComponent(attributeName)}`,
        { method: "DELETE" }
      );
      const json = (await readJsonLike(res)) as {
        error?: string;
        message?: string;
        deletedRecords?: number;
      };
      if (!res.ok) {
        showNotice("error", json.error || "Failed deleting inherited historian records");
        return;
      }
      showNotice(
        "success",
        `${json.message || "historian has been deleted"} (${json.deletedRecords ?? 0} records)`
      );
    } catch (error) {
      showNotice("error", `Failed deleting inherited historian records: ${(error as Error).message}`);
    }
  };

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
          <Tab label="Historian Manager" />
        </Tabs>
      </Paper>

      {mainTab === 0 && (
        <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
          <Paper sx={{ p: 1.25, maxHeight: "74vh", overflow: "auto" }}>
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
                Select an asset from the left panel.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>

                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 0.75, mb: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Asset Detail
                  </Typography>
                    
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

                <Box sx={{ display: "flex", gap: 0.75, mb: 1 }}>
                <TextField
                  size="small"
                  label="Asset Name"
                  value={getDraft(`asset-name:${selectedAsset.id}`, selectedAsset.name)}
                  onChange={(e) => {
                    const name = e.target.value;
                    scheduleDraftCommit(`asset-name:${selectedAsset.id}`, name, (committed) => {
                      updateAssetWith(selectedAsset.id, (asset) => ({ ...asset, name: committed }));
                    });
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
                    onClick={() => {
                      refreshAssetTemplateAttributes(selectedAsset.id);
                      showNotice("success", `Attributes refreshed for "${selectedAsset.name}"`);
                    }}
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
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Historian</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>Source</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedAssetEffectiveAttributes.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell sx={{ fontFamily: "monospace" }}>{row.name}</TableCell>
                          <TableCell sx={{ minWidth: 280 }}>
                            {(() => {
                              const fieldKey = `asset-attr:${selectedAsset.id}:${row.name}`;
                              const currentValue = serializeValue(row.value);
                              const draftValue = getDraft(fieldKey, currentValue);
                              return (
                                <TextField
                                  size="small"
                                  fullWidth
                                  value={draftValue}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setFieldDrafts((prev) => ({ ...prev, [fieldKey]: raw }));
                                  }}
                                />
                              );
                            })()}
                          </TableCell>
                          <TableCell>{row.valueType}</TableCell>
                          <TableCell>{row.unit || "-"}</TableCell>
                          <TableCell>{row.historianEnabled ? "enabled" : "-"}</TableCell>
                          <TableCell>{row.source}{row.overridden ? " (override)" : ""}</TableCell>
                          <TableCell>
                            {(() => {
                              const fieldKey = `asset-attr:${selectedAsset.id}:${row.name}`;
                              const currentValue = serializeValue(row.value);
                              const draftValue = getDraft(fieldKey, currentValue);
                              const hasDraft = Object.prototype.hasOwnProperty.call(fieldDrafts, fieldKey);

                              return (
                                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                                  <Button
                                    size="small"
                                    variant="contained"
                                    disabled={!hasDraft}
                                    onClick={() => {
                                      try {
                                        const nextValue =
                                          row.valueType === "custom"
                                            ? parseMaybeJson(draftValue)
                                            : parseByType(row.valueType, draftValue);
                                        updateAssetWith(selectedAsset.id, (asset) => ({
                                          ...asset,
                                          attributes: {
                                            ...asset.attributes,
                                            [row.name]: { value: nextValue }
                                          }
                                        }));
                                        setFieldDrafts((prev) => {
                                          const cloned = { ...prev };
                                          delete cloned[fieldKey];
                                          return cloned;
                                        });
                                        showNotice("success", `Applied value for ${row.name}`);
                                      } catch (error) {
                                        showNotice(
                                          "error",
                                          `Failed applying ${row.name}: ${
                                            error instanceof Error ? error.message : String(error)
                                          }`
                                        );
                                      }
                                    }}
                                  >
                                    Apply
                                  </Button>
                                  {row.historianEnabled ? (
                                    <Button
                                      size="small"
                                      color="error"
                                      variant="outlined"
                                      onClick={() => {
                                        const fullPath = `${selectedAssetPath}.${row.name}`;
                                        if (
                                          !window.confirm(
                                            `Delete historian records for attribute "${fullPath}"? This cannot be undone.`
                                          )
                                        ) {
                                          return;
                                        }
                                        void deleteHistorianByPath(fullPath);
                                      }}
                                    >
                                      Delete Historian
                                    </Button>
                                  ) : null}
                                </Box>
                              );
                            })()}
                          </TableCell>
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

          <Paper sx={{ p: 1.25, minHeight: "74vh", overflow: "auto" }}>
            {!selectedTemplate ? (
              <Typography variant="body2" color="text.secondary">
                Select a template from the left panel.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                <TextField
                  size="small"
                  label="Template Name"
                  value={getDraft(`template-name:${selectedTemplate.id}`, selectedTemplate.name)}
                  onChange={(e) => {
                    const name = e.target.value;
                    scheduleDraftCommit(`template-name:${selectedTemplate.id}`, name, (committed) => {
                      updateTemplateWith(selectedTemplate.id, (template) => ({ ...template, name: committed }));
                    });
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
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 140 }}>Historian</TableCell>
                        <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 260 }}>Time Source</TableCell>
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
                              size="small"
                              value={getDraft(
                                `template-attr-name:${selectedTemplate.id}:${idx}`,
                                attribute.name
                              )}
                              onChange={(e) => {
                                const name = e.target.value;
                                scheduleDraftCommit(
                                  `template-attr-name:${selectedTemplate.id}:${idx}`,
                                  name,
                                  (committed) => {
                                    updateTemplateWith(selectedTemplate.id, (template) => ({
                                      ...template,
                                      attributes: template.attributes.map((item, itemIdx) =>
                                        itemIdx === idx ? { ...item, name: committed } : item
                                      )
                                    }));
                                  }
                                );
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
                              size="small"
                              value={getDraft(
                                `template-attr-default:${selectedTemplate.id}:${idx}`,
                                serializeValue(attribute.default)
                              )}
                              onChange={(e) => {
                                const raw = e.target.value;
                                scheduleDraftCommit(
                                  `template-attr-default:${selectedTemplate.id}:${idx}`,
                                  raw,
                                  (committed) => {
                                    const next = parseByType(attribute.valueType, committed);
                                    updateTemplateWith(selectedTemplate.id, (template) => ({
                                      ...template,
                                      attributes: template.attributes.map((item, itemIdx) =>
                                        itemIdx === idx ? { ...item, default: next } : item
                                      )
                                    }));
                                  }
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={getDraft(
                                `template-attr-unit:${selectedTemplate.id}:${idx}`,
                                attribute.unit ?? ""
                              )}
                              onChange={(e) => {
                                const unit = e.target.value;
                                scheduleDraftCommit(
                                  `template-attr-unit:${selectedTemplate.id}:${idx}`,
                                  unit,
                                  (committed) => {
                                    updateTemplateWith(selectedTemplate.id, (template) => ({
                                      ...template,
                                      attributes: template.attributes.map((item, itemIdx) =>
                                        itemIdx === idx ? { ...item, unit: committed } : item
                                      )
                                    }));
                                  }
                                );
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
                            <Autocomplete
                              freeSolo
                              options={assetAttributePaths}
                              value={getDraft(
                                `template-attr-time-source:${selectedTemplate.id}:${idx}`,
                                attribute.historianTimeSourcePath ?? ""
                              )}
                              onInputChange={(_e, value) => {
                                scheduleDraftCommit(
                                  `template-attr-time-source:${selectedTemplate.id}:${idx}`,
                                  value,
                                  (committed) => {
                                    updateTemplateWith(selectedTemplate.id, (template) => ({
                                      ...template,
                                      attributes: template.attributes.map((item, itemIdx) =>
                                        itemIdx === idx
                                          ? { ...item, historianTimeSourcePath: committed }
                                          : item
                                      )
                                    }));
                                  }
                                );
                              }}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  size="small"
                                  placeholder="AssetA.Machine1.EventTime"
                                />
                              )}
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
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Paper sx={{ p: 1.25, overflow: "auto" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Historian Targets
              </Typography>
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  const next: HistorianTargetDefinition = {
                    id: `hist_${Date.now()}`,
                    name: `Historian ${historianTargets.length + 1}`,
                    udpHost: "127.0.0.1",
                    udpPort: 9900,
                    httpBaseUrl: "http://127.0.0.1:8080",
                    timestampUnit: "us",
                    enabled: true
                  };
                  updateHistorians([...historianTargets, next]);
                  showNotice("success", `Historian target "${next.name}" created`);
                }}
              >
                Add Historian
              </Button>
            </Box>
            <TableContainer sx={{ border: "1px solid #dbe3ef", borderRadius: 1, maxHeight: 340 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 120 }}>ID</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 150 }}>Name</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 130 }}>UDP Host</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 100 }}>UDP Port</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 210 }}>HTTP Base URL</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 90 }}>TS Unit</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 90 }}>Enabled</TableCell>
                    <TableCell sx={{ backgroundColor: "#d0dfdb", minWidth: 220 }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historianTargets.map((target, idx) => (
                    <TableRow key={`hist-target:${target.id}`}>
                      <TableCell>
                        <TextField
                          size="small"
                          value={target.id}
                          disabled={target.id === "default"}
                          onChange={(e) => {
                            const id = e.target.value;
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, id } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={target.name}
                          onChange={(e) => {
                            const name = e.target.value;
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, name } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={target.udpHost}
                          onChange={(e) => {
                            const udpHost = e.target.value;
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, udpHost } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={target.udpPort}
                          onChange={(e) => {
                            const udpPort = Number(e.target.value) || 9900;
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, udpPort } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={target.httpBaseUrl}
                          onChange={(e) => {
                            const httpBaseUrl = e.target.value;
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, httpBaseUrl } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <FormControl size="small" sx={{ minWidth: 90 }}>
                          <Select
                            value={target.timestampUnit}
                            onChange={(e: SelectChangeEvent<"us" | "ns">) => {
                              const timestampUnit = e.target.value as "us" | "ns";
                              updateHistorians(
                                historianTargets.map((item, itemIdx) =>
                                  itemIdx === idx ? { ...item, timestampUnit } : item
                                )
                              );
                            }}
                          >
                            <MenuItem value="us">us</MenuItem>
                            <MenuItem value="ns">ns</MenuItem>
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={target.enabled !== false}
                          onChange={(_e, checked) => {
                            updateHistorians(
                              historianTargets.map((item, itemIdx) =>
                                itemIdx === idx ? { ...item, enabled: checked } : item
                              )
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              void openMonitor(target);
                            }}
                          >
                            Monitor
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => {
                              if (target.id === "default") {
                                showNotice("error", "default historian cannot be removed");
                                return;
                              }
                              if (!window.confirm(`Remove historian target "${target.name}"?`)) return;
                              updateHistorians(historianTargets.filter((_item, itemIdx) => itemIdx !== idx));
                              showNotice("success", `Historian target "${target.name}" removed`);
                            }}
                          >
                            Remove
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ p: 1.25 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Query Tester
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr", gap: 1, mb: 1 }}>
              <FormControl size="small">
                <InputLabel>Mode</InputLabel>
                <Select
                  label="Mode"
                  value={queryMode}
                  onChange={(e: SelectChangeEvent<QueryMode>) => setQueryMode(e.target.value as QueryMode)}
                >
                  <MenuItem value="raw">raw</MenuItem>
                  <MenuItem value="range">range</MenuItem>
                  <MenuItem value="last">last</MenuItem>
                </Select>
              </FormControl>
              <Autocomplete
                freeSolo
                options={assetAttributePaths}
                value={queryPath}
                onInputChange={(_e, value) => setQueryPath(value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Path (single/multi comma-separated)"
                    placeholder="Jasuindo.Taiyo1.Machine Speed,Jasuindo.Taiyo1.Temperature"
                  />
                )}
              />
              <Box sx={{ display: "flex", gap: 1 }}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Order</InputLabel>
                  <Select
                    label="Order"
                    value={queryOrder}
                    onChange={(e: SelectChangeEvent<QueryOrder>) => setQueryOrder(e.target.value as QueryOrder)}
                  >
                    <MenuItem value="asc">asc</MenuItem>
                    <MenuItem value="desc">desc</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Time</InputLabel>
                  <Select
                    label="Time"
                    value={queryTime}
                    onChange={(e: SelectChangeEvent<QueryTimeFmt>) => setQueryTime(e.target.value as QueryTimeFmt)}
                  >
                    <MenuItem value="iso">iso</MenuItem>
                    <MenuItem value="epoch">epoch</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Limit"
                  value={queryLimit}
                  onChange={(e) => setQueryLimit(e.target.value)}
                  disabled={queryMode !== "raw"}
                />
                <TextField
                  size="small"
                  label="Bucket ms"
                  value={queryBucketMs}
                  onChange={(e) => setQueryBucketMs(e.target.value)}
                  disabled={queryMode !== "range"}
                />
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Agg</InputLabel>
                  <Select
                    label="Agg"
                    value={queryAgg}
                    onChange={(e: SelectChangeEvent<string>) => setQueryAgg(e.target.value)}
                    disabled={queryMode !== "range"}
                  >
                    <MenuItem value="min">min</MenuItem>
                    <MenuItem value="max">max</MenuItem>
                    <MenuItem value="avg">avg</MenuItem>
                    <MenuItem value="first">first</MenuItem>
                    <MenuItem value="last">last</MenuItem>
                    <MenuItem value="count">count</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 1, mb: 1 }}>
              <TextField
                size="small"
                label="From (epoch or ISO)"
                value={queryFrom}
                onChange={(e) => setQueryFrom(e.target.value)}
                disabled={queryMode === "last"}
              />
              <TextField
                size="small"
                label="To (epoch or ISO)"
                value={queryTo}
                onChange={(e) => setQueryTo(e.target.value)}
                disabled={queryMode === "last"}
              />
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const end = new Date();
                  const start = new Date(end.getTime() - 15 * 60 * 1000);
                  setQueryFrom(start.toISOString());
                  setQueryTo(end.toISOString());
                }}
              >
                Last 15m
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={queryLoading}
                onClick={() => void runQueryTester()}
              >
                {queryLoading ? "Running..." : "Run Query"}
              </Button>
            </Box>

            {queryError ? (
              <Alert severity="error" sx={{ mb: 1 }}>
                {queryError}
              </Alert>
            ) : null}

            {queryResult ? (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    Attribute Metadata
                  </Typography>
                  <TableContainer sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Path</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>Unit</TableCell>
                          <TableCell>TagID</TableCell>
                          <TableCell>Target</TableCell>
                          <TableCell>Latest</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(queryResult.matches || []).map((m) => (
                          <TableRow key={`query-match:${m.assetId}:${m.attributeName}`}>
                            <TableCell sx={{ fontFamily: "monospace" }}>{m.path}</TableCell>
                            <TableCell>{m.type || "-"}</TableCell>
                            <TableCell>{m.unit || "-"}</TableCell>
                            <TableCell>{m.tagId}</TableCell>
                            <TableCell>{m.historianTargetId || "-"}</TableCell>
                            <TableCell sx={{ fontFamily: "monospace" }}>
                              {m.latestValue == null ? "-" : serializeValue(m.latestValue)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
                <Paper sx={{ p: 1, border: "1px solid #dbe3ef" }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
                    Query Result
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 0.75 }}>
                    <Typography variant="caption">rows: {(queryResult.rows || []).length}</Typography>
                    <Typography variant="caption">truncated: {String(queryResult.truncated === true)}</Typography>
                    <Typography variant="caption">agg: {queryResult.agg || "-"}</Typography>
                    <Typography variant="caption">target: {queryResult.historianTargetId || "-"}</Typography>
                  </Box>
                  <Box
                    sx={{
                      maxHeight: 300,
                      overflow: "auto",
                      border: "1px solid #edf1f7",
                      borderRadius: 1,
                      p: 1,
                      fontFamily: "monospace",
                      fontSize: 12,
                      whiteSpace: "pre-wrap"
                    }}
                  >
                    {JSON.stringify(queryResult.rows || [], null, 2)}
                  </Box>
                </Paper>
              </Box>
            ) : null}
          </Paper>
        </Box>
      )}
    </Box>
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
            <Box sx={{ maxHeight: 420, overflow: "auto", border: "1px solid #edf1f7", borderRadius: 1 }}>
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
