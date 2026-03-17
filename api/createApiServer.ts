import http from "node:http";
import type { Socket } from "node:net";
import express, { Request } from "express";
import Runtime from "../runtime/Runtime";
import { ensureAssetStorage } from "../runtime/assetStorage";
import { ensureEventStore } from "../runtime/eventStore";
import {
  closeEventFromTemplate,
  closeEventsWithAutoCapture,
  normalizeEventTemplates,
  openEventFromTemplate
} from "../runtime/eventTemplateRuntime";
import { computeTagID } from "../runtime/historianBridge";
import {
  filterSerializableGlobalEntries,
  isInternalGlobalKey,
  toSerializableJsonValue
} from "../runtime/globalStoreUtils";
import { OPENAPI_RUNTIME_SPEC } from "./openapiRuntimeSpec";
import type { AttributeQueryMatch, EventTemplateDefinition, HistorianTarget } from "../runtime/types";
import type { DbConnectionManager } from "../runtime/dbConnectionManager";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseFinderExpectedValue(rawValue: string | undefined): unknown {
  if (rawValue == null) return undefined;
  const source = String(rawValue);
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
  if (value == null) return undefined;
  return String(value);
}

function toJsonValueOrNull(value: unknown): unknown | null {
  if (value === undefined) return null;
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function containsObject(source: unknown, expected: unknown): boolean {
  if (!isPlainObject(source) || !isPlainObject(expected)) return false;
  for (const [key, value] of Object.entries(expected)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return false;
    const srcValue = source[key];
    if (isPlainObject(value)) {
      if (!containsObject(srcValue, value)) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (!Array.isArray(srcValue)) return false;
      if (!deepEqual(srcValue, value)) return false;
      continue;
    }
    if (!deepEqual(srcValue, value)) return false;
  }
  return true;
}

function matchAttributeValue(operator: string, actualValue: unknown, expectedValue: unknown): boolean {
  if (operator === "eq") return deepEqual(actualValue, expectedValue);
  if (operator === "neq") return !deepEqual(actualValue, expectedValue);
  if (operator === "contains") {
    if (typeof actualValue === "string") {
      return actualValue.includes(String(expectedValue ?? ""));
    }
    if (Array.isArray(actualValue)) {
      return actualValue.some((item) => deepEqual(item, expectedValue));
    }
    return false;
  }
  if (operator === "contains_object") {
    return containsObject(actualValue, expectedValue);
  }
  return false;
}

async function getEventRangeFromStore(
  eventStore: ReturnType<typeof ensureEventStore>,
  pattern = "*",
  from = "*",
  to = "*",
  status = "*",
  contextFilters: Record<string, unknown> = {},
  options: Record<string, unknown> = {}
): Promise<{ start_ts: string | null; end_ts: string | null; count: number }> {
  const rows = await eventStore.get(pattern, from, to, status, contextFilters, {
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

export default function createApiServer(runtime: Runtime, options: { port?: number; host?: string } = {}) {
  const port = options.port ?? 4000;
  const host = options.host ?? "0.0.0.0";
  const preferredCorsOrigin = "http://192.168.68.99:3333";
  const assetStore = ensureAssetStorage(runtime, runtime.getGlobal("assetFramework", {}));
  const eventStore = ensureEventStore(runtime);
  const eventTemplateMap = new Map<string, EventTemplateDefinition>(
    normalizeEventTemplates(runtime.getGlobal("eventTemplates", [])).map((item) => [item.id, item])
  );
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
  const historianStore = runtime.getGlobal<HistorianStore | null>("historianStore", null);
  const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
  const flushGlobalPersistence = (): void => {
    const persistence = runtime.getGlobal<{ flushNow?: () => Promise<void> | void } | undefined>("__runtime.globalValuePersistence");
    if (persistence?.flushNow) void persistence.flushNow();
  };

  type ResolvedPathMatch = {
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

  const resolveHistorianTargetById = (targetId: string): HistorianTarget => {
    const state = assetStore.getState();
    const list = Array.isArray(state.historians) ? state.historians : [];
    const found = list.find((h) => h && h.id === targetId);
    if (found) return found;
    return {
      id: "default",
      name: "Default Historian",
      timestampUnit: "us",
      enabled: true
    };
  };

  function parsePathList(pathQueryRaw: string): string[] {
    return String(pathQueryRaw || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function resolvePathMatches(pathQuery: string): ResolvedPathMatch[] {
    return assetStore
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

  async function historianByPath(kind: "raw" | "range" | "last" | "first", req: Request): Promise<{ status: number; body: unknown }> {
    const pathQueryRaw = queryString(req, "path") || "";
    const pathQueries = parsePathList(pathQueryRaw);
    if (pathQueries.length === 0) {
      return { status: 400, body: { error: "Query parameter 'path' is required" } };
    }

    const allMatches: ResolvedPathMatch[] = [];
    for (const pathQuery of pathQueries) {
      for (const item of resolvePathMatches(pathQuery)) allMatches.push(item);
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
        body: { error: "No matching attribute path", path: pathQueryRaw, paths: pathQueries, matches: [] }
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
    const target = resolveHistorianTargetById(targetIds[0] || "default");
    if (!historianStore) {
      return { status: 503, body: { error: "Historian backend is not initialized" } };
    }
    const paths = matches.map((item) => item.path);
    const time = queryString(req, "time");
    const order = queryString(req, "order");
    const from = queryString(req, "from");
    const to = queryString(req, "to");
    const limit = Number(queryString(req, "limit") || 1000);
    const bucketMs = Number(queryString(req, "bucketMs") || 0);
    const agg = queryString(req, "agg") || undefined;
    let result: { rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string };

    try {
      if (kind === "raw") {
        result = await historianStore.queryRaw(paths, {
          from,
          to,
          order: order === "asc" ? "asc" : "desc",
          time: time === "epoch" ? "epoch" : "iso",
          limit,
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      } else if (kind === "range") {
        result = await historianStore.queryRange(paths, {
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
        result = await historianStore.queryLast(paths, {
          time: time === "epoch" ? "epoch" : "iso",
          timestampUnit: target.timestampUnit === "ns" ? "ns" : "us"
        });
      } else {
        result = await historianStore.queryFirst(paths, {
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
        path: pathQueryRaw,
        paths: pathQueries,
        matches,
        rows: result.rows,
        truncated: result.truncated === true,
        agg: result.agg,
        historianTargetId: target.id || "default"
      }
    };
  }

  async function historianDeleteByMatches(
    matches: ResolvedPathMatch[],
    req: Request
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
    const target = resolveHistorianTargetById(targetIds[0] || "default");
    if (!historianStore) {
      return { status: 503, body: { error: "Historian backend is not initialized" } };
    }
    const uniquePaths = matches
      .map((item) => item.path)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (uniquePaths.length === 0) {
      return { status: 404, body: { error: "No matching historian paths", matches: [] } };
    }
    const from = queryString(req, "from");
    const to = queryString(req, "to");
    let deletedRecords = 0;
    let touchedSegments = 0;
    try {
      const result = await historianStore.deleteByPaths(uniquePaths, from, to);
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

  const app = express();
  // app.use((req, res, next) => {
  //   const requestOrigin = req.header("origin");
  //   if (requestOrigin === preferredCorsOrigin) {
  //     res.setHeader("Access-Control-Allow-Origin", preferredCorsOrigin);
  //   } else if (requestOrigin && requestOrigin.trim()) {
  //     // Open for all browser origins by reflecting current Origin.
  //     res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  //   } else {
  //     res.setHeader("Access-Control-Allow-Origin", "*");
  //   }
  //   res.setHeader("Vary", "Origin");
  //   res.setHeader("Access-Control-Allow-Credentials", "true");
  //   res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
  //   res.setHeader("Access-Control-Allow-Headers", req.header("access-control-request-headers") || "*");
  //   res.setHeader("Access-Control-Expose-Headers", "*");
  //   res.setHeader("Access-Control-Allow-Private-Network", "true");
  //   res.setHeader("Access-Control-Max-Age", "86400");
  //   if (req.method === "OPTIONS") {
  //     res.status(204).end();
  //     return;
  //   }
  //   next();
  // });

  app.use((req, res, next) => {
    // Allow all origins by setting to the request origin or *
    const requestOrigin = req.header("origin");
    
    // Always allow all origins by reflecting the origin or using *
    res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");
    
    if (requestOrigin) {
      res.setHeader("Vary", "Origin");
    }
    
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "*");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "86400");
    
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();

  });


  app.use(express.json({ limit: "10mb" }));

  app.get(["/docs-json", "/docs/openapi.json", "/api/openapi.json"], (req, res) => {
    const protoHeader = req.header("x-forwarded-proto");
    const proto = protoHeader && protoHeader.trim() ? protoHeader.split(",")[0].trim() : req.protocol || "http";
    const hostHeader = req.header("host") || `${host}:${port}`;
    res.status(200).json({
      ...OPENAPI_RUNTIME_SPEC,
      servers: [{ url: `${proto}://${hostHeader}` }]
    });
  });

  app.get(["/docs", "/api/openapi"], (_req, res) => {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kufayeka Runtime API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      #swagger-ui { max-width: 1200px; margin: 0 auto; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/docs-json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true
      });
    </script>
  </body>
</html>`;
    res.status(200).type("text/html").send(html);
  });

  app.get("/api/global", (req, res) => {
    const includeInternal = parseBoolean(queryString(req, "includeInternal"), false);
    const data = filterSerializableGlobalEntries(runtime.getGlobalEntries(), { includeInternal });
    res.status(200).json({ data });
  });

  app.get(["/api/assets", "/api/assets/system"], (_req, res) => {
    res.status(200).json({ data: assetStore.getState() });
  });

  app.put(["/api/assets", "/api/assets/system"], (req, res) => {
    try {
      const next = assetStore.replace(req.body || {});
      res.status(200).json({ data: next });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.get("/api/assets/hierarchy", (req, res) => {
    const populatedRaw = queryString(req, "populated");
    const populated =
      populatedRaw === undefined ? true : populatedRaw === "1" || populatedRaw.toLowerCase() === "true" || populatedRaw.toLowerCase() === "yes";
    const data = assetStore.getHierarchy({ populateAttributes: populated });
    res.status(200).json({ populated, count: data.length, data });
  });

  app.get("/api/historian/raw", async (req, res) => {
    try {
      const result = await historianByPath("raw", req);
      res.status(result.status).json(result.body);
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/historian/range", async (req, res) => {
    try {
      const result = await historianByPath("range", req);
      res.status(result.status).json(result.body);
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/historian/last", async (req, res) => {
    try {
      const result = await historianByPath("last", req);
      res.status(result.status).json(result.body);
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/historian/first", async (req, res) => {
    try {
      const result = await historianByPath("first", req);
      res.status(result.status).json(result.body);
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/historian/targets", (_req, res) => {
    const state = assetStore.getState();
    const list = Array.isArray(state.historians) ? state.historians : [];
    res.status(200).json({
      count: list.length,
      targets: list,
      bridgeStats: runtime.getGlobal("historianBridgeStats", {})
    });
  });

  app.get("/api/historian/target-metrics", async (req, res) => {
    try {
      const targetId = queryString(req, "targetId") || "default";
      const target = resolveHistorianTargetById(targetId);
      if (!historianStore) {
        res.status(503).json({ error: "Historian backend is not initialized" });
        return;
      }
      res.status(200).json({
        targetId: target.id || "default",
        targetName: target.name,
        timestampUnit: target.timestampUnit,
        enabled: target.enabled,
        metrics: historianStore.getMetrics(),
        ingestStats: runtime.getGlobal("historianIngestStats", {})
      });
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian metrics upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/historian/target-logs", async (req, res) => {
    try {
      const targetId = queryString(req, "targetId") || "default";
      const kind = queryString(req, "kind") || "";
      const limit = queryString(req, "limit") || "100";
      if (!historianStore) {
        res.status(503).json({ error: "Historian backend is not initialized" });
        return;
      }
      const items = historianStore.getLogs(kind, Number(limit));
      res.status(200).json({
        targetId,
        kind,
        count: items.length,
        items
      });
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian logs upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/db/config", (_req, res) => {
    if (!dbConnectionManager) {
      res.status(503).json({ error: "DB connection manager is not initialized" });
      return;
    }
    res.status(200).json({ config: dbConnectionManager.getConfig(), metrics: dbConnectionManager.getMetrics() });
  });

  app.post("/api/db/test-connection", async (_req, res) => {
    if (!dbConnectionManager) {
      res.status(503).json({ error: "DB connection manager is not initialized" });
      return;
    }
    const result = await dbConnectionManager.testConnection();
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post("/api/db/sql-test", async (req, res) => {
    if (!dbConnectionManager) {
      res.status(503).json({ error: "DB connection manager is not initialized" });
      return;
    }
    try {
      const body = (req.body || {}) as { sql?: unknown };
      const sql = String(body.sql || "");
      const result = await dbConnectionManager.executeSql(sql);
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.delete("/api/historian/delete-attribute", async (req, res) => {
    try {
      const pathQuery = queryString(req, "path") || "";
      if (!pathQuery) {
        res.status(400).json({ error: "Query parameter 'path' is required" });
        return;
      }
      const matches = resolvePathMatches(pathQuery);
      const result = await historianDeleteByMatches(matches, req);
      const responseBody = typeof result.body === "object" && result.body ? (result.body as Record<string, unknown>) : {};
      res.status(result.status).json({
        ...responseBody,
        path: pathQuery
      });
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian delete upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.delete("/api/historian/delete-template-attribute", async (req, res) => {
    try {
      const templateId = queryString(req, "templateId") || "";
      const attributeName = queryString(req, "attributeName") || "";
      if (!templateId || !attributeName) {
        res.status(400).json({ error: "templateId and attributeName are required" });
        return;
      }
      const state = assetStore.getState();
      const byId = new Map((state.assets || []).map((asset) => [asset.id, asset]));
      const getPath = (assetId: string): string => {
        const asset = byId.get(assetId);
        if (!asset) return "";
        const parts = [asset.name];
        let parentId = asset.parentId;
        while (parentId) {
          const parent = byId.get(parentId);
          if (!parent) break;
          parts.unshift(parent.name);
          parentId = parent.parentId;
        }
        return parts.join(".");
      };
      const pathMatches: ResolvedPathMatch[] = [];
      for (const asset of state.assets || []) {
        if (!Array.isArray(asset.templateIds) || !asset.templateIds.includes(templateId)) continue;
        const path = `${getPath(asset.id)}.${attributeName}`;
        for (const item of resolvePathMatches(path)) pathMatches.push(item);
      }
      const dedup: ResolvedPathMatch[] = [];
      const seen = new Set<string>();
      for (const m of pathMatches) {
        const key = `${m.assetId}:${m.attributeName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(m);
      }
      const result = await historianDeleteByMatches(dedup, req);
      const responseBody = typeof result.body === "object" && result.body ? (result.body as Record<string, unknown>) : {};
      res.status(result.status).json({
        ...responseBody,
        templateId,
        attributeName
      });
    } catch (error: unknown) {
      res.status(502).json({ error: `Historian delete upstream error: ${getErrorMessage(error)}` });
    }
  });

  app.get("/api/assets/query", (req, res) => {
    const pathQuery = queryString(req, "path") || "";
    if (!pathQuery) {
      res.status(400).json({ error: "Query parameter 'path' is required" });
      return;
    }
    const matches = assetStore.query(pathQuery).map((item) => {
      if (item.kind !== "attribute") return item;
      return {
        ...item,
        tagId: computeTagID(item.assetId, item.attributeName)
      };
    });
    res.status(200).json({ path: pathQuery, count: matches.length, matches });
  });

  app.post("/api/assets/find-asset-paths", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const scopePath = String(body.scopePath || body.path || "").trim();
      const logic = String(body.logic || "AND").trim().toUpperCase() === "OR" ? "OR" : "AND";
      const filters = Array.isArray(body.filters) ? body.filters : [];
      if (!scopePath) {
        res.status(400).json({ error: "scopePath is required" });
        return;
      }
      if (filters.length === 0) {
        res.status(400).json({ error: "filters is required and must not be empty" });
        return;
      }

      const assets = assetStore.query(scopePath).filter((item) => item.kind === "asset");
      const matches = assets.filter((item) => {
        const assetValue = item.value as unknown as Record<string, unknown>;
        const attributes = isPlainObject(assetValue?.attributes) ? (assetValue.attributes as Record<string, unknown>) : {};
        const filterResults = filters.map((rawFilter) => {
          const filter = isPlainObject(rawFilter) ? rawFilter : {};
          const attributeName = String(filter.attributeName || "").trim();
          const operator = String(filter.operator || "eq").trim().toLowerCase();
          if (!attributeName) return false;
          if (!["eq", "neq", "contains", "contains_object"].includes(operator)) return false;
          const attrEntry = attributes[attributeName];
          const actualValue = isPlainObject(attrEntry) ? (attrEntry as Record<string, unknown>).value : undefined;
          return matchAttributeValue(operator, actualValue, filter.value);
        });
        return logic === "OR" ? filterResults.some(Boolean) : filterResults.every(Boolean);
      }).map((item) => ({
        path: item.path,
        assetId: item.assetId,
        name: isPlainObject(item.value) ? String((item.value as Record<string, unknown>).name || "") : ""
      }));

      res.status(200).json({
        scopePath,
        logic,
        count: matches.length,
        matches
      });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.get(["/api/assets/find", "/api/assets/find-by-value"], (req, res) => {
    const pathQuery = queryString(req, "path") || "*.*.*";
    const rawValue = queryString(req, "value");
    if (rawValue == null) {
      res.status(400).json({ error: "Query parameter 'value' is required" });
      return;
    }
    const expectedValue = parseFinderExpectedValue(rawValue);
    const strict = parseBoolean(queryString(req, "strict"), false);
    const result =
      typeof assetStore.findAttributesByValue === "function"
        ? assetStore.findAttributesByValue(pathQuery, expectedValue, { strict })
        : { path: pathQuery, expectedValue, strict, count: 0, assetCount: 0, matches: [], assets: [] };
    res.status(200).json(result);
  });

  app.get("/api/events", async (req, res) => {
    try {
      const pattern = queryString(req, "pattern") || "*";
      const from = queryString(req, "from") || "*";
      const to = queryString(req, "to") || "*";
      const status = queryString(req, "status") || "*";
      const severity = queryString(req, "severity") || "*";
      const limit = Number(queryString(req, "limit") || 1000);
      const offset = Number(queryString(req, "offset") || 0);
      const sortBy = queryString(req, "sortBy") || "start_ts";
      const sortDir = queryString(req, "sortDir") || "desc";
      const contextRaw = queryString(req, "context");
      const contextFilters = contextRaw && contextRaw.trim() ? JSON.parse(contextRaw) : {};
      const result = await eventStore.query(pattern, from, to, status, contextFilters, {
        limit,
        offset,
        sortBy,
        sortDir,
        severity
      });
      res.status(200).json({
        count: result.rows.length,
        total: result.total,
        pattern,
        from,
        to,
        status,
        severity,
        sortBy: result.sortBy,
        sortDir: result.sortDir,
        limit: result.limit,
        offset: result.offset,
        rows: result.rows
      });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.get("/api/events/range", async (req, res) => {
    try {
      const pattern = queryString(req, "pattern") || "*";
      const from = queryString(req, "from") || "*";
      const to = queryString(req, "to") || "*";
      const status = queryString(req, "status") || "*";
      const contextRaw = queryString(req, "context");
      const contextFilters = contextRaw && contextRaw.trim() ? JSON.parse(contextRaw) : {};
      const limit = Number(queryString(req, "limit") || 5000);
      const range = await getEventRangeFromStore(eventStore, pattern, from, to, status, contextFilters, { limit });
      res.status(200).json({
        pattern,
        from,
        to,
        status,
        ...range
      });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.get("/api/events/meta", (_req, res) => {
    try {
      res.status(200).json({
        provider: "postgresql",
        eventStore: eventStore.getMeta()
      });
    } catch (error: unknown) {
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/open", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const templateId = String(body.template_id || body.templateId || "").trim();
      if (templateId) {
        const row = await openEventFromTemplate({
          assetStore,
          eventStore,
          templateMap: eventTemplateMap,
          templateId,
          openOptions: {
            vars: body.vars && typeof body.vars === "object" ? (body.vars as Record<string, unknown>) : {},
            context: body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
            notes: String(body.notes_on_open || body.notes || ""),
            severity: String(body.severity || ""),
            ts: body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
            capturedDataOnOpen: toJsonValueOrNull(body.captured_data_on_open ?? body.capturedDataOnOpen)
          }
        });
        res.status(200).json({ ok: true, row });
        return;
      }
      const row = await eventStore.open(
        String(body.event_path || body.path || ""),
        body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
        body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
        String(body.notes_on_open || body.notes || ""),
        String(body.severity || "other"),
        toJsonValueOrNull(body.captured_data_on_open ?? body.capturedDataOnOpen)
      );
      res.status(200).json({ ok: true, row });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/close", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const templateId = String(body.template_id || body.templateId || "").trim();
      if (templateId) {
        const result = await closeEventFromTemplate({
          assetStore,
          eventStore,
          templateMap: eventTemplateMap,
          templateId,
          closeOptions: {
            id: body.id ? String(body.id) : undefined,
            vars: body.vars && typeof body.vars === "object" ? (body.vars as Record<string, unknown>) : {},
            pattern: body.pattern ? String(body.pattern) : body.event_path ? String(body.event_path) : undefined,
            context: body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
            notes: String(body.notes_on_close || body.notes || ""),
            severity: String(body.severity || ""),
            ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
            capturedDataOnClose: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
          }
        });
        res.status(200).json({ ok: true, ...result });
        return;
      }
      if (parseBoolean(String(body.capture_auto ?? body.captureAuto ?? "false"), false)) {
        const rows = await eventStore.get(
          String(body.pattern || body.event_path || "*"),
          "*",
          "*",
          "open",
          {},
          { limit: 5000 }
        );
        const result = await closeEventsWithAutoCapture({
          assetStore,
          eventStore,
          templateMap: eventTemplateMap,
          rows,
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        res.status(200).json({ ok: true, ...result });
        return;
      }
      const rows = await eventStore.get(
        String(body.pattern || body.event_path || "*"),
        "*",
        "*",
        "open",
        {},
        { limit: 5000 }
      );
      const templatedRows = rows.filter((row) => row.event_metadata && Object.keys(row.event_metadata).length > 0);
      if (templatedRows.length > 0) {
        const autoResult = await closeEventsWithAutoCapture({
          assetStore,
          eventStore,
          templateMap: eventTemplateMap,
          rows: templatedRows,
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        if (templatedRows.length === rows.length) {
          res.status(200).json({ ok: true, ...autoResult });
          return;
        }
        const normalResult = await eventStore.close(
          String(body.pattern || body.event_path || "*"),
          body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          String(body.notes_on_close || body.notes || ""),
          toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        );
        res.status(200).json({
          ok: true,
          ...normalResult,
          closedCount: Number(normalResult.closedCount || 0) + autoResult.closedCount,
          ts: autoResult.ts || normalResult.ts
        });
        return;
      }
      const result = await eventStore.close(
        String(body.pattern || body.event_path || "*"),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || ""),
        toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/close-id", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      if (parseBoolean(String(body.capture_auto ?? body.captureAuto ?? "false"), false)) {
        const row = await eventStore.getById(String(body.id || ""));
        const result = row
          ? await closeEventsWithAutoCapture({
              assetStore,
              eventStore,
              templateMap: eventTemplateMap,
              rows: row.status === "open" ? [row] : [],
              notes: String(body.notes_on_close || body.notes || ""),
              ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
              explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
            })
          : {
              pattern: String(body.id || ""),
              closedCount: 0,
              ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : new Date().toISOString(),
              notes_on_close: String(body.notes_on_close || body.notes || ""),
              rows: []
            };
        res.status(200).json({ ok: true, ...result });
        return;
      }
      const row = await eventStore.getById(String(body.id || ""));
      if (row && row.status === "open" && row.event_metadata && Object.keys(row.event_metadata).length > 0) {
        const result = await closeEventsWithAutoCapture({
          assetStore,
          eventStore,
          templateMap: eventTemplateMap,
          rows: [row],
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        res.status(200).json({ ok: true, ...result });
        return;
      }
      const result = await eventStore.closeById(
        String(body.id || ""),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || ""),
        toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/ack-id", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = await eventStore.acknowledgeById(
        String(body.id || ""),
        body.acknowledged_ts ? String(body.acknowledged_ts) : body.ts ? String(body.ts) : undefined
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.delete("/api/events/by-id", async (req, res) => {
    try {
      const id = queryString(req, "id") || "";
      const result = await eventStore.deleteById(id);
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.delete("/api/events", async (req, res) => {
    try {
      const pattern = queryString(req, "pattern") || "*";
      const status = queryString(req, "status") || "*";
      const from = queryString(req, "from") || "*";
      const to = queryString(req, "to") || "*";
      const severity = queryString(req, "severity") || "*";
      const result = await eventStore.deleteByPattern(pattern, status, from, to, severity);
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.get("/api/assets/historian-tags", (req, res) => {
    const pathQuery = queryString(req, "path") || "*.*.*";
    const matches = resolvePathMatches(pathQuery).map((item) => {
      const origin = assetStore
        .query(item.path)
        .find(
          (x): x is AttributeQueryMatch =>
            x.kind === "attribute" && x.assetId === item.assetId && x.attributeName === item.attributeName
        );
      return {
        ...item,
        type: origin?.type,
        historianEnabled: origin?.historianEnabled === true,
        historianTimeSourcePath: origin?.historianTimeSourcePath || "",
        historianTargetId: origin?.historianTargetId || "default"
      };
    });
    res.status(200).json({ path: pathQuery, count: matches.length, matches });
  });

  app.all("/api/assets/value/:encodedPath", (req, res) => {
    let pathQuery = "";
    try {
      pathQuery = decodeURIComponent(String(req.params.encodedPath || ""));
    } catch {
      res.status(400).json({ error: "Invalid encoded path" });
      return;
    }
    if (!pathQuery) {
      res.status(400).json({ error: "Asset path is required" });
      return;
    }
    if (req.method === "GET") {
      const matches = assetStore
        .query(pathQuery)
        .filter((item) => item.kind === "attribute")
        .map((item) => ({
          ...item,
          tagId: computeTagID(item.assetId, item.attributeName)
        }));
      res.status(200).json({ path: pathQuery, count: matches.length, matches });
      return;
    }
    if (req.method === "PUT") {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(body, "value")) {
          res.status(400).json({ error: "Body must include a 'value' field" });
          return;
        }
        const existingMatches = assetStore.query(pathQuery).filter((item) => item.kind === "attribute");
        if (existingMatches.length === 0) {
          res.status(404).json({
            error: "Attribute path not found. Write rejected to prevent creating non-template attribute.",
            path: pathQuery
          });
          return;
        }
        const matches = assetStore.setAttribute(pathQuery, body.value);
        res.status(200).json({
          path: pathQuery,
          count: matches.length,
          matchedCount: matches.length,
          matches: matches.map((item) => ({
            ...item,
            tagId: computeTagID(item.assetId, item.attributeName)
          }))
        });
      } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
      }
      return;
    }
    res.status(405).json({ error: `Method ${req.method} is not supported` });
  });

  app.all(/^\/api\/assets\/values:batch$/, (req, res) => {
    if (req.method === "POST") {
      try {
        const body = (req.body || {}) as { paths?: string[] };
        const rawPaths = Array.isArray(body.paths) ? body.paths : [];
        const paths = rawPaths.map((item) => String(item || ""));
        const invalidPaths = paths.filter((item) => !item);
        if (invalidPaths.length > 0) {
          res.status(400).json({
            error: "Batch read requires non-empty string paths.",
            invalidPaths
          });
          return;
        }

        const resultCache = new Map<
          string,
          {
            path: string;
            count: number;
            matches: Array<AttributeQueryMatch & { tagId: number }>;
          }
        >();
        const results = paths.map((path) => {
          const cached = resultCache.get(path);
          if (cached) return cached;
          const matches = assetStore
            .query(path)
            .filter((item): item is AttributeQueryMatch => item.kind === "attribute")
            .map((item) => ({
              ...item,
              tagId: computeTagID(item.assetId, item.attributeName)
            }));
          const result = {
            path,
            count: matches.length,
            matches
          };
          resultCache.set(path, result);
          return result;
        });
        res.status(200).json({
          count: results.length,
          results
        });
      } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
      }
      return;
    }

    if (req.method !== "PUT") {
      res.status(405).json({ error: `Method ${req.method} is not supported` });
      return;
    }
    try {
      const body = (req.body || {}) as { items?: Array<{ path: string; value: unknown }> };
      const items = Array.isArray(body.items) ? body.items : [];
      const invalidPaths: string[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (!Object.prototype.hasOwnProperty.call(item, "path")) continue;
        if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
        const pathValue = String(item.path || "");
        if (!pathValue) {
          invalidPaths.push(pathValue);
          continue;
        }
        const matches = assetStore.query(pathValue).filter((x) => x.kind === "attribute");
        if (matches.length === 0) invalidPaths.push(pathValue);
      }
      if (invalidPaths.length > 0) {
        res.status(404).json({
          error: "One or more attribute paths were not found. Batch write rejected; no updates applied.",
          invalidPaths
        });
        return;
      }
      const results = assetStore.setAttributes(items);
      res.status(200).json({
        count: results.length,
        results: results.map((result) => ({
          ...result,
          matchedCount: result.matches.length,
          matches: (result.matches || []).map((item) => ({
            ...item,
            tagId: computeTagID(item.assetId, item.attributeName)
          }))
        }))
      });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.all(/^\/api\/global\/(.+)$/, (req, res) => {
    const raw = req.path.replace(/^\/api\/global\//, "");
    const key = decodeURIComponent(raw || "");
    if (!key) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    if (isInternalGlobalKey(key)) {
      res.status(403).json({ error: `Key "${key}" is reserved` });
      return;
    }
    if (req.method === "GET") {
      if (!runtime.hasGlobal(key)) {
        res.status(404).json({ error: `Key "${key}" not found` });
        return;
      }
      const serializable = toSerializableJsonValue(runtime.getGlobal(key));
      if (!serializable.ok) {
        res.status(409).json({ error: `Key "${key}" is not JSON serializable: ${serializable.error}` });
        return;
      }
      res.status(200).json({ key, value: serializable.value });
      return;
    }
    if (req.method === "PUT") {
      try {
        const body = (req.body || {}) as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(body, "value")) {
          res.status(400).json({ error: "Body must include a 'value' field" });
          return;
        }
        const serializable = toSerializableJsonValue(body.value);
        if (!serializable.ok) {
          res.status(400).json({ error: `Value is not JSON serializable: ${serializable.error}` });
          return;
        }
        const value = runtime.setGlobal(key, serializable.value);
        flushGlobalPersistence();
        res.status(200).json({ key, value });
      } catch (error: unknown) {
        res.status(400).json({ error: getErrorMessage(error) });
      }
      return;
    }
    if (req.method === "DELETE") {
      const deleted = runtime.deleteGlobal(key);
      flushGlobalPersistence();
      res.status(200).json({ key, deleted });
      return;
    }
    res.status(405).json({ error: `Method ${req.method} is not supported` });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  let server: http.Server | null = null;
  const sockets = new Set<Socket>();

  return {
    start() {
      const activeServer = app.listen(port, host, () => {
        console.log(`Global store API is running at http://${host}:${port}`);
      });
      server = activeServer;
      activeServer.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      return activeServer;
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        const activeServer = server;
        const forceCloseTimer = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
        }, 1000);
        forceCloseTimer.unref?.();
        activeServer.close((error) => {
          clearTimeout(forceCloseTimer);
          if (error) {
            reject(error);
            return;
          }
          for (const socket of sockets) {
            socket.destroy();
          }
          sockets.clear();
          server = null;
          resolve();
        });
      });
    }
  };
}
