import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type Runtime from "./Runtime";
import type { EventRow, EventStore } from "./types";

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
  "acknowledged_ts",
]);

type ContextFilterOperator = "eq" | "neq" | "in" | "not_in" | "exists" | "not_exists";
type ContextFilterCondition = {
  path: string;
  operator: ContextFilterOperator;
  value?: unknown;
};
type NormalizedContextFilter = { op: "AND" | "OR"; conditions: ContextFilterCondition[] };

function epochToMs(value: number): number {
  const abs = Math.abs(value);
  if (abs < 1e11) return value * 1000;
  if (abs < 1e14) return value;
  if (abs < 1e17) return value / 1000;
  return value / 1_000_000;
}

function parseDateLike(ts: unknown): Date | null {
  if (ts == null || ts === "" || ts === "*") return null;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return new Date(epochToMs(ts));
  }
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
  if (!date) return new Date().toISOString();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Timestamp tidak valid: ${String(ts)}`);
  }
  return date.toISOString();
}

function parseIsoTs(ts: unknown, fallback: string | null = null): string | null {
  if (!ts || ts === "*") return fallback;
  const date = parseDateLike(ts);
  if (!date) return fallback;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Timestamp tidak valid: ${String(ts)}`);
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
  if (!VALID_STATUS.has(value)) throw new Error(`Status tidak valid: ${String(status)}`);
  return value;
}

function normalizeSeverity(severity: unknown): EventRow["severity"] {
  const value = String(severity || "other").trim().toLowerCase() as EventRow["severity"];
  if (!VALID_SEVERITY.has(value)) throw new Error(`Severity tidak valid: ${String(severity)}`);
  return value;
}

function normalizeSortBy(sortBy: unknown): string {
  const value = String(sortBy || "start_ts").trim();
  return SORTABLE_COLUMNS.has(value) ? value : "start_ts";
}

function normalizeSortDir(sortDir: unknown): "ASC" | "DESC" {
  return String(sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
}

function toJsonPath(key: unknown): string {
  const raw = String(key || "").trim();
  if (!raw) throw new Error("Context filter key wajib diisi");
  if (raw.startsWith("$")) return raw;
  const parts = raw
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("Context filter key wajib diisi");
  return `$.${parts.join(".")}`;
}

function normalizeContextFilters(contextFilters: unknown): NormalizedContextFilter {
  if (!contextFilters || contextFilters === "*") return { op: "AND", conditions: [] };

  if (Array.isArray(contextFilters)) {
    return {
      op: "AND",
      conditions: contextFilters.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Context filter array harus berisi object");
        const src = item as Record<string, unknown>;
        return {
          path: toJsonPath(src.path || src.key),
          operator: String(src.operator || src.op || "eq").toLowerCase() as ContextFilterOperator,
          value: src.value,
        };
      }),
    };
  }

  if (typeof contextFilters === "object") {
    const src = contextFilters as Record<string, unknown>;
    if (Array.isArray(src.conditions)) {
      const op = String(src.op || "AND").toUpperCase() === "OR" ? "OR" : "AND";
      const conditions = src.conditions.map((item) => {
        if (!item || typeof item !== "object") throw new Error("Setiap context condition harus object");
        const condition = item as Record<string, unknown>;
        return {
          path: toJsonPath(condition.path || condition.key),
          operator: String(condition.operator || condition.op || "eq").toLowerCase() as ContextFilterOperator,
          value: condition.value,
        };
      });
      return { op, conditions };
    }

    return {
      op: "AND",
      conditions: Object.entries(src).map(([key, value]) => ({
        path: toJsonPath(key),
        operator: "eq",
        value,
      })),
    };
  }

  throw new Error("contextFilters tidak valid");
}

function mapRow(row: Record<string, unknown>): EventRow {
  let parsedContext: Record<string, unknown> = {};
  try {
    parsedContext = row.context ? (JSON.parse(String(row.context)) as Record<string, unknown>) : {};
  } catch {
    parsedContext = {};
  }
  return {
    id: String(row.id),
    event_path: String(row.event_path),
    start_ts: String(row.start_ts),
    end_ts: row.end_ts ? String(row.end_ts) : null,
    status: (String(row.status) === "closed" ? "closed" : "open"),
    severity: normalizeSeverity(row.severity || "other"),
    context: parsedContext,
    is_acknowledge: Boolean(row.is_acknowledge),
    acknowledged_ts: row.acknowledged_ts ? String(row.acknowledged_ts) : null,
    notes_on_open: row.notes_on_open == null ? null : String(row.notes_on_open),
    notes_on_close: row.notes_on_close == null ? null : String(row.notes_on_close),
  };
}

function applyMigrations(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(events);").all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((col) => col.name));

  if (!columnNames.has("severity")) db.exec("ALTER TABLE events ADD COLUMN severity TEXT NOT NULL DEFAULT 'other';");
  if (!columnNames.has("notes_on_open")) db.exec("ALTER TABLE events ADD COLUMN notes_on_open TEXT;");
  if (!columnNames.has("notes_on_close")) db.exec("ALTER TABLE events ADD COLUMN notes_on_close TEXT;");
  if (!columnNames.has("is_acknowledge")) db.exec("ALTER TABLE events ADD COLUMN is_acknowledge INTEGER NOT NULL DEFAULT 0;");
  if (!columnNames.has("acknowledged_ts")) db.exec("ALTER TABLE events ADD COLUMN acknowledged_ts TEXT;");
}

function buildContextWhere(contextFilters: unknown, params: unknown[]): string {
  const filter = normalizeContextFilters(contextFilters);
  if (filter.conditions.length === 0) return "";
  const chunks: string[] = [];

  for (const condition of filter.conditions) {
    const operator = condition.operator;
    const pathParam = condition.path;
    if (operator === "exists") {
      params.push(pathParam);
      chunks.push("json_type(context, ?) IS NOT NULL");
      continue;
    }
    if (operator === "not_exists") {
      params.push(pathParam);
      chunks.push("json_type(context, ?) IS NULL");
      continue;
    }

    params.push(pathParam);
    if (operator === "neq") {
      params.push(condition.value);
      chunks.push("json_extract(context, ?) != ?");
      continue;
    }

    if (operator === "in" || operator === "not_in") {
      const values = Array.isArray(condition.value) ? condition.value : [];
      if (values.length === 0) {
        chunks.push(operator === "in" ? "1=0" : "1=1");
        continue;
      }
      const placeholders = values.map(() => "?").join(", ");
      chunks.push(`json_extract(context, ?) ${operator === "in" ? "IN" : "NOT IN"} (${placeholders})`);
      for (const value of values) params.push(value);
      continue;
    }

    params.push(condition.value);
    chunks.push("json_extract(context, ?) = ?");
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
  const where = ["event_path LIKE ? ESCAPE '!'"];
  params.push(wildcardToSqlLike(query.pattern || "*"));

  const normalizedStatus = normalizeStatus(query.status || "*");
  if (normalizedStatus !== "*") {
    where.push("status = ?");
    params.push(normalizedStatus);
  }

  if (query.severity && query.severity !== "*") {
    where.push("severity = ?");
    params.push(normalizeSeverity(query.severity));
  }

  const fromTs = parseIsoTs(query.from || "*", null);
  const toTs = parseIsoTs(query.to || "*", null);
  if (fromTs) {
    where.push("(end_ts IS NULL OR end_ts >= ?)");
    params.push(fromTs);
  }
  if (toTs) {
    where.push("start_ts <= ?");
    params.push(toTs);
  }

  const ctxWhere = buildContextWhere(query.contextFilters || {}, params);
  return `WHERE ${where.join(" AND ")}${ctxWhere}`;
}

interface EventStoreOptions {
  dbPath?: string;
}

export function createEventStore(options: EventStoreOptions = {}): EventStore {
  const dbPath = path.resolve(options.dbPath || process.env.EVENTSYS_DB_PATH || "./event/events.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY UNIQUE,
      event_path TEXT NOT NULL,
      start_ts TEXT NOT NULL,
      end_ts TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      severity TEXT NOT NULL DEFAULT 'other',
      context TEXT NOT NULL DEFAULT '{}',
      is_acknowledge INTEGER NOT NULL DEFAULT 0,
      acknowledged_ts TEXT,
      notes_on_open TEXT,
      notes_on_close TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_path ON events(event_path);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_ts);
    CREATE INDEX IF NOT EXISTS idx_events_end ON events(end_ts);
    CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
    CREATE INDEX IF NOT EXISTS idx_events_ack ON events(is_acknowledge);
  `);
  applyMigrations(db);

  const insertStmt = db.prepare(`
    INSERT INTO events (
      id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close
    )
    VALUES (?, ?, ?, NULL, 'open', ?, ?, 0, NULL, ?, NULL);
  `);

  const open: EventStore["open"] = (eventPath, ts, context = {}, notesOnOpen = "", severity = "other") => {
    const normalizedPath = String(eventPath || "").trim();
    if (!normalizedPath) throw new Error("event_path wajib diisi");
    const eventContext = context && typeof context === "object" ? context : {};
    const normalizedNotes = notesOnOpen == null ? null : String(notesOnOpen);
    const row = {
      id: randomUUID(),
      event_path: normalizedPath,
      start_ts: toIsoTs(ts),
      severity: normalizeSeverity(severity),
      context: JSON.stringify(eventContext),
      notes_on_open: normalizedNotes,
    };
    insertStmt.run(row.id, row.event_path, row.start_ts, row.severity, row.context, row.notes_on_open);
    return {
      ...row,
      end_ts: null,
      status: "open",
      is_acknowledge: false,
      acknowledged_ts: null,
      notes_on_close: null,
      context: eventContext,
    };
  };

  const close: EventStore["close"] = (pattern = "*", ts, notesOnClose = "") => {
    const normalizedTs = toIsoTs(ts);
    const likePattern = wildcardToSqlLike(pattern);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const result = db
      .prepare(`
        UPDATE events
        SET end_ts = ?, status = 'closed', notes_on_close = CASE WHEN ? IS NULL OR ? = '' THEN notes_on_close ELSE ? END
        WHERE status = 'open' AND event_path LIKE ? ESCAPE '!';
      `)
      .run(normalizedTs, normalizedNotes, normalizedNotes, normalizedNotes, likePattern);
    return {
      pattern: String(pattern || "*"),
      closedCount: Number(result.changes || 0),
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
    };
  };

  const closeById: EventStore["closeById"] = (id, ts, notesOnClose = "") => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id wajib diisi");
    const normalizedTs = toIsoTs(ts);
    const normalizedNotes = notesOnClose == null ? null : String(notesOnClose);
    const result = db
      .prepare(`
        UPDATE events
        SET end_ts = ?, status = 'closed', notes_on_close = CASE WHEN ? IS NULL OR ? = '' THEN notes_on_close ELSE ? END
        WHERE id = ? AND status = 'open';
      `)
      .run(normalizedTs, normalizedNotes, normalizedNotes, normalizedNotes, normalizedId);
    return {
      id: normalizedId,
      closedCount: Number(result.changes || 0),
      ts: normalizedTs,
      notes_on_close: normalizedNotes,
    };
  };

  const acknowledgeById: EventStore["acknowledgeById"] = (id, ts) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id wajib diisi");
    const normalizedTs = toIsoTs(ts);
    const result = db.prepare("UPDATE events SET is_acknowledge = 1, acknowledged_ts = ? WHERE id = ?;").run(normalizedTs, normalizedId);
    return {
      id: normalizedId,
      acknowledgedCount: Number(result.changes || 0),
      acknowledged_ts: normalizedTs,
    };
  };

  const deleteById: EventStore["deleteById"] = (id) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) throw new Error("id wajib diisi");
    const result = db.prepare("DELETE FROM events WHERE id = ?;").run(normalizedId);
    return { id: normalizedId, deletedCount: Number(result.changes || 0) };
  };

  const deleteByPattern: EventStore["deleteByPattern"] = (pattern = "*", status = "*", from = "*", to = "*", severity = "*") => {
    const params: unknown[] = [];
    const whereSql = buildBaseWhere({ pattern, status, from, to, contextFilters: {}, severity }, params);
    const result = db.prepare(`DELETE FROM events ${whereSql};`).run(...params);
    return {
      pattern: String(pattern || "*"),
      status: normalizeStatus(status),
      severity: String(severity || "*"),
      deletedCount: Number(result.changes || 0),
    };
  };

  const query: EventStore["query"] = (pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) => {
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
      SELECT id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close
      FROM events
      ${whereSql}
      ORDER BY ${sortBy} ${sortDir}
      LIMIT ? OFFSET ?;
    `;
    const rowParams = [...baseParams, limit, offset];
    const rows = (db.prepare(rowSql).all(...rowParams) as Record<string, unknown>[]).map(mapRow);
    const countRow = db.prepare(`SELECT COUNT(1) AS total FROM events ${whereSql};`).get(...baseParams) as { total?: number };
    const total = Number(countRow?.total || 0);
    return { rows, total, limit, offset, sortBy, sortDir };
  };

  const get: EventStore["get"] = (pattern = "*", from = "*", to = "*", status = "*", contextFilters = {}, options = {}) => {
    return query(pattern, from, to, status, contextFilters, options).rows;
  };

  return {
    dbPath,
    open,
    close,
    closeById,
    acknowledgeById,
    deleteById,
    deleteByPattern,
    get,
    query,
    shutdown: () => {
      db.close();
    },
  };
}

export function ensureEventStore(runtime: Runtime, options: EventStoreOptions = {}): EventStore {
  const existing = runtime.getGlobal<unknown>("eventStore");
  if (
    existing &&
    typeof existing === "object" &&
    typeof (existing as EventStore).open === "function" &&
    typeof (existing as EventStore).close === "function" &&
    typeof (existing as EventStore).get === "function"
  ) {
    return existing as EventStore;
  }
  const store = createEventStore(options);
  runtime.setGlobal("eventStore", store);
  runtime.setGlobal("eventStoreMeta", { dbPath: store.dbPath });
  return store;
}
