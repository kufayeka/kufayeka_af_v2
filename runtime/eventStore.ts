import { randomUUID } from "node:crypto";
import type Runtime from "./Runtime";
import type { DbConnectionManager } from "./dbConnectionManager";
import type { EventRow, EventStore, EventStoreChangeMeta } from "./types";

const VALID_STATUS = new Set(["open", "closed"]);
const VALID_SEVERITY = new Set(["other", "info", "low", "medium", "high", "critical"]);
const SORTABLE_COLUMNS = new Set([
  "id",
  "event_path",
  "start_ts",
  "end_ts",
  "status",
  "severity",
  "is_acknowledge",
  "acknowledged_ts"
]);

type ContextFilterOperator = "eq" | "neq" | "in" | "not_in" | "exists" | "not_exists";
type ContextFilterCondition = {
  path: string;
  operator: ContextFilterOperator;
  value?: unknown;
};
type NormalizedContextFilter = { op: "AND" | "OR"; conditions: ContextFilterCondition[] };

interface EventStoreOptions {
  dbConnectionManager?: DbConnectionManager | null;
}

function epochToMs(value: number): number {
  const abs = Math.abs(value);
  if (abs < 1e11) return value * 1000;
  if (abs < 1e14) return value;
  if (abs < 1e17) return value / 1000;
  return value / 1_000_000;
}

function parseDateLike(ts: unknown): Date | null {
  if (ts == null || ts === "" || ts === "*") return null;
  if (typeof ts === "number" && Number.isFinite(ts)) return new Date(epochToMs(ts));
  if (typeof ts === "string") {
    const raw = ts.trim();
    if (!raw) return null;
    if (/^[+-]?\d+(\.\d+)?$/.test(raw)) {
      const num = Number(raw);
      if (Number.isFinite(num)) return new Date(epochToMs(num));
    }
    return new Date(raw);
  }
  return new Date(String(ts));
}

function toIsoTs(ts: unknown): string {
  if (!ts || ts === "*") return new Date().toISOString();
  const date = parseDateLike(ts);
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(ts)}`);
  }
  return date.toISOString();
}

function parseIsoTs(ts: unknown, fallback: string | null = null): string | null {
  if (!ts || ts === "*") return fallback;
  const date = parseDateLike(ts);
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(ts)}`);
  }
  return date.toISOString();
}

export function wildcardToSqlLike(pattern: unknown): string {
  const input = String(pattern == null ? "*" : pattern);
  let output = "";
  for (const ch of input) {
    if (ch === "*") {
      output += "%";
      continue;
    }
    if (ch === "!" || ch === "%" || ch === "_") output += "!";
    output += ch;
  }
  return output;
}

function normalizeStatus(status: unknown): string {
  if (!status || status === "*") return "*";
  const value = String(status).trim().toLowerCase();
  if (!VALID_STATUS.has(value)) throw new Error(`Invalid status: ${String(status)}`);
  return value;
}

function normalizeSeverity(severity: unknown): EventRow["severity"] {
  const value = String(severity || "other").trim().toLowerCase() as EventRow["severity"];
  if (!VALID_SEVERITY.has(value)) throw new Error(`Invalid severity: ${String(severity)}`);
  return value;
}

function normalizeSortBy(sortBy: unknown): string {
  const value = String(sortBy || "start_ts").trim();
  return SORTABLE_COLUMNS.has(value) ? value : "start_ts";
}

function normalizeSortDir(sortDir: unknown): "ASC" | "DESC" {
  return String(sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
}

function toJsonPath(rawKey: unknown): string[] {
  const raw = String(rawKey || "").trim();
  if (!raw) throw new Error("Context filter key is required");
  const cleaned = raw.startsWith("$.") ? raw.slice(2) : raw.startsWith("$") ? raw.slice(1) : raw;
  const parts = cleaned
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Context filter key is required");
  return parts;
}

function normalizeContextFilters(contextFilters: unknown): NormalizedContextFilter {
  if (!contextFilters || contextFilters === "*") return { op: "AND", conditions: [] };

  if (Array.isArray(contextFilters)) {
    return {
      op: "AND",
      conditions: contextFilters.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Context filter array must contain objects");
        const src = item as Record<string, unknown>;
        return {
          path: toJsonPath(src.path || src.key).join("."),
          operator: String(src.operator || src.op || "eq").toLowerCase() as ContextFilterOperator,
          value: src.value
        };
      })
    };
  }

  if (typeof contextFilters === "object") {
    const src = contextFilters as Record<string, unknown>;
    if (Array.isArray(src.conditions)) {
      const op = String(src.op || "AND").toUpperCase() === "OR" ? "OR" : "AND";
      const conditions = src.conditions.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Each context condition must be an object");
        const condition = item as Record<string, unknown>;
        return {
          path: toJsonPath(condition.path || condition.key).join("."),
          operator: String(condition.operator || condition.op || "eq").toLowerCase() as ContextFilterOperator,
          value: condition.value
        };
      });
      return { op, conditions };
    }

    return {
      op: "AND",
      conditions: Object.entries(src).map(([key, value]) => ({
        path: toJsonPath(key).join("."),
        operator: "eq",
        value
      }))
    };
  }

  throw new Error("Invalid contextFilters");
}

function toTextPath(path: string): string {
  return `{${path
    .split(".")
    .map((segment) => segment.trim().replace(/"/g, '\\"'))
    .filter(Boolean)
    .join(",")}}`;
}

function mapRow(row: Record<string, unknown>): EventRow {
  let parsedContext: Record<string, unknown> = {};
  let parsedCapturedOnOpen: unknown | null = null;
  let parsedCapturedOnClose: unknown | null = null;
  try {
    if (row.context && typeof row.context === "object") parsedContext = row.context as Record<string, unknown>;
    else parsedContext = row.context ? (JSON.parse(String(row.context)) as Record<string, unknown>) : {};
  } catch {
    parsedContext = {};
  }
  try {
    if (row.captured_data_on_open !== undefined && row.captured_data_on_open !== null && typeof row.captured_data_on_open !== "string") {
      parsedCapturedOnOpen = row.captured_data_on_open;
    } else {
      parsedCapturedOnOpen = row.captured_data_on_open
        ? (JSON.parse(String(row.captured_data_on_open)) as unknown)
        : null;
    }
  } catch {
    parsedCapturedOnOpen = null;
  }
  try {
    if (row.captured_data_on_close !== undefined && row.captured_data_on_close !== null && typeof row.captured_data_on_close !== "string") {
      parsedCapturedOnClose = row.captured_data_on_close;
    } else {
      parsedCapturedOnClose = row.captured_data_on_close
        ? (JSON.parse(String(row.captured_data_on_close)) as unknown)
        : null;
    }
  } catch {
    parsedCapturedOnClose = null;
  }
  return {
    id: String(row.id),
    event_path: String(row.event_path),
    start_ts: new Date(String(row.start_ts)).toISOString(),
    end_ts: row.end_ts ? new Date(String(row.end_ts)).toISOString() : null,
    status: String(row.status) === "closed" ? "closed" : "open",
    severity: normalizeSeverity(row.severity || "other"),
    context: parsedContext,
    is_acknowledge: Boolean(row.is_acknowledge),
    acknowledged_ts: row.acknowledged_ts ? new Date(String(row.acknowledged_ts)).toISOString() : null,
    notes_on_open: row.notes_on_open == null ? null : String(row.notes_on_open),
    notes_on_close: row.notes_on_close == null ? null : String(row.notes_on_close),
    captured_data_on_open: parsedCapturedOnOpen,
    captured_data_on_close: parsedCapturedOnClose
  };
}

function buildContextWhere(contextFilters: unknown, params: unknown[]): string {
  const filter = normalizeContextFilters(contextFilters);
  if (filter.conditions.length === 0) return "";
  const chunks: string[] = [];

  for (const condition of filter.conditions) {
    const operator = condition.operator;
    const pathText = toTextPath(condition.path);
    params.push(pathText);
    const pathIdx = params.length;

    if (operator === "exists") {
      chunks.push(`context #> $${pathIdx}::text[] IS NOT NULL`);
      continue;
    }
    if (operator === "not_exists") {
      chunks.push(`context #> $${pathIdx}::text[] IS NULL`);
      continue;
    }

    if (operator === "in" || operator === "not_in") {
      const values = Array.isArray(condition.value) ? condition.value.map((x) => String(x)) : [];
      if (values.length === 0) {
        chunks.push(operator === "in" ? "FALSE" : "TRUE");
        continue;
      }
      params.push(values);
      const valIdx = params.length;
      chunks.push(`(context #>> $${pathIdx}::text[]) ${operator === "in" ? "=" : "!="} ALL($${valIdx}::text[])`);
      continue;
    }

    params.push(String(condition.value ?? ""));
    const valIdx = params.length;
    if (operator === "neq") {
      chunks.push(`(context #>> $${pathIdx}::text[]) <> $${valIdx}`);
    } else {
      chunks.push(`(context #>> $${pathIdx}::text[]) = $${valIdx}`);
    }
  }

  return ` AND (${chunks.join(` ${filter.op} `)})`;
}

function buildBaseWhere(
  query: {
    pattern?: unknown;
    status?: unknown;
    from?: unknown;
    to?: unknown;
    contextFilters?: unknown;
    severity?: unknown;
  },
  params: unknown[]
): string {
  const where = [`event_path LIKE $${params.length + 1} ESCAPE '!'`];
  params.push(wildcardToSqlLike(query.pattern || "*"));

  const normalizedStatus = normalizeStatus(query.status || "*");
  if (normalizedStatus !== "*") {
    where.push(`status = $${params.length + 1}`);
    params.push(normalizedStatus);
  }

  if (query.severity && query.severity !== "*") {
    where.push(`severity = $${params.length + 1}`);
    params.push(normalizeSeverity(query.severity));
  }

  const fromTs = parseIsoTs(query.from || "*", null);
  const toTs = parseIsoTs(query.to || "*", null);
  if (fromTs) {
    where.push(`(end_ts IS NULL OR end_ts >= $${params.length + 1}::timestamptz)`);
    params.push(fromTs);
  }
  if (toTs) {
    where.push(`start_ts <= $${params.length + 1}::timestamptz`);
    params.push(toTs);
  }

  const ctxWhere = buildContextWhere(query.contextFilters || {}, params);
  return `WHERE ${where.join(" AND ")}${ctxWhere}`;
}

function ensureDb(options: EventStoreOptions): DbConnectionManager {
  const db = options.dbConnectionManager;
  if (!db) throw new Error("DB connection manager is required for af_event store");
  return db;
}

export function createEventStore(options: EventStoreOptions = {}): EventStore {
  const db = ensureDb(options);
  const dbCfg = db.getConfig();
  const schema = String(dbCfg.connection.schema).replace(/"/g, "");
  const table = String(dbCfg.tables.event).replace(/"/g, "");
  const database = String(dbCfg.connection.database);
  const tableRef = `"${schema}"."${table}"`;
  const listeners = new Set<(meta: EventStoreChangeMeta) => void>();

  const emitChange = (meta: Omit<EventStoreChangeMeta, "ts">): void => {
    if (listeners.size === 0) return;
    const payload: EventStoreChangeMeta = { ...meta, ts: new Date().toISOString() };
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[eventStore] subscriber error:", message);
      }
    }
  };

  const open: EventStore["open"] = async (
    eventPath,
    ts,
    context = {},
    notesOnOpen = "",
    severity = "other",
    capturedDataOnOpen = null
  ) => {
    const normalizedPath = String(eventPath || "").trim();
    if (!normalizedPath) throw new Error("event_path is required");
    const row = {
      id: randomUUID(),
      event_path: normalizedPath,
      start_ts: toIsoTs(ts),
      severity: normalizeSeverity(severity),
      context: context && typeof context === "object" ? context : {},
      notes_on_open: notesOnOpen == null ? null : String(notesOnOpen),
      captured_data_on_open: capturedDataOnOpen === undefined ? null : capturedDataOnOpen
    };
    const sql = `
      INSERT INTO ${tableRef}
      (id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,captured_data_on_open,captured_data_on_close,updated_at)
      VALUES ($1,$2,$3::timestamptz,NULL,'open',$4,$5::jsonb,FALSE,NULL,$6,NULL,$7::jsonb,NULL,NOW())
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,captured_data_on_open,captured_data_on_close
    `;
    const result = await db.query(sql, [
      row.id,
      row.event_path,
      row.start_ts,
      row.severity,
      JSON.stringify(row.context),
      row.notes_on_open,
      JSON.stringify(row.captured_data_on_open)
    ]);
    const mapped = mapRow(result.rows[0] || row);
    emitChange({ type: "open", row: mapped, rows: [mapped], count: 1 });
    return mapped;
  };

  const close: EventStore["close"] = async (pattern = "*", ts, notesOnClose = "", capturedDataOnClose = null) => {
    const normalizedTs = toIsoTs(ts);
    const likePattern = wildcardToSqlLike(pattern);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const normalizedCapturedOnClose = capturedDataOnClose === undefined ? null : capturedDataOnClose;
    const sql = `
      UPDATE ${tableRef}
      SET
        end_ts = $1::timestamptz,
        status = 'closed',
        notes_on_close = CASE WHEN $2::text IS NULL OR $2::text = '' THEN notes_on_close ELSE $2::text END,
        captured_data_on_close = CASE WHEN $3::jsonb IS NULL THEN captured_data_on_close ELSE $3::jsonb END,
        updated_at = NOW()
      WHERE status = 'open' AND event_path LIKE $4 ESCAPE '!'
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,captured_data_on_open,captured_data_on_close
    `;
    const result = await db.query(sql, [normalizedTs, normalizedNotes, JSON.stringify(normalizedCapturedOnClose), likePattern]);
    const rows = result.rows.map((row) => mapRow(row as Record<string, unknown>));
    if (rows.length > 0) {
      emitChange({ type: "close", pattern: String(pattern || "*"), rows, count: rows.length });
    }
    return {
      pattern: String(pattern || "*"),
      closedCount: Number(result.rowCount || 0),
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
      captured_data_on_close: normalizedCapturedOnClose
    };
  };

  const closeById: EventStore["closeById"] = async (id, ts, notesOnClose = "", capturedDataOnClose = null) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const normalizedTs = toIsoTs(ts);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const normalizedCapturedOnClose = capturedDataOnClose === undefined ? null : capturedDataOnClose;
    const sql = `
      UPDATE ${tableRef}
      SET
        end_ts = $1::timestamptz,
        status = 'closed',
        notes_on_close = CASE WHEN $2::text IS NULL OR $2::text = '' THEN notes_on_close ELSE $2::text END,
        captured_data_on_close = CASE WHEN $3::jsonb IS NULL THEN captured_data_on_close ELSE $3::jsonb END,
        updated_at = NOW()
      WHERE id = $4 AND status = 'open'
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,captured_data_on_open,captured_data_on_close
    `;
    const result = await db.query(sql, [normalizedTs, normalizedNotes, JSON.stringify(normalizedCapturedOnClose), normalizedId]);
    const rows = result.rows.map((row) => mapRow(row as Record<string, unknown>));
    if (rows.length > 0) {
      emitChange({ type: "closeById", id: normalizedId, rows, row: rows[0], count: rows.length });
    }
    return {
      id: normalizedId,
      closedCount: Number(result.rowCount || 0),
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
      captured_data_on_close: normalizedCapturedOnClose
    };
  };

  const acknowledgeById: EventStore["acknowledgeById"] = async (id, ts) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const normalizedTs = toIsoTs(ts);
    const sql = `UPDATE ${tableRef} SET is_acknowledge = TRUE, acknowledged_ts = $1::timestamptz, updated_at = NOW() WHERE id = $2`;
    const result = await db.query(sql, [normalizedTs, normalizedId]);
    if (Number(result.rowCount || 0) > 0) {
      emitChange({ type: "acknowledgeById", id: normalizedId, count: Number(result.rowCount || 0) });
    }
    return {
      id: normalizedId,
      acknowledgedCount: Number(result.rowCount || 0),
      acknowledged_ts: normalizedTs
    };
  };

  const deleteById: EventStore["deleteById"] = async (id) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id is required");
    const result = await db.query(`DELETE FROM ${tableRef} WHERE id = $1`, [normalizedId]);
    if (Number(result.rowCount || 0) > 0) {
      emitChange({ type: "deleteById", id: normalizedId, count: Number(result.rowCount || 0) });
    }
    return { id: normalizedId, deletedCount: Number(result.rowCount || 0) };
  };

  const deleteByPattern: EventStore["deleteByPattern"] = async (pattern = "*", status = "*", from = "*", to = "*", severity = "*") => {
    const params: unknown[] = [];
    const whereSql = buildBaseWhere({ pattern, status, from, to, contextFilters: {}, severity }, params);
    const result = await db.query(`DELETE FROM ${tableRef} ${whereSql}`, params);
    if (Number(result.rowCount || 0) > 0) {
      emitChange({ type: "deleteByPattern", pattern: String(pattern || "*"), count: Number(result.rowCount || 0) });
    }
    return {
      pattern: String(pattern || "*"),
      status: normalizeStatus(status),
      severity: String(severity || "*"),
      deletedCount: Number(result.rowCount || 0)
    };
  };

  const query: EventStore["query"] = async (pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) => {
    const limitRaw = Number(options.limit ?? 1000);
    const offsetRaw = Number(options.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 1000;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const sortBy = normalizeSortBy(options.sortBy || "start_ts");
    const sortDir = normalizeSortDir(options.sortDir || options.sort || "desc");
    const severity = options.severity || "*";

    const baseParams: unknown[] = [];
    const whereSql = buildBaseWhere({ pattern, from, to, status, contextFilters, severity }, baseParams);
    const rowSql = `
      SELECT id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close, captured_data_on_open, captured_data_on_close
      FROM ${tableRef}
      ${whereSql}
      ORDER BY ${sortBy} ${sortDir}
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const rowResult = await db.query(rowSql, [...baseParams, limit, offset]);
    const rows = rowResult.rows.map(mapRow);
    const countResult = await db.query(`SELECT COUNT(1) AS total FROM ${tableRef} ${whereSql}`, baseParams);
    const total = Number((countResult.rows[0] as { total?: number })?.total || 0);
    return { rows, total, limit, offset, sortBy, sortDir };
  };

  const get: EventStore["get"] = async (pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) =>
    (await query(pattern, from, to, status, contextFilters, options)).rows;

  const subscribe: EventStore["subscribe"] = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getMeta: () => ({
      engine: "postgresql",
      database,
      schema,
      table
    }),
    open,
    close,
    closeById,
    acknowledgeById,
    deleteById,
    deleteByPattern,
    get,
    query,
    subscribe,
    shutdown: async () => {}
  };
}

export function ensureEventStore(runtime: Runtime, options: EventStoreOptions = {}): EventStore {
  const existing = runtime.getGlobal<unknown>("eventStore");
  if (
    existing &&
    typeof existing === "object" &&
    typeof (existing as EventStore).open === "function" &&
    typeof (existing as EventStore).close === "function" &&
    typeof (existing as EventStore).get === "function" &&
    typeof (existing as EventStore).subscribe === "function"
  ) {
    return existing as EventStore;
  }
  const dbConnectionManager = runtime.getGlobal<DbConnectionManager | null>("dbConnectionManager", null);
  const store = createEventStore({ ...options, dbConnectionManager });
  const meta = store.getMeta();
  runtime.setGlobal("eventStore", store);
  runtime.setGlobal("eventStoreMeta", meta);
  return store;
}
