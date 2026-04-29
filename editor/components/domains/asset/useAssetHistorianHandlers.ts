import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AssetDefinition, HistorianTargetDefinition } from "../../../types/program";
import { getAssetPath } from "./assetManagerUtils";

export type MonitorLogsKind = "system" | "ingest" | "";
export type QueryMode = "raw" | "range" | "last";
export type QueryTimeFmt = "epoch" | "iso";
export type QueryOrder = "asc" | "desc";

export interface MonitorLogEntry {
  ts?: string;
  time?: string;
  level?: string;
  msg?: string;
  message?: string;
  [key: string]: unknown;
}

export interface HistorianQueryMatch {
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

export interface HistorianQueryResponse {
  error?: string;
  path?: string;
  paths?: string[];
  matches?: HistorianQueryMatch[];
  rows?: Array<Record<string, unknown>>;
  truncated?: boolean;
  agg?: string;
  historianTargetId?: string;
}

interface UseAssetHistorianHandlersArgs {
  runtimeApiBase: string;
  assetById: Map<string, AssetDefinition>;
  showNotice: (kind: "success" | "error", message: string) => void;
  updateAssetWith: (assetId: string, updater: (asset: AssetDefinition) => AssetDefinition) => void;
  selectedAsset?: AssetDefinition;
  selectedAssetPath: string;
  selectedAssetEffectiveAttributes: Array<{ name: string }>;
  attributeRefreshCooldownRef: MutableRefObject<Record<string, number>>;
  assetRefreshCooldownRef: MutableRefObject<Record<string, number>>;
  setRefreshingAttributeKeys: Dispatch<SetStateAction<Record<string, boolean>>>;
  setRefreshingSelectedAssetValues: Dispatch<SetStateAction<boolean>>;
  setMonitorTarget: Dispatch<SetStateAction<HistorianTargetDefinition | null>>;
  setMonitorOpen: Dispatch<SetStateAction<boolean>>;
  setMonitorLoading: Dispatch<SetStateAction<boolean>>;
  setMonitorError: Dispatch<SetStateAction<string>>;
  setMonitorMetrics: Dispatch<SetStateAction<Record<string, unknown> | null>>;
  setMonitorLogs: Dispatch<SetStateAction<MonitorLogEntry[]>>;
  monitorLogsKind: MonitorLogsKind;
  monitorLogsLimit: number;
  queryPath: string;
  queryTime: QueryTimeFmt;
  queryMode: QueryMode;
  queryFrom: string;
  queryTo: string;
  queryOrder: QueryOrder;
  queryLimit: string;
  queryBucketMs: string;
  queryAgg: string;
  setQueryLoading: Dispatch<SetStateAction<boolean>>;
  setQueryError: Dispatch<SetStateAction<string>>;
  setQueryResult: Dispatch<SetStateAction<HistorianQueryResponse | null>>;
}

export function useAssetHistorianHandlers({
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
}: UseAssetHistorianHandlersArgs) {
  const isAttributeRefreshCoolingDown = (path: string): boolean => {
    const until = attributeRefreshCooldownRef.current[path] || 0;
    return until > Date.now();
  };

  const markAttributeRefreshCooldown = (path: string, delayMs = 1200): void => {
    attributeRefreshCooldownRef.current[path] = Date.now() + delayMs;
  };

  const isAssetRefreshCoolingDown = (assetId: string): boolean => {
    const until = assetRefreshCooldownRef.current[assetId] || 0;
    return until > Date.now();
  };

  const markAssetRefreshCooldown = (assetId: string, delayMs = 1500): void => {
    assetRefreshCooldownRef.current[assetId] = Date.now() + delayMs;
  };

  const syncSelectedAssetAttribute = (assetId: string, attributeName: string, value: unknown, ts?: string) => {
    updateAssetWith(assetId, (asset) => ({
      ...asset,
      attributes: {
        ...(asset.attributes || {}),
        [attributeName]: {
          value,
          ts: ts && ts.trim() ? ts : new Date().toISOString()
        }
      }
    }));
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

  const refreshSingleAttributeValue = async (asset: AssetDefinition, attributeName: string): Promise<void> => {
    const assetPath = getAssetPath(asset, assetById);
    const fullPath = `${assetPath}.${attributeName}`;
    if (isAttributeRefreshCoolingDown(fullPath)) return;
    markAttributeRefreshCooldown(fullPath);
    setRefreshingAttributeKeys((prev) => ({ ...prev, [fullPath]: true }));
    try {
      const res = await fetch(`${runtimeApiBase}/assets/value/${encodeURIComponent(fullPath)}`);
      const data = await readJsonLike(res);
      if (!res.ok) throw new Error(String(data.error || `Runtime API error ${res.status}`));
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const match = matches.find(
        (item) =>
          item &&
          typeof item === "object" &&
          String((item as { assetId?: unknown }).assetId || "") === asset.id &&
          String((item as { attributeName?: unknown }).attributeName || "") === attributeName
      ) as { value?: unknown; ts?: string } | undefined;
      if (!match) throw new Error("Runtime did not return the requested attribute");
      syncSelectedAssetAttribute(asset.id, attributeName, match.value, match.ts);
      showNotice("success", `Refreshed ${fullPath}`);
    } catch (error) {
      showNotice("error", `Refresh failed for ${fullPath}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshingAttributeKeys((prev) => {
        const next = { ...prev };
        delete next[fullPath];
        return next;
      });
    }
  };

  const refreshSelectedAssetValues = async (): Promise<void> => {
    if (!selectedAsset || !selectedAssetPath || selectedAssetEffectiveAttributes.length === 0) return;
    if (isAssetRefreshCoolingDown(selectedAsset.id)) return;
    markAssetRefreshCooldown(selectedAsset.id);
    setRefreshingSelectedAssetValues(true);
    try {
      const paths = selectedAssetEffectiveAttributes.map((row) => ({
        name: row.name,
        fullPath: `${selectedAssetPath}.${row.name}`
      }));
      const nextAttributes = { ...(selectedAsset.attributes || {}) };
      let updatedCount = 0;
      for (let index = 0; index < paths.length; index += 8) {
        const chunk = paths.slice(index, index + 8);
        const chunkResults = await Promise.all(
          chunk.map(async (item) => {
            const res = await fetch(`${runtimeApiBase}/assets/value/${encodeURIComponent(item.fullPath)}`);
            const data = await readJsonLike(res);
            if (!res.ok) throw new Error(String(data.error || `Runtime API error ${res.status}`));
            const matches = Array.isArray(data.matches) ? data.matches : [];
            const match = matches.find(
              (entry) =>
                entry &&
                typeof entry === "object" &&
                String((entry as { assetId?: unknown }).assetId || "") === selectedAsset.id &&
                String((entry as { attributeName?: unknown }).attributeName || "") === item.name
            ) as { value?: unknown; ts?: string } | undefined;
            return { item, match };
          })
        );

        for (const result of chunkResults) {
          if (!result.match) continue;
          nextAttributes[result.item.name] = {
            value: Object.prototype.hasOwnProperty.call(result.match, "value") ? result.match.value : null,
            ts:
              typeof result.match.ts === "string" && result.match.ts.trim()
                ? result.match.ts
                : new Date().toISOString()
          };
          updatedCount += 1;
        }
      }
      updateAssetWith(selectedAsset.id, (asset) => ({
        ...asset,
        attributes: nextAttributes
      }));
      showNotice("success", `Refreshed ${updatedCount} attributes for "${selectedAsset.name}"`);
    } catch (error) {
      showNotice("error", `Bulk refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRefreshingSelectedAssetValues(false);
    }
  };

  const loadMonitorData = async (target: HistorianTargetDefinition, kind: MonitorLogsKind, limit: number) => {
    setMonitorLoading(true);
    setMonitorError("");
    try {
      const [metricsRes, logsRes] = await Promise.all([
        fetch(`${runtimeApiBase}/historian/target-metrics?targetId=${encodeURIComponent(target.id)}`),
        fetch(
          `${runtimeApiBase}/historian/target-logs?targetId=${encodeURIComponent(target.id)}&kind=${encodeURIComponent(
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
      const res = await fetch(`${runtimeApiBase}/historian/${queryMode}?${params.toString()}`);
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
      const res = await fetch(`${runtimeApiBase}/historian/delete-attribute?path=${encodeURIComponent(path)}`, {
        method: "DELETE"
      });
      const json = (await readJsonLike(res)) as { error?: string; message?: string; deletedRecords?: number };
      if (!res.ok) {
        showNotice("error", json.error || "Failed deleting historian records");
        return;
      }
      showNotice("success", `${json.message || "historian has been deleted"} (${json.deletedRecords ?? 0} records)`);
    } catch (error) {
      showNotice("error", `Failed deleting historian records: ${(error as Error).message}`);
    }
  };

  const deleteHistorianByTemplateAttribute = async (templateId: string, attributeName: string) => {
    try {
      const res = await fetch(
        `${runtimeApiBase}/historian/delete-template-attribute?templateId=${encodeURIComponent(templateId)}&attributeName=${encodeURIComponent(attributeName)}`,
        { method: "DELETE" }
      );
      const json = (await readJsonLike(res)) as { error?: string; message?: string; deletedRecords?: number };
      if (!res.ok) {
        showNotice("error", json.error || "Failed deleting inherited historian records");
        return;
      }
      showNotice("success", `${json.message || "historian has been deleted"} (${json.deletedRecords ?? 0} records)`);
    } catch (error) {
      showNotice("error", `Failed deleting inherited historian records: ${(error as Error).message}`);
    }
  };

  return {
    deleteHistorianByPath,
    deleteHistorianByTemplateAttribute,
    openMonitor,
    refreshSelectedAssetValues,
    refreshSingleAttributeValue,
    runQueryTester,
    loadMonitorData,
    readJsonLike
  };
}
