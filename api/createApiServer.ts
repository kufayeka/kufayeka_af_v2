import http, { IncomingMessage, ServerResponse } from "node:http";
import Runtime from "../runtime/Runtime";
import { ensureAssetStorage } from "../runtime/assetStorage";
import { ensureEventStore } from "../runtime/eventStore";
import { computeTagID } from "../runtime/historianBridge";
import { OPENAPI_RUNTIME_SPEC } from "./openapiRuntimeSpec";
import type { AttributeQueryMatch, AssetStore, HistorianTarget } from "../runtime/types";

/**
 * DEV CORS: allow all origins (no credentials).
 * Kalau butuh cookies/credentials, lihat catatan di bawah.
 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin ? String(req.headers.origin) : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
  );
  res.setHeader("Access-Control-Expose-Headers", "Content-Type, Content-Length");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  // Optional caching preflight
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(req: IncomingMessage, res: ServerResponse, statusCode: number, data: unknown): void {
  setCorsHeaders(req, res);
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error("Body JSON tidak valid"));
      }
    });

    req.on("error", reject);
  });
}

function getKeyFromPath(urlPath: string): string | null {
  if (!urlPath.startsWith("/api/global/")) return null;
  const encodedKey = urlPath.slice("/api/global/".length);
  if (!encodedKey) return null;
  return decodeURIComponent(encodedKey);
}

function parseBoolean(value: string | null, fallback = false): boolean {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseFinderExpectedValue(rawValue: string | null): unknown {
  if (rawValue == null) return undefined;
  const source = String(rawValue);
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

export default function createApiServer(runtime: Runtime, options: { port?: number; host?: string } = {}) {
  const port = options.port ?? 4000;
  const host = options.host ?? "0.0.0.0";
  const assetStore = ensureAssetStorage(runtime, runtime.getGlobal("assetFramework", {}));
  const eventStore = ensureEventStore(runtime);
  const historianHttpBase = process.env.HISTORIAN_HTTP_BASE || "http://127.0.0.1:8080";

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
        historianTimeSourcePath: item.historianTimeSourcePath || "",
      }));
  }

  async function historianByPath(kind: "raw" | "range" | "last", requestUrl: URL): Promise<{ status: number; body: unknown }> {
    const pathQueryRaw = requestUrl.searchParams.get("path") || "";
    const pathQueries = parsePathList(pathQueryRaw);
    if (pathQueries.length === 0) {
      return { status: 400, body: { error: "Query parameter 'path' wajib diisi" } };
    }

    const allMatches: ResolvedPathMatch[] = [];
    for (const pathQuery of pathQueries) {
      for (const item of resolvePathMatches(pathQuery)) {
        allMatches.push(item);
      }
    }
    const seen = new Set();
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
    const baseUrl = String(target.httpBaseUrl || historianHttpBase);

    const params = new URLSearchParams();
    params.set(
      "tagIds",
      matches
        .map((item) => String(item.tagId))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .join(",")
    );
    const passThrough = ["from", "to", "order", "time", "limit", "bucketMs", "agg"];
    for (const key of passThrough) {
      const value = requestUrl.searchParams.get(key);
      if (value != null && value !== "") params.set(key, value);
    }

    const upstreamUrl = `${baseUrl}/hist/${kind}?${params.toString()}`;
    const upstreamRes = await fetch(upstreamUrl);
    const upstreamJson = (await upstreamRes.json()) as { rows?: Array<Record<string, unknown>>; truncated?: boolean; agg?: string };
    if (!upstreamRes.ok) {
      return { status: upstreamRes.status, body: upstreamJson };
    }

    const tagToPath = new Map(matches.map((item) => [`tag${item.tagId}`, item.path]));
    const rows = Array.isArray(upstreamJson.rows)
      ? upstreamJson.rows.map((row) => {
          const next: Record<string, unknown> = { time: row.time };
          for (const [key, value] of Object.entries(row)) {
            if (key === "time") continue;
            next[tagToPath.get(key) || key] = value;
          }
          return next;
        })
      : [];

    return {
      status: 200,
      body: {
        path: pathQueryRaw,
        paths: pathQueries,
        matches,
        rows,
        truncated: upstreamJson.truncated === true,
        agg: upstreamJson.agg,
        historianTargetId: target.id || "default"
      }
    };
  }

  async function historianDeleteByMatches(matches: ResolvedPathMatch[], requestUrl: URL): Promise<{ status: number; body: unknown }> {
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
    const baseUrl = String(target.httpBaseUrl || historianHttpBase);
    const uniqueTagIds = matches
      .map((item) => item.tagId)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    if (uniqueTagIds.length === 0) {
      return { status: 404, body: { error: "No matching historian tags", matches: [] } };
    }
    const payload: { tagIds: number[]; from?: string; to?: string } = { tagIds: uniqueTagIds };
    const from = requestUrl.searchParams.get("from");
    const to = requestUrl.searchParams.get("to");
    if (from) payload.from = from;
    if (to) payload.to = to;
    const upstreamRes = await fetch(`${baseUrl}/hist/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const upstreamJson = await upstreamRes.json();
    if (!upstreamRes.ok) {
      return { status: upstreamRes.status, body: upstreamJson };
    }
    return {
      status: 200,
      body: {
        ok: true,
        message: "historian has been deleted",
        deletedRecords: upstreamJson.deletedRecords ?? 0,
        touchedSegments: upstreamJson.touchedSegments ?? 0,
        historianTargetId: target.id || "default",
        matches
      }
    };
  }

  const server = http.createServer(async (req, res) => {
    // Always set CORS headers
    setCorsHeaders(req, res);

    const method = req.method || "GET";

    // Handle preflight request (important for PUT/POST with JSON)
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const urlPath = requestUrl.pathname;

    if (method === "GET" && (urlPath === "/docs/openapi.json" || urlPath === "/api/openapi.json")) {
      sendJson(req, res, 200, OPENAPI_RUNTIME_SPEC);
      return;
    }

    if (method === "GET" && (urlPath === "/docs" || urlPath === "/api/openapi")) {
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
        url: "/docs/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: true
      });
    </script>
  </body>
</html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (method === "GET" && urlPath === "/api/global") {
      sendJson(req, res, 200, { data: runtime.getGlobalEntries() });
      return;
    }

    if (urlPath === "/api/assets" && method === "GET") {
      sendJson(req, res, 200, { data: assetStore.getState() });
      return;
    }

    if (urlPath === "/api/assets" && method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const next = assetStore.replace(body);
        sendJson(req, res, 200, { data: next });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/assets/system" && method === "GET") {
      sendJson(req, res, 200, { data: assetStore.getState() });
      return;
    }

    if (urlPath === "/api/assets/system" && method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const next = assetStore.replace(body);
        sendJson(req, res, 200, { data: next });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/assets/hierarchy" && method === "GET") {
      const populatedRaw = requestUrl.searchParams.get("populated");
      const populated =
        populatedRaw === null
          ? true
          : populatedRaw === "1" ||
            populatedRaw.toLowerCase() === "true" ||
            populatedRaw.toLowerCase() === "yes";
      const data = assetStore.getHierarchy({ populateAttributes: populated });
      sendJson(req, res, 200, { populated, count: data.length, data });
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/raw") {
      try {
        const result = await historianByPath("raw", requestUrl);
        sendJson(req, res, result.status, result.body);
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/range") {
      try {
        const result = await historianByPath("range", requestUrl);
        sendJson(req, res, result.status, result.body);
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/last") {
      try {
        const result = await historianByPath("last", requestUrl);
        sendJson(req, res, result.status, result.body);
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/targets") {
      const state = assetStore.getState();
      const list = Array.isArray(state.historians) ? state.historians : [];
      sendJson(req, res, 200, {
        count: list.length,
        targets: list,
        bridgeStats: runtime.getGlobal("historianBridgeStats", {})
      });
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/target-metrics") {
      try {
        const targetId = requestUrl.searchParams.get("targetId") || "default";
        const target = resolveHistorianTargetById(targetId);
        const baseUrl = String(target.httpBaseUrl || historianHttpBase);
        const upstream = await fetch(`${baseUrl}/metrics`);
        const payload = await upstream.json();
        sendJson(req, res, upstream.ok ? 200 : upstream.status, payload);
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian metrics upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "GET" && urlPath === "/api/historian/target-logs") {
      try {
        const targetId = requestUrl.searchParams.get("targetId") || "default";
        const kind = requestUrl.searchParams.get("kind") || "";
        const limit = requestUrl.searchParams.get("limit") || "100";
        const target = resolveHistorianTargetById(targetId);
        const baseUrl = String(target.httpBaseUrl || historianHttpBase);
        const upstream = await fetch(`${baseUrl}/logs?kind=${encodeURIComponent(kind)}&limit=${encodeURIComponent(limit)}`);
        const payload = await upstream.json();
        sendJson(req, res, upstream.ok ? 200 : upstream.status, payload);
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian logs upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "DELETE" && urlPath === "/api/historian/delete-attribute") {
      try {
        const pathQuery = requestUrl.searchParams.get("path") || "";
        if (!pathQuery) {
          sendJson(req, res, 400, { error: "Query parameter 'path' wajib diisi" });
          return;
        }
        const matches = resolvePathMatches(pathQuery);
        const result = await historianDeleteByMatches(matches, requestUrl);
        const responseBody = typeof result.body === "object" && result.body ? (result.body as Record<string, unknown>) : {};
        sendJson(req, res, result.status, {
          ...responseBody,
          path: pathQuery
        });
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian delete upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (method === "DELETE" && urlPath === "/api/historian/delete-template-attribute") {
      try {
        const templateId = requestUrl.searchParams.get("templateId") || "";
        const attributeName = requestUrl.searchParams.get("attributeName") || "";
        if (!templateId || !attributeName) {
          sendJson(req, res, 400, { error: "templateId dan attributeName wajib diisi" });
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
          const resolved = resolvePathMatches(path);
          for (const item of resolved) pathMatches.push(item);
        }
        const dedup: ResolvedPathMatch[] = [];
        const seen = new Set();
        for (const m of pathMatches) {
          const key = `${m.assetId}:${m.attributeName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dedup.push(m);
        }
        const result = await historianDeleteByMatches(dedup, requestUrl);
        const responseBody = typeof result.body === "object" && result.body ? (result.body as Record<string, unknown>) : {};
        sendJson(req, res, result.status, {
          ...responseBody,
          templateId,
          attributeName
        });
      } catch (error: unknown) {
        sendJson(req, res, 502, { error: `Historian delete upstream error: ${getErrorMessage(error)}` });
      }
      return;
    }

    if (urlPath === "/api/assets/query" && method === "GET") {
      const pathQuery = requestUrl.searchParams.get("path") || "";
      if (!pathQuery) {
        sendJson(req, res, 400, { error: "Query parameter 'path' wajib diisi" });
        return;
      }
      const matches = assetStore.query(pathQuery).map((item) => {
        if (item.kind !== "attribute") return item;
        return {
          ...item,
          tagId: computeTagID(item.assetId, item.attributeName),
        };
      });
      sendJson(req, res, 200, { path: pathQuery, count: matches.length, matches });
      return;
    }

    if ((urlPath === "/api/assets/find" || urlPath === "/api/assets/find-by-value") && method === "GET") {
      const pathQuery = requestUrl.searchParams.get("path") || "*.*.*";
      const rawValue = requestUrl.searchParams.get("value");
      if (rawValue == null) {
        sendJson(req, res, 400, { error: "Query parameter 'value' wajib diisi" });
        return;
      }
      const expectedValue = parseFinderExpectedValue(rawValue);
      const strict = parseBoolean(requestUrl.searchParams.get("strict"), false);
      const result =
        typeof assetStore.findAttributesByValue === "function"
          ? assetStore.findAttributesByValue(pathQuery, expectedValue, { strict })
          : { path: pathQuery, expectedValue, strict, count: 0, assetCount: 0, matches: [], assets: [] };
      sendJson(req, res, 200, result);
      return;
    }

    if (urlPath === "/api/events" && method === "GET") {
      try {
        const pattern = requestUrl.searchParams.get("pattern") || "*";
        const from = requestUrl.searchParams.get("from") || "*";
        const to = requestUrl.searchParams.get("to") || "*";
        const status = requestUrl.searchParams.get("status") || "*";
        const severity = requestUrl.searchParams.get("severity") || "*";
        const limit = Number(requestUrl.searchParams.get("limit") || 1000);
        const offset = Number(requestUrl.searchParams.get("offset") || 0);
        const sortBy = requestUrl.searchParams.get("sortBy") || "start_ts";
        const sortDir = requestUrl.searchParams.get("sortDir") || "desc";
        const contextRaw = requestUrl.searchParams.get("context");
        const contextFilters =
          contextRaw && contextRaw.trim() ? JSON.parse(contextRaw) : {};
        const result = eventStore.query(pattern, from, to, status, contextFilters, {
          limit,
          offset,
          sortBy,
          sortDir,
          severity
        });
        sendJson(req, res, 200, {
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
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events/open" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const row = eventStore.open(
          String(body.event_path || body.path || ""),
          body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
          (body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {}),
          String(body.notes_on_open || body.notes || ""),
          String(body.severity || "other")
        );
        sendJson(req, res, 200, { ok: true, row });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events/close" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const result = eventStore.close(
          String(body.pattern || body.event_path || "*"),
          body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          String(body.notes_on_close || body.notes || "")
        );
        sendJson(req, res, 200, { ok: true, ...result });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events/close-id" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const result = eventStore.closeById(
          String(body.id || ""),
          body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          String(body.notes_on_close || body.notes || "")
        );
        sendJson(req, res, 200, { ok: true, ...result });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events/ack-id" && method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const result = eventStore.acknowledgeById(
          String(body.id || ""),
          body.acknowledged_ts ? String(body.acknowledged_ts) : body.ts ? String(body.ts) : undefined
        );
        sendJson(req, res, 200, { ok: true, ...result });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events/by-id" && method === "DELETE") {
      try {
        const id = requestUrl.searchParams.get("id") || "";
        const result = eventStore.deleteById(id);
        sendJson(req, res, 200, { ok: true, ...result });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/events" && method === "DELETE") {
      try {
        const pattern = requestUrl.searchParams.get("pattern") || "*";
        const status = requestUrl.searchParams.get("status") || "*";
        const from = requestUrl.searchParams.get("from") || "*";
        const to = requestUrl.searchParams.get("to") || "*";
        const severity = requestUrl.searchParams.get("severity") || "*";
        const result = eventStore.deleteByPattern(pattern, status, from, to, severity);
        sendJson(req, res, 200, { ok: true, ...result });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (urlPath === "/api/assets/historian-tags" && method === "GET") {
      const pathQuery = requestUrl.searchParams.get("path") || "*.*.*";
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
          historianTargetId: origin?.historianTargetId || "default",
        };
      });
      sendJson(req, res, 200, { path: pathQuery, count: matches.length, matches });
      return;
    }

    if (urlPath.startsWith("/api/assets/value/")) {
      const encoded = urlPath.slice("/api/assets/value/".length);
      const pathQuery = decodeURIComponent(encoded || "");
      if (!pathQuery) {
        sendJson(req, res, 400, { error: "Path asset wajib diisi" });
        return;
      }

      if (method === "GET") {
        const matches = assetStore
          .query(pathQuery)
          .filter((item) => item.kind === "attribute")
          .map((item) => ({
            ...item,
            tagId: computeTagID(item.assetId, item.attributeName),
          }));
        sendJson(req, res, 200, { path: pathQuery, count: matches.length, matches });
        return;
      }

      if (method === "PUT") {
        try {
          const body = await parseJsonBody(req);
          if (!Object.prototype.hasOwnProperty.call(body, "value")) {
            sendJson(req, res, 400, { error: "Body wajib punya field 'value'" });
            return;
          }
          const matches = assetStore.setAttribute(pathQuery, body.value);
          sendJson(req, res, 200, {
            path: pathQuery,
            count: matches.length,
            matches: matches.map((item) => ({
              ...item,
              tagId: computeTagID(item.assetId, item.attributeName),
            })),
          });
        } catch (error: unknown) {
          sendJson(req, res, 400, { error: getErrorMessage(error) });
        }
        return;
      }
    }

    if (urlPath === "/api/assets/values:batch" && method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        const items = Array.isArray(body.items) ? body.items : [];
        const results = assetStore.setAttributes(items);
        sendJson(req, res, 200, {
          count: results.length,
          results: results.map((result) => ({
            ...result,
            matches: (result.matches || []).map((item) => ({
              ...item,
              tagId: computeTagID(item.assetId, item.attributeName),
            })),
          })),
        });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    const key = getKeyFromPath(urlPath);
    if (!key) {
      sendJson(req, res, 404, { error: "Route tidak ditemukan" });
      return;
    }

    if (method === "GET") {
      if (!runtime.hasGlobal(key)) {
        sendJson(req, res, 404, { error: `Key "${key}" tidak ditemukan` });
        return;
      }
      sendJson(req, res, 200, { key, value: runtime.getGlobal(key) });
      return;
    }

    if (method === "PUT") {
      try {
        const body = await parseJsonBody(req);
        if (!Object.prototype.hasOwnProperty.call(body, "value")) {
          sendJson(req, res, 400, { error: "Body wajib punya field 'value'" });
          return;
        }

        const value = runtime.setGlobal(key, body.value);
        sendJson(req, res, 200, { key, value });
      } catch (error: unknown) {
        sendJson(req, res, 400, { error: getErrorMessage(error) });
      }
      return;
    }

    if (method === "DELETE") {
      const deleted = runtime.deleteGlobal(key);
      sendJson(req, res, 200, { key, deleted });
      return;
    }

    sendJson(req, res, 405, { error: `Method ${method} tidak didukung` });
  });

  return {
    start() {
      server.listen(port, host, () => {
        console.log(`Global store API aktif di http://${host}:${port}`);
      });
      return server;
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
