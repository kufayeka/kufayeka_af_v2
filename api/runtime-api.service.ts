import { Inject, Injectable } from "@nestjs/common";
import type Runtime from "../runtime/Runtime";
import {
  closeEventFromTemplate,
  closeEventsWithAutoCapture,
  openEventFromTemplate
} from "../runtime/event/template/EventTemplateExports";
import { computeTagID } from "../runtime/historian/HistorianBridgeFactory";
import type { DbConnectionManager } from "../runtime/db/dbConnectionManager";
import type {
  AssetStore,
  AttributeQueryMatch,
  EventStore,
  EventTemplateDefinition,
  HistorianTarget
} from "../runtime/core/runtimeTypes";
import { RUNTIME_INSTANCE } from "./runtime-api.constants";
import { getErrorMessage } from "./runtime-api.utils";

type HistorianStore = {
  queryRaw: (
    paths: string[],
    options: {
      from?: string;
      to?: string;
      order?: "asc" | "desc";
      time?: "iso" | "epoch";
      limit?: number;
      timestampUnit?: "us" | "ns";
    }
  ) => Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }>;
  queryRange: (
    paths: string[],
    options: {
      from?: string;
      to?: string;
      order?: "asc" | "desc";
      time?: "iso" | "epoch";
      limit?: number;
      bucketMs?: number;
      agg?: string;
      timestampUnit?: "us" | "ns";
    }
  ) => Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }>;
  queryLast: (
    paths: string[],
    options: { time?: "iso" | "epoch"; timestampUnit?: "us" | "ns" }
  ) => Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }>;
  queryFirst: (
    paths: string[],
    options: {
      from?: string;
      to?: string;
      time?: "iso" | "epoch";
      timestampUnit?: "us" | "ns";
    }
  ) => Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }>;
  deleteByPaths: (paths: string[], from?: string, to?: string) => Promise<{ deletedRecords: number; touchedSegments: number }>;
  getMetrics: () => Record<string, unknown>;
  getLogs: (kind?: string, limit?: number) => Array<Record<string, unknown>>;
};

export type ResolvedPathMatch = {
  path: string;
  assetId: string;
  attributeName: string;
  tagId: number;
  historianTargetId: string;
  type: string;
  unit: string;
  latestValue: unknown;
  latestTs: string | null;
  historianEnabled: boolean;
  historianTimeSourcePath: string;
};

@Injectable()
export class RuntimeApiService {
  readonly assetStore: AssetStore;
  readonly eventStore: EventStore;
  readonly eventTemplateMap: Map<string, EventTemplateDefinition>;
  readonly historianStore: HistorianStore | null;
  readonly dbConnectionManager: DbConnectionManager | null;

  constructor(@Inject(RUNTIME_INSTANCE) private readonly runtime: Runtime) {
    const composition = runtime.getProgramComposition();
    if (!composition) {
      throw new Error("Runtime program composition is not initialized");
    }
    this.assetStore = composition.assetStore;
    this.eventStore = composition.eventStore;
    this.eventTemplateMap = composition.eventTemplatesById;
    this.historianStore = runtime.getGlobal<HistorianStore | null>("historianStore", null);
    this.dbConnectionManager = composition.dbConnectionManager;
  }

  getRuntime(): Runtime {
    return this.runtime;
  }

  flushGlobalPersistence(): void {
    const persistence = this.runtime.getGlobal<{ flushNow?: () => Promise<void> | void } | undefined>("__runtime.globalValuePersistence");
    if (persistence?.flushNow) void persistence.flushNow();
  }

  resolveHistorianTargetById(targetId: string): HistorianTarget {
    const state = this.assetStore.getState();
    const list = Array.isArray(state.historians) ? state.historians : [];
    const found = list.find((h) => h && h.id === targetId);
    if (found) return found;
    return {
      id: "default",
      name: "Default Historian",
      timestampUnit: "us",
      enabled: true
    };
  }

  parsePathList(pathQueryRaw: string): string[] {
    return String(pathQueryRaw || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  resolvePathMatches(pathQuery: string): ResolvedPathMatch[] {
    return this.assetStore
      .query(pathQuery)
      .filter((item): item is AttributeQueryMatch => item.kind === "attribute")
      .map((item) => ({
        path: item.path,
        assetId: item.assetId,
        attributeName: item.attributeName,
        tagId: computeTagID(item.assetId, item.attributeName),
        historianTargetId: item.historianTargetId || "default",
        type: item.type || "custom",
        unit: item.unit || "",
        latestValue: Object.prototype.hasOwnProperty.call(item, "value") ? item.value : null,
        latestTs: item.ts || null,
        historianEnabled: item.historianEnabled === true,
        historianTimeSourcePath: item.historianTimeSourcePath || ""
      }));
  }

  async getEventRange(
    pattern = "*",
    from = "*",
    to = "*",
    status = "*",
    contextFilters: Record<string, unknown> = {},
    options: Record<string, unknown> = {}
  ): Promise<{ start_ts: string | null; end_ts: string | null; count: number }> {
    const rows = await this.eventStore.get(pattern, from, to, status, contextFilters, {
      limit: 5000,
      ...(options || {})
    });
    if (rows.length === 0) {
      return { start_ts: null, end_ts: null, count: 0 };
    }

    let earliestMs: number | null = null;
    let earliestTs: string | null = null;
    let latestMs: number | null = null;
    let latestTs: string | null = null;
    const nowIso = new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    for (const row of rows) {
      const startRaw = String(row.start_ts || "").trim();
      const startMs = startRaw ? Date.parse(startRaw) : Number.NaN;
      if (Number.isFinite(startMs) && (earliestMs == null || startMs < earliestMs)) {
        earliestMs = startMs;
        earliestTs = new Date(startMs).toISOString();
      }

      const endRaw = String(row.end_ts || "").trim();
      const endMs = endRaw ? Date.parse(endRaw) : nowMs;
      if (Number.isFinite(endMs) && (latestMs == null || endMs > latestMs)) {
        latestMs = endMs;
        latestTs = endRaw ? new Date(endMs).toISOString() : nowIso;
      }
    }

    return {
      start_ts: earliestTs,
      end_ts: latestTs,
      count: rows.length
    };
  }

  async historianByPath(
    kind: "raw" | "range" | "last" | "first",
    params: {
      pathQueryRaw: string;
      time?: string;
      order?: string;
      from?: string;
      to?: string;
      limit?: number;
      bucketMs?: number;
      agg?: string;
    }
  ): Promise<{ status: number; body: unknown }> {
    const pathQueries = this.parsePathList(params.pathQueryRaw || "");
    if (pathQueries.length === 0) {
      return { status: 400, body: { error: "Query parameter 'path' is required" } };
    }

    const allMatches: ResolvedPathMatch[] = [];
    for (const pathQuery of pathQueries) {
      for (const item of this.resolvePathMatches(pathQuery)) allMatches.push(item);
    }

    const seen = new Set<string>();
    const matches: ResolvedPathMatch[] = [];
    for (const item of allMatches) {
      const key = `${item.assetId}:${item.attributeName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(item);
    }

    if (matches.length === 0) {
      return {
        status: 404,
        body: { error: "No matching attribute path", path: params.pathQueryRaw, paths: pathQueries, matches: [] }
      };
    }

    const targetIds = matches
      .map((m) => String(m.historianTargetId || "default"))
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (targetIds.length > 1) {
      return {
        status: 400,
        body: {
          error: "Path matched multiple historian targets; query one target/path per request",
          targetIds,
          matches
        }
      };
    }

    const target = this.resolveHistorianTargetById(targetIds[0] || "default");
    if (!this.historianStore) {
      return { status: 503, body: { error: "Historian backend is not initialized" } };
    }

    const paths = matches.map((item) => item.path);
    const time = params.time;
    const order = params.order;
    const from = params.from;
    const to = params.to;
    const limit = Number(params.limit || 1000);
    const bucketMs = Number(params.bucketMs || 0);
    const agg = params.agg || undefined;
    let result: { rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string };

    try {
      if (kind === "raw") {
        result = await this.historianStore.queryRaw(paths, {
          from,
          to,
          order: order === "asc" ? "asc" : "desc",
          time: time === "epoch" ? "epoch" : "iso",
          limit,
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      } else if (kind === "range") {
        result = await this.historianStore.queryRange(paths, {
          from,
          to,
          order: order === "asc" ? "asc" : "desc",
          time: time === "epoch" ? "epoch" : "iso",
          limit,
          bucketMs: Number.isFinite(bucketMs) && bucketMs > 0 ? bucketMs : undefined,
          agg,
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      } else if (kind === "last") {
        result = await this.historianStore.queryLast(paths, {
          time: time === "epoch" ? "epoch" : "iso",
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      } else {
        result = await this.historianStore.queryFirst(paths, {
          from,
          to,
          time: time === "epoch" ? "epoch" : "iso",
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      }
    } catch (error: unknown) {
      return { status: 400, body: { error: getErrorMessage(error) } };
    }

    return {
      status: 200,
      body: {
        path: params.pathQueryRaw,
        paths: pathQueries,
        matches,
        rows: result.rows,
        truncated: result.truncated === true,
        agg: result.agg,
        historianTargetId: target.id || "default"
      }
    };
  }

  async historianDeleteByMatches(
    matches: ResolvedPathMatch[],
    params: { from?: string; to?: string }
  ): Promise<{ status: number; body: unknown }> {
    const targetIds = matches
      .map((m) => String(m.historianTargetId || "default"))
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (targetIds.length > 1) {
      return {
        status: 400,
        body: { error: "Delete supports one historian target per request", targetIds, matches }
      };
    }
    const target = this.resolveHistorianTargetById(targetIds[0] || "default");
    if (!this.historianStore) {
      return { status: 503, body: { error: "Historian backend is not initialized" } };
    }
    const uniquePaths = matches.map((item) => item.path).filter((v, i, arr) => arr.indexOf(v) === i);
    if (uniquePaths.length === 0) {
      return { status: 404, body: { error: "No matching historian paths", matches: [] } };
    }
    let deletedRecords = 0;
    let touchedSegments = 0;
    try {
      const result = await this.historianStore.deleteByPaths(uniquePaths, params.from, params.to);
      deletedRecords = result.deletedRecords;
      touchedSegments = result.touchedSegments;
    } catch (error: unknown) {
      return { status: 400, body: { error: getErrorMessage(error) } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        message: "historian has been deleted",
        deletedRecords,
        touchedSegments,
        historianTargetId: target.id || "default",
        matches
      }
    };
  }

  openEventFromTemplate = openEventFromTemplate;
  closeEventFromTemplate = closeEventFromTemplate;
  closeEventsWithAutoCapture = closeEventsWithAutoCapture;
}
