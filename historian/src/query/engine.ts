import fs from "node:fs/promises";
import path from "node:path";
import { HistorianConfig } from "../config/types";
import { indexPath, segmentPath, shardForTag } from "../storage/layout";
import { readBlockIndex } from "../storage/readers";
import { decodeSegmentRecord } from "../storage/codec";
import { isNumericType } from "../types/valueTypes";
import { AggName, LastQueryRequest, QueryOrder, QueryPoint, RangeQueryRequest, RawQueryRequest } from "./types";

interface ScanRange {
  start: bigint;
  end: bigint;
}

interface BucketAggState {
  first: QueryPoint | null;
  last: QueryPoint | null;
  min: number | null;
  max: number | null;
  sum: number;
  numericCount: number;
  count: number;
  sawString: boolean;
}

function partitionStarts(config: HistorianConfig, from: bigint, to: bigint): number[] {
  const fromMs = config.storage.timestampUnit === "ns" ? Number(from / 1_000_000n) : Number(from / 1_000n);
  const toMs = config.storage.timestampUnit === "ns" ? Number(to / 1_000_000n) : Number(to / 1_000n);
  const step = config.storage.partitionDurationMs;
  const start = Math.floor(fromMs / step) * step;
  const out: number[] = [];
  for (let ms = start; ms <= toMs; ms += step) out.push(ms);
  return out;
}

async function blockScanRanges(
  config: HistorianConfig,
  dataDir: string,
  partitionStartMs: number,
  shard: number,
  tagMin: number,
  tagMax: number,
  from: bigint,
  to: bigint
): Promise<{ segPath: string; ranges: ScanRange[] }> {
  const dt = new Date(partitionStartMs);
  const day = `${dt.getUTCFullYear()}-${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}-${dt.getUTCDate().toString().padStart(2, "0")}`;
  const hour = dt.getUTCHours().toString().padStart(2, "0");
  const partition = { day, hour, folder: `${day}/${hour}`, partitionStartMs };
  const segPath = segmentPath(dataDir, partition, shard);
  const idxPath = indexPath(dataDir, partition, shard);

  const idxEntries = await readBlockIndex(idxPath);
  if (idxEntries.length === 0) {
    try {
      const st = await fs.stat(segPath);
      if (st.size === 0) return { segPath, ranges: [] };
      return { segPath, ranges: [{ start: 0n, end: BigInt(st.size) }] };
    } catch {
      return { segPath, ranges: [] };
    }
  }

  const ranges: ScanRange[] = [];
  for (const e of idxEntries) {
    if (e.maxTs < from || e.minTs > to) continue;
    if (e.maxTagId < tagMin || e.minTagId > tagMax) continue;
    ranges.push({ start: e.byteOffsetStart, end: e.byteOffsetEnd });
  }
  return { segPath, ranges };
}

function createBucketState(): BucketAggState {
  return {
    first: null,
    last: null,
    min: null,
    max: null,
    sum: 0,
    numericCount: 0,
    count: 0,
    sawString: false
  };
}

function updateBucket(state: BucketAggState, point: QueryPoint): void {
  state.count += 1;
  if (!state.first || point.tsEpoch < state.first.tsEpoch) state.first = point;
  if (!state.last || point.tsEpoch > state.last.tsEpoch) state.last = point;
  if (!isNumericType(point.typeCode)) {
    state.sawString = true;
    return;
  }
  const value = point.value as number;
  state.numericCount += 1;
  state.sum += value;
  state.min = state.min === null ? value : Math.min(state.min, value);
  state.max = state.max === null ? value : Math.max(state.max, value);
}

function finalizeBucket(state: BucketAggState, agg: AggName): number | string | null {
  switch (agg) {
    case "count":
      return state.count;
    case "first":
      return state.first ? String(state.first.value) : null;
    case "last":
      return state.last ? String(state.last.value) : null;
    case "min":
      return state.sawString ? null : state.min;
    case "max":
      return state.sawString ? null : state.max;
    case "avg":
      return state.sawString || state.numericCount === 0 ? null : state.sum / state.numericCount;
    default:
      return null;
  }
}

export class QueryEngine {
  constructor(private readonly config: HistorianConfig) {}

  async last(req: LastQueryRequest): Promise<{ points: QueryPoint[] }> {
    const tagSet = new Set(req.tagIds);
    const sortedTags = [...tagSet].sort((a, b) => a - b);
    const tagMin = sortedTags[0];
    const tagMax = sortedTags[sortedTags.length - 1];
    const byShard = new Map<number, number[]>();
    for (const t of tagSet) {
      const shard = shardForTag(t, this.config.storage.shardCount);
      const arr = byShard.get(shard) ?? [];
      arr.push(t);
      byShard.set(shard, arr);
    }

    const lastByTag = new Map<number, QueryPoint>();
    const partitions = await this.listPartitionsDescending();
    for (const pStart of partitions) {
      for (const shard of byShard.keys()) {
        const scan = await blockScanRanges(
          this.config,
          this.config.storage.dataDir,
          pStart,
          shard,
          tagMin,
          tagMax,
          -9223372036854775808n,
          9223372036854775807n
        );
        if (scan.ranges.length === 0) continue;
        for (let i = scan.ranges.length - 1; i >= 0; i--) {
          const range = scan.ranges[i];
          const chunk = await this.readRange(scan.segPath, range.start, range.end);
          let off = 0;
          while (off < chunk.length) {
            const rec = decodeSegmentRecord(chunk, off);
            if (!rec) break;
            off += rec.bytesRead;
            const p = rec.point;
            if (!tagSet.has(p.tagId)) continue;
            const cur = lastByTag.get(p.tagId);
            if (!cur || p.tsEpoch > cur.tsEpoch) lastByTag.set(p.tagId, p);
          }
          if (lastByTag.size >= tagSet.size) break;
        }
        if (lastByTag.size >= tagSet.size) break;
      }
      if (lastByTag.size >= tagSet.size) break;
    }
    return { points: [...lastByTag.values()] };
  }

  async raw(req: RawQueryRequest): Promise<{ points: QueryPoint[]; truncated: boolean }> {
    const order: QueryOrder = req.order ?? "desc";
    const tagSet = new Set(req.tagIds);
    const sortedTags = [...tagSet].sort((a, b) => a - b);
    const tagMin = sortedTags[0];
    const tagMax = sortedTags[sortedTags.length - 1];
    const pStarts = partitionStarts(this.config, req.from, req.to);
    if (order === "desc") pStarts.reverse();
    const byShard = new Map<number, number[]>();
    for (const t of tagSet) {
      const shard = shardForTag(t, this.config.storage.shardCount);
      const arr = byShard.get(shard) ?? [];
      arr.push(t);
      byShard.set(shard, arr);
    }
    const out: QueryPoint[] = [];
    for (const pStart of pStarts) {
      for (const shard of byShard.keys()) {
        const scan = await blockScanRanges(
          this.config,
          this.config.storage.dataDir,
          pStart,
          shard,
          tagMin,
          tagMax,
          req.from,
          req.to
        );
        if (scan.ranges.length === 0) continue;
        const left = req.limit - out.length;
        if (left <= 0) return { points: out, truncated: true };
        const subset = await this.collectFromRanges(scan.segPath, scan.ranges, tagSet, req.from, req.to, left, order);
        out.push(...subset);
        if (out.length >= req.limit) return { points: out, truncated: true };
      }
    }
    out.sort((a, b) => {
      if (a.tsEpoch === b.tsEpoch) return a.tagId - b.tagId;
      return order === "desc" ? (a.tsEpoch > b.tsEpoch ? -1 : 1) : a.tsEpoch < b.tsEpoch ? -1 : 1;
    });
    return { points: out, truncated: false };
  }

  async range(req: RangeQueryRequest): Promise<{ buckets?: unknown; points?: QueryPoint[]; truncated?: boolean }> {
    if (!req.bucketMs) {
      return this.raw(req);
    }
    const raw = await this.raw(req);
    const bucketUs = BigInt(req.bucketMs) * (this.config.storage.timestampUnit === "ns" ? 1_000_000n : 1_000n);
    const state = new Map<number, Map<string, BucketAggState>>();
    for (const p of raw.points) {
      const d = state.get(p.tagId) ?? new Map<string, BucketAggState>();
      state.set(p.tagId, d);
      const key = ((p.tsEpoch - req.from) / bucketUs).toString();
      const s = d.get(key) ?? createBucketState();
      updateBucket(s, p);
      d.set(key, s);
    }
    const result: Record<string, Array<{ bucketStart: string; value: number | string | null }>> = {};
    for (const [tagId, buckets] of state) {
      const rows: Array<{ bucketStart: string; value: number | string | null }> = [];
      for (const [k, s] of buckets) {
        const start = req.from + BigInt(k) * bucketUs;
        rows.push({ bucketStart: start.toString(), value: finalizeBucket(s, req.agg) });
      }
      rows.sort((a, b) => {
        if (a.bucketStart === b.bucketStart) return 0;
        if ((req.order ?? "desc") === "desc") return BigInt(a.bucketStart) > BigInt(b.bucketStart) ? -1 : 1;
        return BigInt(a.bucketStart) < BigInt(b.bucketStart) ? -1 : 1;
      });
      result[String(tagId)] = rows;
    }
    return { buckets: result, truncated: raw.truncated };
  }

  private async listPartitionsDescending(): Promise<number[]> {
    const rawDir = path.join(this.config.storage.dataDir, "raw");
    const out: number[] = [];
    let days: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      days = await fs.readdir(rawDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const day of days) {
      if (!day.isDirectory()) continue;
      const dayPath = path.join(rawDir, day.name);
      let hours: Array<{ name: string; isDirectory: () => boolean }> = [];
      try {
        hours = await fs.readdir(dayPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const hour of hours) {
        if (!hour.isDirectory()) continue;
        const dt = new Date(`${day.name}T${hour.name}:00:00.000Z`);
        if (!Number.isFinite(dt.getTime())) continue;
        out.push(dt.getTime());
      }
    }
    out.sort((a, b) => b - a);
    return out;
  }

  private async readRange(segPath: string, start: bigint, end: bigint): Promise<Buffer> {
    const len = Number(end - start);
    if (len <= 0) return Buffer.alloc(0);
    const fh = await fs.open(segPath, "r");
    try {
      const buf = Buffer.allocUnsafe(len);
      const rd = await fh.read(buf, 0, len, Number(start));
      return rd.buffer.subarray(0, rd.bytesRead);
    } finally {
      await fh.close();
    }
  }

  private async collectFromRanges(
    segPath: string,
    ranges: ScanRange[],
    tagSet: Set<number>,
    from: bigint,
    to: bigint,
    limit: number,
    order: QueryOrder
  ): Promise<QueryPoint[]> {
    const out: QueryPoint[] = [];
    const fh = await fs.open(segPath, "r");
    try {
      const rangesIter = order === "desc" ? [...ranges].reverse() : ranges;
      for (const r of rangesIter) {
        const len = Number(r.end - r.start);
        if (len <= 0) continue;
        const buf = Buffer.allocUnsafe(len);
        const rd = await fh.read(buf, 0, len, Number(r.start));
        const chunk = rd.buffer.subarray(0, rd.bytesRead);
        if (order === "asc") {
          let off = 0;
          while (off < chunk.length) {
            const rec = decodeSegmentRecord(chunk, off);
            if (!rec) break;
            off += rec.bytesRead;
            const p = rec.point;
            if (!tagSet.has(p.tagId)) continue;
            if (p.tsEpoch < from || p.tsEpoch > to) continue;
            out.push(p);
            if (out.length >= limit) return out;
          }
        } else {
          const pointsInBlock: QueryPoint[] = [];
          let off = 0;
          while (off < chunk.length) {
            const rec = decodeSegmentRecord(chunk, off);
            if (!rec) break;
            off += rec.bytesRead;
            const p = rec.point;
            if (!tagSet.has(p.tagId)) continue;
            if (p.tsEpoch < from || p.tsEpoch > to) continue;
            pointsInBlock.push(p);
          }
          for (let i = pointsInBlock.length - 1; i >= 0; i--) {
            out.push(pointsInBlock[i]);
            if (out.length >= limit) return out;
          }
        }
      }
      return out;
    } finally {
      await fh.close();
    }
  }
}
