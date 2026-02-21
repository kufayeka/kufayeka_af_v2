import fs from "node:fs/promises";
import path from "node:path";
import { HistorianConfig } from "../config/types";

export interface PartitionInfo {
  partitionStartMs: number;
  day: string;
  hour: string;
  folder: string;
}

function pad2(v: number): string {
  return v.toString().padStart(2, "0");
}

export function computePartition(tsEpoch: bigint, config: HistorianConfig): PartitionInfo {
  const tsMs =
    config.storage.timestampUnit === "ns" ? Number(tsEpoch / 1_000_000n) : Number(tsEpoch / 1_000n);
  const p = Math.floor(tsMs / config.storage.partitionDurationMs) * config.storage.partitionDurationMs;
  const dt = new Date(p);
  const day = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  const hour = pad2(dt.getUTCHours());
  return { partitionStartMs: p, day, hour, folder: `${day}/${hour}` };
}

export function shardForTag(tagId: number, shardCount: number): number {
  return Math.abs(tagId) % shardCount;
}

export function segmentPath(dataDir: string, partition: PartitionInfo, shard: number): string {
  return path.join(dataDir, "raw", partition.day, partition.hour, `shard-${shard.toString().padStart(2, "0")}.seg`);
}

export function indexPath(dataDir: string, partition: PartitionInfo, shard: number): string {
  return path.join(dataDir, "index", partition.day, partition.hour, `shard-${shard.toString().padStart(2, "0")}.idx`);
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function ensureBaseLayout(config: HistorianConfig): Promise<void> {
  await fs.mkdir(path.join(config.storage.dataDir, "raw"), { recursive: true });
  await fs.mkdir(path.join(config.storage.dataDir, "index"), { recursive: true });
  await fs.mkdir(path.join(config.storage.dataDir, "meta"), { recursive: true });
}
