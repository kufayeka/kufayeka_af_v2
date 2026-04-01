import {
  normalizeContextFilters,
  normalizeSeverity,
  normalizeStatus,
  parseIsoTs,
  wildcardToSqlLike
} from "./eventStoreUtils";

function toTextPath(path: string): string {
  return `{${path
    .split(".")
    .map((segment) => segment.trim().replace(/"/g, '\\"'))
    .filter(Boolean)
    .join(",")}}`;
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

export function buildBaseWhere(
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
