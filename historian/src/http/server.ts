import Fastify from "fastify";
import { FastifyReply } from "fastify";
import { HistorianConfig } from "../config/types";
import { QueryEngine } from "../query/engine";
import { AggName, QueryOrder, QueryPoint } from "../query/types";
import { LastValueStore } from "../storage/lastValueStore";

function parseTagIds(input: string | undefined): number[] {
  if (!input) throw new Error("tagIds is required");
  const ids = input
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (ids.length === 0) throw new Error("tagIds is empty");
  return [...new Set(ids)];
}

type TimeFormat = "epoch" | "iso";

function parseTimestampParam(input: string | undefined, name: string, unit: "us" | "ns"): bigint {
  if (!input) throw new Error(`${name} is required`);
  if (/^-?\d+$/.test(input.trim())) {
    return BigInt(input.trim());
  }
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new Error(`${name} must be epoch integer or ISO timestamp`);
  const base = BigInt(ms);
  return unit === "ns" ? base * 1_000_000n : base * 1_000n;
}

function parseAgg(input: string | undefined): AggName {
  if (!input) return "avg";
  const valid = new Set(["min", "max", "avg", "first", "last", "count"]);
  const token = input.trim();
  if (!valid.has(token)) throw new Error("agg is invalid");
  return token as AggName;
}

function parseOrder(input: string | undefined): QueryOrder {
  if (!input) return "desc";
  if (input === "asc" || input === "desc") return input;
  throw new Error("order must be asc|desc");
}

function parseTimeFormat(input: string | undefined): TimeFormat {
  if (!input) return "epoch";
  if (input === "epoch" || input === "iso") return input;
  throw new Error("time must be epoch|iso");
}

function formatTime(ts: bigint, fmt: TimeFormat, unit: "us" | "ns"): string {
  if (fmt === "epoch") return ts.toString();
  const ms = unit === "ns" ? Number(ts / 1_000_000n) : Number(ts / 1_000n);
  return new Date(ms).toISOString();
}

function serializeDeep(input: unknown): unknown {
  if (typeof input === "bigint") return input.toString();
  if (Array.isArray(input)) return input.map((v) => serializeDeep(v));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = serializeDeep(v);
    return out;
  }
  return input;
}

function streamRawPayload(reply: FastifyReply, items: unknown[], truncated: boolean): void {
  reply.raw.write('{"rows":[');
  for (let i = 0; i < items.length; i++) {
    if (i > 0) reply.raw.write(",");
    reply.raw.write(JSON.stringify(serializeDeep(items[i])));
  }
  reply.raw.write(`],"truncated":${truncated ? "true" : "false"}}`);
  reply.raw.end();
}

function pivotPoints(
  points: QueryPoint[],
  fmt: TimeFormat,
  unit: "us" | "ns",
  order: QueryOrder = "desc"
): Array<Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const p of points) {
    const key = p.tsEpoch.toString();
    const row = rows.get(key) ?? { time: formatTime(p.tsEpoch, fmt, unit) };
    row[`tag${p.tagId}`] = p.value;
    rows.set(key, row);
  }
  const arr = [...rows.entries()].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));
  if (order === "desc") arr.reverse();
  return arr.map(([, row]) => row);
}

function pivotBuckets(
  buckets: Record<string, Array<{ bucketStart: string; value: unknown }>>,
  fmt: TimeFormat,
  unit: "us" | "ns"
): Array<Record<string, unknown>> {
  const rows = new Map<string, Record<string, unknown>>();
  for (const [tagId, entries] of Object.entries(buckets)) {
    for (const e of entries) {
      const row = rows.get(e.bucketStart) ?? { time: formatTime(BigInt(e.bucketStart), fmt, unit) };
      row[`tag${tagId}`] = e.value;
      rows.set(e.bucketStart, row);
    }
  }
  return [...rows.entries()]
    .sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1))
    .map(([, row]) => row);
}

export async function buildHttpServer(config: HistorianConfig, lastStore: LastValueStore) {
  const app = Fastify({ logger: true });
  const queryEngine = new QueryEngine(config);

  app.get("/health", async () => ({ ok: true }));

  app.get("/hist/last", async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const tagIds = parseTagIds(q.tagIds);
      const timeFormat = parseTimeFormat(q.time);
      const points = lastStore.getLatest(tagIds) as QueryPoint[];
      return serializeDeep({ rows: pivotPoints(points, timeFormat, config.storage.timestampUnit, "desc") });
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/hist/raw", async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      if (q.bucketMs !== undefined || q.agg !== undefined) {
        throw new Error("bucketMs/agg is not supported on /hist/raw. Use /hist/range instead");
      }
      const tagIds = parseTagIds(q.tagIds);
      const from = parseTimestampParam(q.from, "from", config.storage.timestampUnit);
      const to = parseTimestampParam(q.to, "to", config.storage.timestampUnit);
      if (to < from) throw new Error("to must be >= from");
      const limit = Math.min(Number(q.limit ?? config.http.maxPoints), config.http.maxPoints);
      const order = parseOrder(q.order);
      const timeFormat = parseTimeFormat(q.time);
      const result = (await queryEngine.raw({ tagIds, from, to, limit, order })) as {
        points: QueryPoint[];
        truncated: boolean;
      };
      const rows = pivotPoints(result.points, timeFormat, config.storage.timestampUnit, order);
      const payload = { rows, truncated: result.truncated };
      if (rows.length >= config.http.streamThresholdPoints) {
        reply.type("application/json");
        streamRawPayload(reply, payload.rows, payload.truncated);
        return;
      }
      return serializeDeep(payload);
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/hist/range", async (req, reply) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const tagIds = parseTagIds(q.tagIds);
      const from = parseTimestampParam(q.from, "from", config.storage.timestampUnit);
      const to = parseTimestampParam(q.to, "to", config.storage.timestampUnit);
      if (to < from) throw new Error("to must be >= from");
      const bucketMs = q.bucketMs ? Number(q.bucketMs) : undefined;
      const agg = parseAgg(q.agg);
      const order = parseOrder(q.order);
      const timeFormat = parseTimeFormat(q.time);
      const limit = config.http.maxPoints;
      const result = (await queryEngine.range({ tagIds, from, to, bucketMs, agg, order, limit })) as {
        buckets?: Record<string, Array<{ bucketStart: string; value: unknown }>>;
        points?: QueryPoint[];
        truncated?: boolean;
      };
      if (result.points) {
        return serializeDeep({
          rows: pivotPoints(result.points, timeFormat, config.storage.timestampUnit, order),
          truncated: result.truncated
        });
      }
      const rows = result.buckets ? pivotBuckets(result.buckets, timeFormat, config.storage.timestampUnit) : [];
      if (order === "desc") rows.reverse();
      return serializeDeep({ rows, truncated: result.truncated ?? false, agg });
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  return app;
}
