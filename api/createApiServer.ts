import http from "node:http";
import type { Socket } from "node:net";
import express, { Request } from "express";
import Runtime from "../runtime/Runtime";
import { ensureAssetStorage } from "../runtime/assetStorage";
import { ensureEventStore } from "../runtime/eventStore";
import { computeTagID } from "../runtime/historianBridge";
import {
  filterSerializableGlobalEntries,
  isInternalGlobalKey,
  toSerializableJsonValue
} from "../runtime/globalStoreUtils";
import { OPENAPI_RUNTIME_SPEC } from "./openapiRuntimeSpec";
import type { AttributeQueryMatch, HistorianTarget } from "../runtime/types";

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

export default function createApiServer(runtime: Runtime, options: { port?: number; host?: string } = {}) {
  const port = options.port ?? 4000;
  const host = options.host ?? "0.0.0.0";
  const preferredCorsOrigin = "http://192.168.68.99:3333";
  const assetStore = ensureAssetStorage(runtime, runtime.getGlobal("assetFramework", {}));
  const eventStore = ensureEventStore(runtime);
  const historianHttpBase = process.env.HISTORIAN_HTTP_BASE || "http://127.0.0.1:8080";
  type HistorianTimescaleStore = {
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
  const historianStore = runtime.getGlobal<HistorianTimescaleStore | null>("historianTimescale", null);
  const flushGlobalPersistence = (): void => {
    const persistence = runtime.getGlobal<{ flushNow?: () => void } | undefined>("__runtime.globalValuePersistence");
    if (persistence?.flushNow) persistence.flushNow();
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
      httpBaseUrl: historianHttpBase,
      udpHost: "127.0.0.1",
      udpPort: 9900,
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
  app.use((req, res, next) => {
    const requestOrigin = req.header("origin");
    if (requestOrigin === preferredCorsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", preferredCorsOrigin);
    } else if (requestOrigin && requestOrigin.trim()) {
      // Open for all browser origins by reflecting current Origin.
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
    res.setHeader("Access-Control-Allow-Headers", req.header("access-control-request-headers") || "*");
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
        udpHost: target.udpHost,
        udpPort: target.udpPort,
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

  app.get("/api/events", (req, res) => {
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
      const result = eventStore.query(pattern, from, to, status, contextFilters, {
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

  app.post("/api/events/open", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const row = eventStore.open(
        String(body.event_path || body.path || ""),
        body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
        body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
        String(body.notes_on_open || body.notes || ""),
        String(body.severity || "other")
      );
      res.status(200).json({ ok: true, row });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/close", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = eventStore.close(
        String(body.pattern || body.event_path || "*"),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || "")
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/close-id", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = eventStore.closeById(
        String(body.id || ""),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || "")
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post("/api/events/ack-id", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const result = eventStore.acknowledgeById(
        String(body.id || ""),
        body.acknowledged_ts ? String(body.acknowledged_ts) : body.ts ? String(body.ts) : undefined
      );
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.delete("/api/events/by-id", (req, res) => {
    try {
      const id = queryString(req, "id") || "";
      const result = eventStore.deleteById(id);
      res.status(200).json({ ok: true, ...result });
    } catch (error: unknown) {
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.delete("/api/events", (req, res) => {
    try {
      const pattern = queryString(req, "pattern") || "*";
      const status = queryString(req, "status") || "*";
      const from = queryString(req, "from") || "*";
      const to = queryString(req, "to") || "*";
      const severity = queryString(req, "severity") || "*";
      const result = eventStore.deleteByPattern(pattern, status, from, to, severity);
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
