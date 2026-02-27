import { Pool, PoolClient } from "pg";
import type { HistorianRuntimeConfig } from "./historianConfig";

export interface HistorianPointRow {
  ts: Date;
  attributePath: string;
  value: unknown;
}

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

export interface HistorianQueryResult {
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  agg?: string;
}

interface HistorianMetrics {
  insertedRowsTotal: number;
  droppedRowsTotal: number;
  queryCountTotal: number;
  queryErrorsTotal: number;
  deleteCountTotal: number;
}

interface TimescaleInitOptions {
  config: HistorianRuntimeConfig["timescale"];
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

function sanitizeIdentifier(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "");
}

class TimescaleHistorianStore {
  private readonly cfg: HistorianRuntimeConfig["timescale"];
  private pool: Pool | null = null;
  private metrics: HistorianMetrics = {
    insertedRowsTotal: 0,
    droppedRowsTotal: 0,
    queryCountTotal: 0,
    queryErrorsTotal: 0,
    deleteCountTotal: 0
  };
  private readonly logs: Array<{ ts: string; level: string; message: string; meta?: Record<string, unknown> }> = [];

  constructor(options: TimescaleInitOptions) {
    this.cfg = options.config;
  }

  private log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
    const entry = { ts: new Date().toISOString(), level, message, meta };
    this.logs.push(entry);
    if (this.logs.length > 5000) {
      this.logs.splice(0, this.logs.length - 5000);
    }
    if (level === "error") console.error(`[historian-timescale] ${message}`, meta || "");
    else if (level === "warn") console.warn(`[historian-timescale] ${message}`, meta || "");
    else console.log(`[historian-timescale] ${message}`, meta || "");
  }

  private tableRef(): string {
    const schema = sanitizeIdentifier(this.cfg.schema) || "public";
    const table = sanitizeIdentifier(this.cfg.table) || "af_historian";
    return `"${schema}"."${table}"`;
  }

  private async createDatabaseIfNeeded(): Promise<void> {
    const adminPool = new Pool({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.adminDatabase || "postgres",
      ssl: this.cfg.ssl ? { rejectUnauthorized: false } : undefined
    });
    try {
      const check = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [this.cfg.database]);
      if (check.rowCount && check.rowCount > 0) return;
      const dbName = sanitizeIdentifier(this.cfg.database) || "af";
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      this.log("info", "created database", { database: dbName });
    } finally {
      await adminPool.end();
    }
  }

  async init(): Promise<void> {
    await this.createDatabaseIfNeeded();
    this.pool = new Pool({
      host: this.cfg.host,
      port: this.cfg.port,
      user: this.cfg.user,
      password: this.cfg.password,
      database: this.cfg.database,
      ssl: this.cfg.ssl ? { rejectUnauthorized: false } : undefined
    });
    const tableRef = this.tableRef();
    const schema = sanitizeIdentifier(this.cfg.schema) || "public";
    const chunkHours = Math.max(1, this.cfg.chunkIntervalHours);
    const client = await this.pool.connect();
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${tableRef} (
          ts TIMESTAMPTZ NOT NULL,
          attribute_path TEXT NOT NULL,
          value JSONB NOT NULL
        )`
      );
      await client.query(
        `SELECT create_hypertable('${schema}.${sanitizeIdentifier(this.cfg.table) || "af_historian"}', 'ts', chunk_time_interval => INTERVAL '${chunkHours} hours', if_not_exists => TRUE, migrate_data => TRUE)`
      );
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.table)}_path_ts ON ${tableRef} (attribute_path, ts DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${sanitizeIdentifier(this.cfg.table)}_ts ON ${tableRef} (ts DESC)`);
      this.log("info", "timescaledb historian ready", {
        database: this.cfg.database,
        table: `${schema}.${sanitizeIdentifier(this.cfg.table) || "af_historian"}`,
        chunkIntervalHours: chunkHours
      });
    } finally {
      client.release();
    }
  }

  async ingest(rows: HistorianPointRow[]): Promise<void> {
    if (!this.pool || rows.length === 0) return;
    const batchSize = Math.max(1, this.cfg.ingestBatchSize || 1000);
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const valuesSql: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;
      for (const row of chunk) {
        if (!row.attributePath) {
          this.metrics.droppedRowsTotal += 1;
          continue;
        }
        valuesSql.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}::jsonb)`);
        params.push(row.ts.toISOString(), row.attributePath, JSON.stringify(row.value ?? null));
        paramIdx += 3;
      }
      if (valuesSql.length === 0) continue;
      const sql = `INSERT INTO ${this.tableRef()} (ts, attribute_path, value) VALUES ${valuesSql.join(",")}`;
      await this.pool.query(sql, params);
      this.metrics.insertedRowsTotal += valuesSql.length;
    }
  }

  private async queryRows(paths: string[], from: Date, to: Date, order: "asc" | "desc", limit: number): Promise<Array<{ ts: Date; attribute_path: string; value: unknown }>> {
    if (!this.pool) return [];
    const safeLimit = Math.max(1, Math.min(limit, this.cfg.maxQueryRows));
    const sql = `
      SELECT ts, attribute_path, value
      FROM ${this.tableRef()}
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
    const out = keys.slice(0, opts.limit).map((k) => map.get(k) as Record<string, unknown>);
    return out;
  }

  async queryRaw(paths: string[], options: QueryOptions): Promise<HistorianQueryResult> {
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

  async queryLast(paths: string[], options: QueryOptions): Promise<HistorianQueryResult> {
    if (!this.pool) return { rows: [], truncated: false };
    this.metrics.queryCountTotal += 1;
    try {
      const time = options.time === "epoch" ? "epoch" : "iso";
      const unit = options.timestampUnit === "ns" ? "ns" : "us";
      const sql = `
        SELECT DISTINCT ON (attribute_path) attribute_path, ts, value
        FROM ${this.tableRef()}
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

  async queryFirst(paths: string[], options: QueryOptions): Promise<HistorianQueryResult> {
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
        FROM ${this.tableRef()}
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

  async queryRange(paths: string[], options: QueryOptions): Promise<HistorianQueryResult> {
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
      const raw = await this.queryRows(paths, from, to, "asc", this.cfg.maxQueryRows);

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
    const sql = `DELETE FROM ${this.tableRef()} WHERE ${where}`;
    const res = await this.pool.query(sql, params);
    const deletedRecords = Number(res.rowCount || 0);
    this.metrics.deleteCountTotal += deletedRecords;
    return { deletedRecords, touchedSegments: 0 };
  }

  getMetrics(): Record<string, unknown> {
    return {
      ...this.metrics,
      database: this.cfg.database,
      schema: this.cfg.schema,
      table: this.cfg.table
    };
  }

  getLogs(kind = "", limit = 100): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit || 100)));
    const normalized = String(kind || "").trim().toLowerCase();
    const list = this.logs.filter((item) => !normalized || item.level === normalized || item.message.toLowerCase().includes(normalized));
    return list.slice(Math.max(0, list.length - safeLimit));
  }

  async shutdown(): Promise<void> {
    if (!this.pool) return;
    await this.pool.end();
    this.pool = null;
  }
}

export async function createTimescaleHistorianStore(config: HistorianRuntimeConfig["timescale"]) {
  const store = new TimescaleHistorianStore({ config });
  await store.init();
  return store;
}
