import type { EventRow } from "../types";
import type { EventOpenCachePort } from "./contracts";
import {
  compareEventRows,
  matchesContextFilters,
  normalizeSeverity,
  normalizeSortBy,
  normalizeSortDir,
  parseIsoTs,
  wildcardToRegExp
} from "./eventStoreUtils";

export class OpenEventCache implements EventOpenCachePort {
  private readonly rowsById = new Map<string, EventRow>();
  private readonly rowIdsByPath = new Map<string, Set<string>>();
  private warm = false;
  private lastWarmupAt: string | null = null;

  clear(): void {
    this.rowsById.clear();
    this.rowIdsByPath.clear();
    this.warm = false;
    this.lastWarmupAt = null;
  }

  replaceAll(rows: EventRow[]): void {
    this.rowsById.clear();
    this.rowIdsByPath.clear();
    for (const row of rows) {
      this.attach(row);
    }
    this.warm = true;
    this.lastWarmupAt = new Date().toISOString();
  }

  attach(row: EventRow): void {
    if (!row || row.status !== "open") return;
    this.rowsById.set(row.id, row);
    const current = this.rowIdsByPath.get(row.event_path) || new Set<string>();
    current.add(row.id);
    this.rowIdsByPath.set(row.event_path, current);
  }

  detach(row: EventRow | null | undefined): void {
    if (!row) return;
    this.rowsById.delete(row.id);
    const current = this.rowIdsByPath.get(row.event_path);
    if (!current) return;
    current.delete(row.id);
    if (current.size === 0) this.rowIdsByPath.delete(row.event_path);
  }

  update(row: EventRow | null | undefined): void {
    if (!row) return;
    this.attach(row);
  }

  getById(id: string): EventRow | null {
    return this.rowsById.get(id) || null;
  }

  get size(): number {
    return this.rowsById.size;
  }

  isWarm(): boolean {
    return this.warm;
  }

  getLastWarmupAt(): string | null {
    return this.lastWarmupAt;
  }

  query(
    pattern = "*",
    _from = "*",
    to = "*",
    contextFilters: unknown = {},
    options: Record<string, unknown> = {}
  ): { rows: EventRow[]; total: number; limit: number; offset: number; sortBy: string; sortDir: "ASC" | "DESC" } {
    const matcher = wildcardToRegExp(pattern);
    const toTs = parseIsoTs(to, null);
    const severity = options?.severity && options.severity !== "*" ? normalizeSeverity(options.severity) : null;
    const sortBy = normalizeSortBy(options?.sortBy || "start_ts");
    const sortDir = normalizeSortDir(options?.sortDir || options?.sort || "desc");
    const limitRaw = Number(options?.limit ?? 200);
    const offsetRaw = Number(options?.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const rows = Array.from(this.rowsById.values()).filter((row) => {
      if (!matcher.test(row.event_path)) return false;
      if (severity && row.severity !== severity) return false;
      if (toTs && row.start_ts > toTs) return false;
      if (!matchesContextFilters(row, contextFilters)) return false;
      return true;
    });

    rows.sort((a, b) => compareEventRows(a, b, sortBy, sortDir));
    return {
      total: rows.length,
      limit,
      offset,
      sortBy,
      sortDir,
      rows: rows.slice(offset, offset + limit)
    };
  }
}
