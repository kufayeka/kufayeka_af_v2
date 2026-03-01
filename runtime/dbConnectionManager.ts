import { Pool } from "pg";
import type { DbRuntimeConfig } from "./dbConfig";

export interface HistorianPointRow {
  ts: Date;
  attributePath: string;
  value: unknown;
}

export interface EventMirrorRow {
  id: string;
  event_path: string;
  start_ts: string;
  end_ts: string | null;
  status: "open" | "closed";
  severity: string;
  context: Record<string, unknown>;
  is_acknowledge: boolean;
  acknowledged_ts: string | null;
  notes_on_open: string | null;
  notes_on_close: string | null;
  captured_data_on_open: unknown | null;
  captured_data_on_close: unknown | null;
}

type EventQueueItem =
  | { kind: "upsert"; row: EventMirrorRow }
  | { kind: "delete"; id: string };

interface QueryOptions {
  from?: string;
  to?: string;
  order?: "asc" | "desc";
  time?: "iso" | "epoch";
  limit?: number;
  bucketMs?: number;
  agg?: string;
  timestampUnit?: "us" | "ns";
}

function sanitizeIdentifier(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "");
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function epochToMs(value: number): number {
  const abs = Math.abs(value);
  if (abs < 1e11) return value * 1000;
  if (abs < 1e14) return value;
  if (abs < 1e17) return value / 1000;
  return value / 1_000_000;
}

function parseTimestampInput(raw: string, name: string): Date {
  const source = String(raw || "").trim();
  if (!source) throw new Error(`${name} is required`);
  if (/^[+-]?\d+(\.\d+)?$/.test(source)) {
    const n = Number(source);
    if (!Number.isFinite(n)) throw new Error(`${name} is invalid`);
    return new Date(epochToMs(n));
  }
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be ISO or epoch`);
  return d;
}

function formatTime(date: Date, mode: "iso" | "epoch", unit: "us" | "ns"): string {
  if (mode === "iso") return date.toISOString();
  const ms = date.getTime();
  if (unit === "ns") return String(Math.trunc(ms * 1_000_000));
  return String(Math.trunc(ms * 1000));
}

type BucketAggState = {
  count: number;
  sum: number;
  numCount: number;
  min: number | null;
  max: number | null;
  first: unknown;
  last: unknown;
};

function accumulateAgg(state: BucketAggState, value: unknown): void {
  state.count += 1;
  if (state.first === undefined) state.first = value;
  state.last = value;
  const n = toFiniteNumber(value);
  if (n == null) return;
  state.sum += n;
  state.numCount += 1;
  if (state.min == null || n < state.min) state.min = n;
  if (state.max == null || n > state.max) state.max = n;
}

function aggregateValue(agg: string, state: BucketAggState): unknown {
  const op = String(agg || "avg").toLowerCase();
  if (op === "count") return state.count;
  if (op === "first") return state.first;
  if (op === "last") return state.last;
  if (op === "min") return state.min;
  if (op === "max") return state.max;
  if (op === "avg") return state.numCount > 0 ? state.sum / state.numCount : null;
  return state.numCount > 0 ? state.sum / state.numCount : null;
}

export class DbConnectionManager {
  private readonly cfg: DbRuntimeConfig;
  private pool: Pool | null = null;
  private historianQueue: HistorianPointRow[] = [];
  private eventQueue: EventQueueItem[] = [];
  private historianTimer: NodeJS.Timeout | null = null;
  private eventTimer: NodeJS.Timeout | null = null;
  private historianFlushing = false;
  private eventFlushing = false;
  private readonly logs: Array<{ ts: string; level: string; message: string; meta?: Record<string, unknown> }> = [];
  private metrics = {
    historianInsertedRowsTotal: 0,
    historianDroppedRowsTotal: 0,
    eventUpsertedRowsTotal: 0,
    eventDeletedRowsTotal: 0,
    flushErrorsTotal: 0,
    queryCountTotal: 0,
    queryErrorsTotal: 0
  };

  constructor(config: DbRuntimeConfig) {
    this.cfg = config;
  }

  private log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
    const entry = { ts: new Date().toISOString(), level, message, meta };
    this.logs.push(entry);
    if (this.logs.length > 5000) {
      this.logs.splice(0, this.logs.length - 5000);
    }
    if (level === "error") console.error(`[db] ${message}`, meta || "");
    else if (level === "warn") console.warn(`[db] ${message}`, meta || "");
    else console.log(`[db] ${message}`, meta || "");
  }

  private tableRef(tableName: string): string {
    const schema = sanitizeIdentifier(this.cfg.connection.schema) || "public";
    const table = sanitizeIdentifier(tableName);
    return `"${schema}"."${table}"`;
  }

  private get historianTableRef(): string {
    return this.tableRef(this.cfg.tables.historian || "af_historian");
  }

  private get eventTableRef(): string {
    return this.tableRef(this.cfg.tables.event || "af_event");
  }

  private async createDatabaseIfNeeded(): Promise<void> {
    const dbName = sanitizeIdentifier(this.cfg.connection.database) || "af";
    const requestedAdminDb = sanitizeIdentifier(this.cfg.connection.adminDatabase) || "postgres";
    const candidates = [requestedAdminDb, "postgres", "template1"].filter((v, i, arr) => v && arr.indexOf(v) === i);

    let lastError: unknown = null;
    for (const adminDb of candidates) {
      const adminPool = new Pool({
        host: this.cfg.connection.host,
        port: this.cfg.connection.port,
        user: this.cfg.connection.user,
        password: this.cfg.connection.password,
        database: adminDb,
        ssl: this.cfg.connection.ssl ? { rejectUnauthorized: false } : undefined
      });
      try {
        const check = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
        if (check.rowCount && check.rowCount > 0) return;
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
        this.log("info", "created database", { database: dbName, adminDatabase: adminDb });
        return;
      } catch (error: unknown) {
        lastError = error;
        const code = (error as { code?: string })?.code || "";
        if (code !== "3D000" && code !== "42P04") {
          throw error;
        }
      } finally {
        await adminPool.end();
      }
    }
    if (lastError) throw lastError;
  }

  async init(): Promise<void> {
    await this.createDatabaseIfNeeded();
    this.pool = new Pool({
      host: this.cfg.connection.host,
      port: this.cfg.connection.port,
      user: this.cfg.connection.user,
      password: this.cfg.connection.password,
      database: this.cfg.connection.database,
      ssl: this.cfg.connection.ssl ? { rejectUnauthorized: false } : undefined,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000
    });
    this.pool.on("error", (error: Error) => {
      this.log("warn", "db pool idle client error", { error: error.message });
    });

    const schema = sanitizeIdentifier(this.cfg.connection.schema) || "public";
    const client = await this.pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.historianTableRef} (
          ts TIMESTAMPTZ NOT NULL,
          attribute_path TEXT NOT NULL,
          value JSONB NOT NULL
        )`
      );
      await client.query(
        `SELECT create_hypertable('${schema}.${sanitizeIdentifier(this.cfg.tables.historian) || "af_historian"}', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.historian)}_path_ts ON ${this.historianTableRef} (attribute_path, ts DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.historian)}_ts ON ${this.historianTableRef} (ts DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.eventTableRef} (
          id TEXT PRIMARY KEY,
          event_path TEXT NOT NULL,
          start_ts TIMESTAMPTZ NOT NULL,
          end_ts TIMESTAMPTZ NULL,
          status TEXT NOT NULL,
          severity TEXT NOT NULL,
          context JSONB NOT NULL DEFAULT '{}'::jsonb,
          is_acknowledge BOOLEAN NOT NULL DEFAULT FALSE,
          acknowledged_ts TIMESTAMPTZ NULL,
          notes_on_open TEXT NULL,
          notes_on_close TEXT NULL,
          captured_data_on_open JSONB NULL,
          captured_data_on_close JSONB NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
      );
      await client.query(`ALTER TABLE ${this.eventTableRef} ADD COLUMN IF NOT EXISTS captured_data_on_open JSONB NULL`);
      await client.query(`ALTER TABLE ${this.eventTableRef} ADD COLUMN IF NOT EXISTS captured_data_on_close JSONB NULL`);
      await client.query(
        `ALTER TABLE ${this.eventTableRef}
         ALTER COLUMN captured_data_on_open TYPE JSONB
         USING captured_data_on_open::jsonb`
      );
      await client.query(
        `ALTER TABLE ${this.eventTableRef}
         ALTER COLUMN captured_data_on_close TYPE JSONB
         USING captured_data_on_close::jsonb`
      );
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.event)}_path ON ${this.eventTableRef} (event_path)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.event)}_status ON ${this.eventTableRef} (status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.event)}_start_ts ON ${this.eventTableRef} (start_ts DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.tables.event)}_updated_at ON ${this.eventTableRef} (updated_at DESC)`);

      this.log("info", "db connection ready", {
        database: this.cfg.connection.database,
        schema: this.cfg.connection.schema,
        historianTable: this.cfg.tables.historian,
        eventTable: this.cfg.tables.event
      });
    } finally {
      client.release();
    }

    if (this.cfg.queue.historian.enabled) {
      this.historianTimer = setInterval(() => {
        void this.flushHistorian();
      }, Math.max(50, this.cfg.queue.historian.flushIntervalMs));
      this.historianTimer.unref?.();
    }
    if (this.cfg.queue.event.enabled) {
      this.eventTimer = setInterval(() => {
        void this.flushEvent();
      }, Math.max(50, this.cfg.queue.event.flushIntervalMs));
      this.eventTimer.unref?.();
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const started = Date.now();
    if (!this.pool) {
      return { ok: false, message: "Database pool not initialized", latencyMs: Date.now() - started };
    }
    try {
      await this.pool.query("SELECT 1");
      return { ok: true, message: "Connection is healthy", latencyMs: Date.now() - started };
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - started };
    }
  }

  enqueueHistorian(row: HistorianPointRow): void {
    if (!this.cfg.queue.historian.enabled || !this.cfg.enabled) return;
    if (!row.attributePath) {
      this.metrics.historianDroppedRowsTotal += 1;
      return;
    }
    this.historianQueue.push(row);
    if (this.historianQueue.length > this.cfg.queue.historian.maxQueue) {
      const overflow = this.historianQueue.length - this.cfg.queue.historian.maxQueue;
      this.historianQueue.splice(0, overflow);
      this.metrics.historianDroppedRowsTotal += overflow;
    }
    if (this.historianQueue.length >= this.cfg.queue.historian.batchSize) {
      void this.flushHistorian();
    }
  }

  enqueueEventUpsert(row: EventMirrorRow): void {
    if (!this.cfg.queue.event.enabled || !this.cfg.enabled) return;
    this.eventQueue.push({ kind: "upsert", row });
    if (this.eventQueue.length > this.cfg.queue.event.maxQueue) {
      const overflow = this.eventQueue.length - this.cfg.queue.event.maxQueue;
      this.eventQueue.splice(0, overflow);
    }
    if (this.eventQueue.length >= this.cfg.queue.event.batchSize) {
      void this.flushEvent();
    }
  }

  enqueueEventDelete(id: string): void {
    if (!this.cfg.queue.event.enabled || !this.cfg.enabled) return;
    if (!id) return;
    this.eventQueue.push({ kind: "delete", id });
    if (this.eventQueue.length > this.cfg.queue.event.maxQueue) {
      const overflow = this.eventQueue.length - this.cfg.queue.event.maxQueue;
      this.eventQueue.splice(0, overflow);
    }
    if (this.eventQueue.length >= this.cfg.queue.event.batchSize) {
      void this.flushEvent();
    }
  }

  private async flushHistorian(): Promise<void> {
    if (this.historianFlushing) return;
    if (!this.pool || this.historianQueue.length === 0) return;
    this.historianFlushing = true;
    try {
      const batchSize = Math.max(1, this.cfg.queue.historian.batchSize);
      while (this.historianQueue.length > 0) {
        const chunk = this.historianQueue.splice(0, batchSize);
        const valuesSql: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;
        for (const row of chunk) {
          valuesSql.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}::jsonb)`);
          params.push(row.ts.toISOString(), row.attributePath, JSON.stringify(row.value ?? null));
          paramIdx += 3;
        }
        if (valuesSql.length === 0) continue;
        const sql = `INSERT INTO ${this.historianTableRef} (ts, attribute_path, value) VALUES ${valuesSql.join(",")}`;
        await this.pool.query(sql, params);
        this.metrics.historianInsertedRowsTotal += valuesSql.length;
      }
    } catch (error: unknown) {
      this.metrics.flushErrorsTotal += 1;
      this.log("error", "historian flush error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.historianFlushing = false;
    }
  }

  private async flushEvent(): Promise<void> {
    if (this.eventFlushing) return;
    if (!this.pool || this.eventQueue.length === 0) return;
    this.eventFlushing = true;
    try {
      const batchSize = Math.max(1, this.cfg.queue.event.batchSize);
      while (this.eventQueue.length > 0) {
        const chunk = this.eventQueue.splice(0, batchSize);
        const upserts = chunk.filter((item): item is { kind: "upsert"; row: EventMirrorRow } => item.kind === "upsert");
        const deletes = chunk.filter((item): item is { kind: "delete"; id: string } => item.kind === "delete");

        if (upserts.length > 0) {
          const valuesSql: string[] = [];
          const params: unknown[] = [];
          let idx = 1;
          for (const { row } of upserts) {
            valuesSql.push(
              `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6}::jsonb,$${idx + 7},$${idx + 8},$${idx + 9},$${idx + 10},$${idx + 11}::jsonb,$${idx + 12}::jsonb,NOW())`
            );
            params.push(
              row.id,
              row.event_path,
              row.start_ts,
              row.end_ts,
              row.status,
              row.severity,
              JSON.stringify(row.context ?? {}),
              row.is_acknowledge,
              row.acknowledged_ts,
              row.notes_on_open,
              row.notes_on_close,
              JSON.stringify(row.captured_data_on_open ?? null),
              JSON.stringify(row.captured_data_on_close ?? null)
            );
            idx += 13;
          }
          const sql = `
            INSERT INTO ${this.eventTableRef}
            (id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,captured_data_on_open,captured_data_on_close,updated_at)
            VALUES ${valuesSql.join(",")}
            ON CONFLICT (id) DO UPDATE SET
              event_path = EXCLUDED.event_path,
              start_ts = EXCLUDED.start_ts,
              end_ts = EXCLUDED.end_ts,
              status = EXCLUDED.status,
              severity = EXCLUDED.severity,
              context = EXCLUDED.context,
              is_acknowledge = EXCLUDED.is_acknowledge,
              acknowledged_ts = EXCLUDED.acknowledged_ts,
              notes_on_open = EXCLUDED.notes_on_open,
              notes_on_close = EXCLUDED.notes_on_close,
              captured_data_on_open = EXCLUDED.captured_data_on_open,
              captured_data_on_close = EXCLUDED.captured_data_on_close,
              updated_at = NOW()
          `;
          await this.pool.query(sql, params);
          this.metrics.eventUpsertedRowsTotal += upserts.length;
        }

        if (deletes.length > 0) {
          const ids = deletes.map((item) => item.id).filter(Boolean);
          if (ids.length > 0) {
            await this.pool.query(`DELETE FROM ${this.eventTableRef} WHERE id = ANY($1::text[])`, [ids]);
            this.metrics.eventDeletedRowsTotal += ids.length;
          }
        }
      }
    } catch (error: unknown) {
      this.metrics.flushErrorsTotal += 1;
      this.log("error", "event flush error", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.eventFlushing = false;
    }
  }

  private async queryRows(paths: string[], from: Date, to: Date, order: "asc" | "desc", limit: number): Promise<Array<{ ts: Date; attribute_path: string; value: unknown }>> {
    if (!this.pool) return [];
    const safeLimit = Math.max(1, Math.min(limit, this.cfg.connection.maxQueryRows));
    const sql = `
      SELECT ts, attribute_path, value
      FROM ${this.historianTableRef}
      WHERE attribute_path = ANY($1::text[])
        AND ts >= $2::timestamptz
        AND ts <= $3::timestamptz
      ORDER BY ts ${order === "asc" ? "ASC" : "DESC"}
      LIMIT $4
    `;
    const res = await this.pool.query(sql, [paths, from.toISOString(), to.toISOString(), safeLimit]);
    return (res.rows || []).map((row) => ({
      ts: new Date(String(row.ts)),
      attribute_path: String(row.attribute_path),
      value: row.value
    }));
  }

  private pivotRows(
    rows: Array<{ ts: Date; attribute_path: string; value: unknown }>,
    opts: { time: "iso" | "epoch"; timestampUnit: "us" | "ns"; order: "asc" | "desc"; limit: number }
  ): Array<Record<string, unknown>> {
    const map = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      const key = row.ts.getTime();
      const existing = map.get(key) || { time: formatTime(row.ts, opts.time, opts.timestampUnit) };
      existing[row.attribute_path] = row.value;
      map.set(key, existing);
    }
    const keys = Array.from(map.keys()).sort((a, b) => (opts.order === "asc" ? a - b : b - a));
    return keys.slice(0, opts.limit).map((k) => map.get(k) as Record<string, unknown>);
  }

  async queryRaw(paths: string[], options: QueryOptions): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }> {
    this.metrics.queryCountTotal += 1;
    try {
      const from = parseTimestampInput(String(options.from || ""), "from");
      const to = parseTimestampInput(String(options.to || ""), "to");
      if (to.getTime() < from.getTime()) throw new Error("to must be >= from");
      const order = options.order === "asc" ? "asc" : "desc";
      const time = options.time === "epoch" ? "epoch" : "iso";
      const limit = Math.max(1, Number(options.limit || 1000));
      const rows = await this.queryRows(paths, from, to, order, limit + 1);
      const truncated = rows.length > limit;
      const slice = truncated ? rows.slice(0, limit) : rows;
      return {
        rows: this.pivotRows(slice, {
          time,
          timestampUnit: options.timestampUnit === "ns" ? "ns" : "us",
          order,
          limit
        }),
        truncated
      };
    } catch (error: unknown) {
      this.metrics.queryErrorsTotal += 1;
      throw error;
    }
  }

  async queryLast(paths: string[], options: QueryOptions): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }> {
    if (!this.pool) return { rows: [], truncated: false };
    this.metrics.queryCountTotal += 1;
    try {
      const time = options.time === "epoch" ? "epoch" : "iso";
      const unit = options.timestampUnit === "ns" ? "ns" : "us";
      const sql = `
        SELECT DISTINCT ON (attribute_path) attribute_path, ts, value
        FROM ${this.historianTableRef}
        WHERE attribute_path = ANY($1::text[])
        ORDER BY attribute_path, ts DESC
      `;
      const res = await this.pool.query(sql, [paths]);
      const flatRows = (res.rows || []).map((row) => ({
        ts: new Date(String(row.ts)),
        attribute_path: String(row.attribute_path),
        value: row.value
      }));
      const pivoted = this.pivotRows(flatRows, { time, timestampUnit: unit, order: "desc", limit: paths.length || 1 });
      return { rows: pivoted, truncated: false };
    } catch (error: unknown) {
      this.metrics.queryErrorsTotal += 1;
      throw error;
    }
  }

  async queryFirst(paths: string[], options: QueryOptions): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }> {
    if (!this.pool) return { rows: [], truncated: false };
    this.metrics.queryCountTotal += 1;
    try {
      const from = parseTimestampInput(String(options.from || ""), "from");
      const to = parseTimestampInput(String(options.to || ""), "to");
      if (to.getTime() < from.getTime()) throw new Error("to must be >= from");
      const time = options.time === "epoch" ? "epoch" : "iso";
      const unit = options.timestampUnit === "ns" ? "ns" : "us";
      const sql = `
        SELECT DISTINCT ON (attribute_path) attribute_path, ts, value
        FROM ${this.historianTableRef}
        WHERE attribute_path = ANY($1::text[])
          AND ts >= $2::timestamptz
          AND ts <= $3::timestamptz
        ORDER BY attribute_path, ts ASC
      `;
      const res = await this.pool.query(sql, [paths, from.toISOString(), to.toISOString()]);
      const flatRows = (res.rows || []).map((row) => ({
        ts: new Date(String(row.ts)),
        attribute_path: String(row.attribute_path),
        value: row.value
      }));
      const pivoted = this.pivotRows(flatRows, { time, timestampUnit: unit, order: "asc", limit: paths.length || 1 });
      return { rows: pivoted, truncated: false };
    } catch (error: unknown) {
      this.metrics.queryErrorsTotal += 1;
      throw error;
    }
  }

  async queryRange(paths: string[], options: QueryOptions): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean; agg?: string }> {
    this.metrics.queryCountTotal += 1;
    try {
      const from = parseTimestampInput(String(options.from || ""), "from");
      const to = parseTimestampInput(String(options.to || ""), "to");
      if (to.getTime() < from.getTime()) throw new Error("to must be >= from");
      const order = options.order === "asc" ? "asc" : "desc";
      const time = options.time === "epoch" ? "epoch" : "iso";
      const unit = options.timestampUnit === "ns" ? "ns" : "us";
      const limit = Math.max(1, Number(options.limit || 1000));
      const agg = String(options.agg || "avg");
      const bucketMs = Number(options.bucketMs || 0);
      const raw = await this.queryRows(paths, from, to, "asc", this.cfg.connection.maxQueryRows);

      if (agg.toLowerCase() === "delta" || agg.toLowerCase() === "reversedelta") {
        const outRow: Record<string, unknown> = { time: formatTime(to, time, unit) };
        for (const path of paths) {
          const vals = raw.filter((x) => x.attribute_path === path);
          if (vals.length === 0) {
            outRow[path] = null;
            continue;
          }
          const firstNum = toFiniteNumber(vals[0].value);
          const lastNum = toFiniteNumber(vals[vals.length - 1].value);
          if (firstNum == null || lastNum == null) {
            outRow[path] = null;
            continue;
          }
          outRow[path] = agg.toLowerCase() === "reversedelta" ? firstNum - lastNum : lastNum - firstNum;
        }
        return { rows: [outRow], truncated: false, agg };
      }

      if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
        const pivoted = this.pivotRows(raw, { time, timestampUnit: unit, order, limit });
        const truncated = pivoted.length > limit;
        return { rows: pivoted.slice(0, limit), truncated, agg };
      }

      const startMs = from.getTime();
      const states = new Map<string, Map<number, BucketAggState>>();
      for (const row of raw) {
        const bucket = Math.floor((row.ts.getTime() - startMs) / bucketMs) * bucketMs + startMs;
        if (!states.has(row.attribute_path)) states.set(row.attribute_path, new Map<number, BucketAggState>());
        const perPath = states.get(row.attribute_path) as Map<number, BucketAggState>;
        if (!perPath.has(bucket)) {
          perPath.set(bucket, {
            count: 0,
            sum: 0,
            numCount: 0,
            min: null,
            max: null,
            first: undefined,
            last: undefined
          });
        }
        accumulateAgg(perPath.get(bucket) as BucketAggState, row.value);
      }

      const bucketRows = new Map<number, Record<string, unknown>>();
      for (const [path, buckets] of states.entries()) {
        for (const [bucket, state] of buckets.entries()) {
          const row = bucketRows.get(bucket) || { time: formatTime(new Date(bucket), time, unit) };
          row[path] = aggregateValue(agg, state);
          bucketRows.set(bucket, row);
        }
      }
      const keys = Array.from(bucketRows.keys()).sort((a, b) => (order === "asc" ? a - b : b - a));
      const out = keys.slice(0, limit).map((k) => bucketRows.get(k) as Record<string, unknown>);
      const truncated = keys.length > limit;
      return { rows: out, truncated, agg };
    } catch (error: unknown) {
      this.metrics.queryErrorsTotal += 1;
      throw error;
    }
  }

  async deleteByPaths(paths: string[], from?: string, to?: string): Promise<{ deletedRecords: number; touchedSegments: number }> {
    if (!this.pool) return { deletedRecords: 0, touchedSegments: 0 };
    const params: unknown[] = [paths];
    let where = "attribute_path = ANY($1::text[])";
    if (from) {
      params.push(parseTimestampInput(from, "from").toISOString());
      where += ` AND ts >= $${params.length}::timestamptz`;
    }
    if (to) {
      params.push(parseTimestampInput(to, "to").toISOString());
      where += ` AND ts <= $${params.length}::timestamptz`;
    }
    const sql = `DELETE FROM ${this.historianTableRef} WHERE ${where}`;
    const res = await this.pool.query(sql, params);
    return { deletedRecords: Number(res.rowCount || 0), touchedSegments: 0 };
  }

  async executeSql(sql: string): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> {
    if (!this.pool) throw new Error("Database pool is not initialized");
    const trimmed = String(sql || "").trim();
    if (!trimmed) throw new Error("SQL is required");
    const forbidden = /\b(DROP|TRUNCATE|ALTER|CREATE\s+ROLE|GRANT|REVOKE)\b/i;
    if (forbidden.test(trimmed)) {
      throw new Error("SQL tester only allows safe DML/SELECT statements");
    }
    const res = await this.pool.query(trimmed);
    return { rows: (res.rows || []) as Array<Record<string, unknown>>, rowCount: Number(res.rowCount || 0) };
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }> {
    if (!this.pool) throw new Error("Database pool is not initialized");
    const res = await this.pool.query(sql, params);
    return { rows: (res.rows || []) as Array<Record<string, unknown>>, rowCount: Number(res.rowCount || 0) };
  }

  getMetrics(): Record<string, unknown> {
    return {
      ...this.metrics,
      queue: {
        historian: this.historianQueue.length,
        event: this.eventQueue.length
      },
      database: this.cfg.connection.database,
      schema: this.cfg.connection.schema,
      historianTable: this.cfg.tables.historian,
      eventTable: this.cfg.tables.event
    };
  }

  getLogs(kind = "", limit = 100): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit || 100)));
    const normalized = String(kind || "").trim().toLowerCase();
    const list = this.logs.filter((item) => !normalized || item.level === normalized || item.message.toLowerCase().includes(normalized));
    return list.slice(Math.max(0, list.length - safeLimit));
  }

  getConfig(): DbRuntimeConfig {
    return structuredClone(this.cfg);
  }

  async flushNow(): Promise<void> {
    await this.flushHistorian();
    await this.flushEvent();
  }

  async shutdown(): Promise<void> {
    if (this.historianTimer) {
      clearInterval(this.historianTimer);
      this.historianTimer = null;
    }
    if (this.eventTimer) {
      clearInterval(this.eventTimer);
      this.eventTimer = null;
    }
    await this.flushNow();
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }
}

export async function createDbConnectionManager(config: DbRuntimeConfig): Promise<DbConnectionManager> {
  const manager = new DbConnectionManager(config);
  await manager.init();
  return manager;
}
