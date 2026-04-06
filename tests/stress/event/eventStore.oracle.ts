import type { EventRow } from "../../../runtime/core/runtimeTypes";
import {
  compareEventRows,
  matchesContextFilters,
  normalizeSeverity,
  normalizeSortBy,
  normalizeSortDir,
  normalizeStatus,
  parseIsoTs,
  wildcardToRegExp
} from "../../../runtime/event/EventQuerySupport";

function cloneRow(row: EventRow): EventRow {
  return {
    ...row,
    context: { ...(row.context || {}) },
    event_metadata: row.event_metadata ? { ...row.event_metadata } : null
  };
}

export class OracleEventStore {
  private readonly rows = new Map<string, EventRow>();

  applyOpenedRow(row: EventRow): void {
    this.rows.set(row.id, cloneRow(row));
  }

  close(pattern = "*", ts: string, notesOnClose: string | null, capturedDataOnClose: unknown | null): EventRow[] {
    const matcher = wildcardToRegExp(pattern);
    const changed: EventRow[] = [];
    for (const current of this.rows.values()) {
      if (current.status !== "open") continue;
      if (!matcher.test(current.event_path)) continue;
      const next: EventRow = {
        ...current,
        status: "closed",
        end_ts: ts,
        notes_on_close: notesOnClose,
        captured_data_on_close: capturedDataOnClose
      };
      this.rows.set(next.id, cloneRow(next));
      changed.push(cloneRow(next));
    }
    return changed;
  }

  closeById(id: string, ts: string, notesOnClose: string | null, capturedDataOnClose: unknown | null): EventRow[] {
    const current = this.rows.get(id);
    if (!current || current.status !== "open") return [];
    const next: EventRow = {
      ...current,
      status: "closed",
      end_ts: ts,
      notes_on_close: notesOnClose,
      captured_data_on_close: capturedDataOnClose
    };
    this.rows.set(next.id, cloneRow(next));
    return [cloneRow(next)];
  }

  acknowledgeById(id: string, ts: string): number {
    const current = this.rows.get(id);
    if (!current) return 0;
    const next: EventRow = {
      ...current,
      is_acknowledge: true,
      acknowledged_ts: ts
    };
    this.rows.set(next.id, cloneRow(next));
    return 1;
  }

  deleteById(id: string): number {
    return this.rows.delete(id) ? 1 : 0;
  }

  deleteByPattern(pattern = "*", status = "*", from = "*", to = "*", severity: unknown = "*"): number {
    const rows = this.query(pattern, from, to, status, {}, { severity, limit: 5000 }).rows;
    for (const row of rows) {
      this.rows.delete(row.id);
    }
    return rows.length;
  }

  getById(id: string): EventRow | null {
    const current = this.rows.get(id);
    return current ? cloneRow(current) : null;
  }

  query(
    pattern = "*",
    from = "*",
    to = "*",
    status = "*",
    contextFilters: unknown = {},
    options: Record<string, unknown> = {}
  ): { rows: EventRow[]; total: number; limit: number; offset: number; sortBy: string; sortDir: "ASC" | "DESC" } {
    const matcher = wildcardToRegExp(pattern);
    const fromTs = parseIsoTs(from, null);
    const toTs = parseIsoTs(to, null);
    const normalizedStatus = normalizeStatus(status);
    const severity = options?.severity && options.severity !== "*" ? normalizeSeverity(options.severity) : null;
    const sortBy = normalizeSortBy(options?.sortBy || "start_ts");
    const sortDir = normalizeSortDir(options?.sortDir || options?.sort || "desc");
    const limitRaw = Number(options?.limit ?? 200);
    const offsetRaw = Number(options?.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const rows = Array.from(this.rows.values())
      .filter((row) => {
        if (!matcher.test(row.event_path)) return false;
        if (normalizedStatus !== "*" && row.status !== normalizedStatus) return false;
        if (severity && row.severity !== severity) return false;
        if (fromTs && row.start_ts < fromTs) return false;
        if (toTs && row.start_ts > toTs) return false;
        if (!matchesContextFilters(row, contextFilters)) return false;
        return true;
      })
      .map(cloneRow);

    rows.sort((left, right) => compareEventRows(left, right, sortBy, sortDir));
    return {
      rows: rows.slice(offset, offset + limit),
      total: rows.length,
      limit,
      offset,
      sortBy,
      sortDir
    };
  }

  openCount(): number {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.status === "open") count += 1;
    }
    return count;
  }

  allRows(): EventRow[] {
    return Array.from(this.rows.values()).map(cloneRow);
  }
}
