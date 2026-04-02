import type { DbConnectionManager } from "../../db/dbConnectionManager";
import type { EventRow } from "../../core/runtimeTypes";
import type { EventCloseInput, EventCloseByIdInput, EventDeleteByPatternInput, EventOpenInput, EventQueryInput, EventQueryResult, EventStoreMeta, EventStoreRepository } from "../EventContracts";
import { mapEventRow } from "./EventRowMapper";
import { buildBaseWhere } from "./EventSqlSupport";
import { normalizeSortBy, normalizeSortDir, normalizeStatus, wildcardToSqlLike } from "../EventQuerySupport";

export class PostgresEventRepository implements EventStoreRepository {
  private readonly db: DbConnectionManager;
  private readonly schema: string;
  private readonly table: string;
  private readonly database: string;
  private readonly tableRef: string;

  constructor(dbConnectionManager: DbConnectionManager) {
    this.db = dbConnectionManager;
    const dbCfg = this.db.getConfig();
    this.schema = String(dbCfg.connection.schema).replace(/"/g, "");
    this.table = String(dbCfg.tables.event).replace(/"/g, "");
    this.database = String(dbCfg.connection.database);
    this.tableRef = `"${this.schema}"."${this.table}"`;
  }

  getMeta(): Omit<EventStoreMeta, "openEventCache"> {
    return {
      engine: "postgresql",
      database: this.database,
      schema: this.schema,
      table: this.table
    };
  }

  async loadOpenRows(): Promise<EventRow[]> {
    const result = await this.db.query(`
      SELECT id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close, event_metadata, captured_data_on_open, captured_data_on_close
      FROM ${this.tableRef}
      WHERE status = 'open'
    `);
    return result.rows.map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async insertOpenEvent(input: EventOpenInput & { id: string; startTs: string; normalizedSeverity: EventRow["severity"] }): Promise<EventRow> {
    const row = {
      id: input.id,
      event_path: input.eventPath,
      start_ts: input.startTs,
      severity: input.normalizedSeverity,
      context: input.context && typeof input.context === "object" ? input.context : {},
      notes_on_open: input.notesOnOpen == null ? null : String(input.notesOnOpen),
      event_metadata: input.eventMetadata && typeof input.eventMetadata === "object" ? input.eventMetadata : null,
      captured_data_on_open: input.capturedDataOnOpen === undefined ? null : input.capturedDataOnOpen
    };
    const sql = `
      INSERT INTO ${this.tableRef}
      (id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,event_metadata,captured_data_on_open,captured_data_on_close,updated_at)
      VALUES ($1,$2,$3::timestamptz,NULL,'open',$4,$5::jsonb,FALSE,NULL,$6,NULL,$7::jsonb,$8::jsonb,NULL,NOW())
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,event_metadata,captured_data_on_open,captured_data_on_close
    `;
    const result = await this.db.query(sql, [
      row.id,
      row.event_path,
      row.start_ts,
      row.severity,
      JSON.stringify(row.context),
      row.notes_on_open,
      JSON.stringify(row.event_metadata),
      JSON.stringify(row.captured_data_on_open)
    ]);
    return mapEventRow((result.rows[0] as Record<string, unknown>) || row);
  }

  async closeByPattern(input: { pattern?: string; ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null }): Promise<EventRow[]> {
    const sql = `
      UPDATE ${this.tableRef}
      SET
        end_ts = $1::timestamptz,
        status = 'closed',
        notes_on_close = CASE WHEN $2::text IS NULL OR $2::text = '' THEN notes_on_close ELSE $2::text END,
        captured_data_on_close = CASE WHEN $3::jsonb IS NULL THEN captured_data_on_close ELSE $3::jsonb END,
        updated_at = NOW()
      WHERE status = 'open' AND event_path LIKE $4 ESCAPE '!'
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,event_metadata,captured_data_on_open,captured_data_on_close
    `;
    const result = await this.db.query(sql, [
      input.ts,
      input.notesOnClose,
      JSON.stringify(input.capturedDataOnClose),
      wildcardToSqlLike(input.pattern || "*")
    ]);
    return result.rows.map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async closeById(input: EventCloseByIdInput & { ts: string; notesOnClose: string | null; capturedDataOnClose: unknown | null }): Promise<EventRow[]> {
    const sql = `
      UPDATE ${this.tableRef}
      SET
        end_ts = $1::timestamptz,
        status = 'closed',
        notes_on_close = CASE WHEN $2::text IS NULL OR $2::text = '' THEN notes_on_close ELSE $2::text END,
        captured_data_on_close = CASE WHEN $3::jsonb IS NULL THEN captured_data_on_close ELSE $3::jsonb END,
        updated_at = NOW()
      WHERE id = $4 AND status = 'open'
      RETURNING id,event_path,start_ts,end_ts,status,severity,context,is_acknowledge,acknowledged_ts,notes_on_open,notes_on_close,event_metadata,captured_data_on_open,captured_data_on_close
    `;
    const result = await this.db.query(sql, [input.ts, input.notesOnClose, JSON.stringify(input.capturedDataOnClose), input.id]);
    return result.rows.map((row) => mapEventRow(row as Record<string, unknown>));
  }

  async acknowledgeById(input: { id: string; ts: string }): Promise<number> {
    const sql = `UPDATE ${this.tableRef} SET is_acknowledge = TRUE, acknowledged_ts = $1::timestamptz, updated_at = NOW() WHERE id = $2`;
    const result = await this.db.query(sql, [input.ts, input.id]);
    return Number(result.rowCount || 0);
  }

  async deleteById(id: string): Promise<number> {
    const result = await this.db.query(`DELETE FROM ${this.tableRef} WHERE id = $1`, [id]);
    return Number(result.rowCount || 0);
  }

  async deleteByPattern(input: EventDeleteByPatternInput): Promise<number> {
    const params: unknown[] = [];
    const whereSql = buildBaseWhere(
      {
        pattern: input.pattern,
        status: input.status,
        from: input.from,
        to: input.to,
        contextFilters: {},
        severity: input.severity
      },
      params
    );
    const result = await this.db.query(`DELETE FROM ${this.tableRef} ${whereSql}`, params);
    return Number(result.rowCount || 0);
  }

  async query(input: Required<Pick<EventQueryInput, "pattern" | "from" | "to" | "status" | "contextFilters">> & { options: Record<string, unknown> }): Promise<EventQueryResult> {
    const limitRaw = Number(input.options.limit ?? 1000);
    const offsetRaw = Number(input.options.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 1000;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
    const sortBy = normalizeSortBy(input.options.sortBy || "start_ts");
    const sortDir = normalizeSortDir(input.options.sortDir || input.options.sort || "desc");
    const severity = input.options.severity || "*";

    const baseParams: unknown[] = [];
    const whereSql = buildBaseWhere(
      {
        pattern: input.pattern,
        from: input.from,
        to: input.to,
        status: input.status,
        contextFilters: input.contextFilters,
        severity
      },
      baseParams
    );
    const rowSql = `
      SELECT id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close, event_metadata, captured_data_on_open, captured_data_on_close
      FROM ${this.tableRef}
      ${whereSql}
      ORDER BY ${sortBy} ${sortDir}
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const rowResult = await this.db.query(rowSql, [...baseParams, limit, offset]);
    const rows = rowResult.rows.map((row) => mapEventRow(row as Record<string, unknown>));
    const countResult = await this.db.query(`SELECT COUNT(1) AS total FROM ${this.tableRef} ${whereSql}`, baseParams);
    const total = Number((countResult.rows[0] as { total?: number })?.total || 0);
    return { rows, total, limit, offset, sortBy, sortDir };
  }

  async getById(id: string): Promise<EventRow | null> {
    const sql = `
      SELECT id, event_path, start_ts, end_ts, status, severity, context, is_acknowledge, acknowledged_ts, notes_on_open, notes_on_close, event_metadata, captured_data_on_open, captured_data_on_close
      FROM ${this.tableRef}
      WHERE id = $1
      LIMIT 1
    `;
    const result = await this.db.query(sql, [id]);
    if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
    return mapEventRow(result.rows[0] as Record<string, unknown>);
  }
}
