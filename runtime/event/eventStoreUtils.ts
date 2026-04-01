import type { EventRow } from "../types";

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

export type ContextFilterOperator = "eq" | "neq" | "in" | "not_in" | "exists" | "not_exists";
export type ContextFilterCondition = {
  path: string;
  operator: ContextFilterOperator;
  value?: unknown;
};
export type NormalizedContextFilter = { op: "AND" | "OR"; conditions: ContextFilterCondition[] };

export function epochToMs(value: number): number {
  const abs = Math.abs(value);
  if (abs < 1e11) return value * 1000;
  if (abs < 1e14) return value;
  if (abs < 1e17) return value / 1000;
  return value / 1_000_000;
}

export function parseDateLike(ts: unknown): Date | null {
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

export function toIsoTs(ts: unknown): string {
  if (!ts || ts === "*") return new Date().toISOString();
  const date = parseDateLike(ts);
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(ts)}`);
  }
  return date.toISOString();
}

export function parseIsoTs(ts: unknown, fallback: string | null = null): string | null {
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

export function normalizeStatus(status: unknown): string {
  if (!status || status === "*") return "*";
  const value = String(status).trim().toLowerCase();
  if (!VALID_STATUS.has(value)) throw new Error(`Invalid status: ${String(status)}`);
  return value;
}

export function normalizeSeverity(severity: unknown): EventRow["severity"] {
  const value = String(severity || "other").trim().toLowerCase() as EventRow["severity"];
  if (!VALID_SEVERITY.has(value)) throw new Error(`Invalid severity: ${String(severity)}`);
  return value;
}

export function normalizeSortBy(sortBy: unknown): string {
  const value = String(sortBy || "start_ts").trim();
  return SORTABLE_COLUMNS.has(value) ? value : "start_ts";
}

export function normalizeSortDir(sortDir: unknown): "ASC" | "DESC" {
  return String(sortDir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
}

export function toJsonPath(rawKey: unknown): string[] {
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

export function normalizeContextFilters(contextFilters: unknown): NormalizedContextFilter {
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wildcardToRegExp(pattern: unknown): RegExp {
  const input = String(pattern == null ? "*" : pattern);
  const source = `^${input.split("*").map((part) => escapeRegExp(part)).join(".*")}$`;
  return new RegExp(source);
}

export function getContextValueAtPath(input: unknown, path: string): unknown {
  const parts = toJsonPath(path);
  let current: unknown = input;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function matchesContextFilters(row: EventRow, contextFilters: unknown): boolean {
  const filter = normalizeContextFilters(contextFilters);
  if (filter.conditions.length === 0) return true;

  const matches = filter.conditions.map((condition) => {
    const actual = getContextValueAtPath(row.context, condition.path);
    switch (condition.operator) {
      case "exists":
        return actual !== undefined;
      case "not_exists":
        return actual === undefined;
      case "neq":
        return String(actual ?? "") !== String(condition.value ?? "");
      case "in": {
        const values = Array.isArray(condition.value) ? condition.value.map((item) => String(item)) : [];
        return values.includes(String(actual ?? ""));
      }
      case "not_in": {
        const values = Array.isArray(condition.value) ? condition.value.map((item) => String(item)) : [];
        return !values.includes(String(actual ?? ""));
      }
      case "eq":
      default:
        return String(actual ?? "") === String(condition.value ?? "");
    }
  });

  return filter.op === "OR" ? matches.some(Boolean) : matches.every(Boolean);
}

export function compareEventRows(a: EventRow, b: EventRow, sortBy: string, sortDir: "ASC" | "DESC"): number {
  const getComparable = (row: EventRow): string | number => {
    switch (sortBy) {
      case "start_ts":
        return Date.parse(row.start_ts || "") || 0;
      case "end_ts":
        return row.end_ts ? Date.parse(row.end_ts) || 0 : 0;
      case "acknowledged_ts":
        return row.acknowledged_ts ? Date.parse(row.acknowledged_ts) || 0 : 0;
      case "is_acknowledge":
        return row.is_acknowledge ? 1 : 0;
      default:
        return String((row as unknown as Record<string, unknown>)[sortBy] ?? "");
    }
  };

  const left = getComparable(a);
  const right = getComparable(b);
  let result = 0;
  if (typeof left === "number" && typeof right === "number") result = left - right;
  else result = String(left).localeCompare(String(right));
  return sortDir === "ASC" ? result : -result;
}
