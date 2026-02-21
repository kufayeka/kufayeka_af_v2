import fs from "node:fs/promises";
import { HistorianConfig } from "../config/types";
import { Point } from "../types/valueTypes";
import { BlockIndexEntry, encodeBlockIndexEntry, encodeSegmentRecord } from "./codec";
import { computePartition, ensureParentDir, indexPath, segmentPath, shardForTag } from "./layout";
import { LastValueStore } from "./lastValueStore";

interface QueueState {
  key: string;
  shard: number;
  partitionFolder: string;
  buffers: Buffer[];
  bytes: number;
  points: number;
  minTs: bigint;
  maxTs: bigint;
  minTagId: number;
  maxTagId: number;
  dropped: number;
  timer?: NodeJS.Timeout;
  flushing: boolean;
}

interface FileState {
  segHandle: fs.FileHandle;
  idxHandle: fs.FileHandle;
  segOffset: bigint;
}

export interface WriterStats {
  acceptedPoints: number;
  droppedPoints: number;
  decodeErrors: number;
}

export class HistorianWriter {
  private readonly queues = new Map<string, QueueState>();
  private readonly files = new Map<string, Promise<FileState>>();
  private readonly stats: WriterStats = { acceptedPoints: 0, droppedPoints: 0, decodeErrors: 0 };

  constructor(
    private readonly config: HistorianConfig,
    private readonly lastValueStore?: LastValueStore
  ) {}

  getStats(): WriterStats {
    return { ...this.stats };
  }

  markDecodeError(): void {
    this.stats.decodeErrors += 1;
  }

  ingestBatch(points: Point[]): void {
    for (const p of points) this.ingestPoint(p);
  }

  async close(): Promise<void> {
    const flushes = [...this.queues.values()].map((q) => this.flushQueue(q, true));
    await Promise.all(flushes);
    const fstates = await Promise.all([...this.files.values()]);
    await Promise.all(
      fstates.flatMap((f) => [f.segHandle.close().catch(() => undefined), f.idxHandle.close().catch(() => undefined)])
    );
    for (const q of this.queues.values()) {
      if (q.timer) clearInterval(q.timer);
    }
    this.queues.clear();
    this.files.clear();
  }

  private ingestPoint(point: Point): void {
    const partition = computePartition(point.tsEpoch, this.config);
    const shard = shardForTag(point.tagId, this.config.storage.shardCount);
    const key = `${partition.folder}|${shard}`;
    let q = this.queues.get(key);
    if (!q) {
      q = {
        key,
        shard,
        partitionFolder: partition.folder,
        buffers: [],
        bytes: 0,
        points: 0,
        minTs: point.tsEpoch,
        maxTs: point.tsEpoch,
        minTagId: point.tagId,
        maxTagId: point.tagId,
        dropped: 0,
        flushing: false
      };
      q.timer = setInterval(() => void this.flushQueue(q!), this.config.flush.flushIntervalMs);
      q.timer.unref();
      this.queues.set(key, q);
    }
    if (q.points >= this.config.flush.maxQueuePoints) {
      if (this.config.flush.backpressurePolicy === "drop_new") {
        q.dropped += 1;
        this.stats.droppedPoints += 1;
        return;
      }
      if (q.buffers.length > 0) {
        const removed = q.buffers.shift();
        if (removed) q.bytes -= removed.length;
        q.points -= 1;
      }
      this.stats.droppedPoints += 1;
    }
    this.lastValueStore?.update(point);
    if (q.points === 0) {
      q.minTs = point.tsEpoch;
      q.maxTs = point.tsEpoch;
      q.minTagId = point.tagId;
      q.maxTagId = point.tagId;
    }
    const rec = encodeSegmentRecord(point);
    q.buffers.push(rec);
    q.bytes += rec.length;
    q.points += 1;
    q.minTs = point.tsEpoch < q.minTs ? point.tsEpoch : q.minTs;
    q.maxTs = point.tsEpoch > q.maxTs ? point.tsEpoch : q.maxTs;
    q.minTagId = Math.min(q.minTagId, point.tagId);
    q.maxTagId = Math.max(q.maxTagId, point.tagId);
    this.stats.acceptedPoints += 1;
    if (q.bytes >= this.config.flush.flushBytes) {
      void this.flushQueue(q);
    }
  }

  private async flushQueue(q: QueueState, force = false): Promise<void> {
    if (q.flushing) return;
    if (!force && q.points === 0) return;
    if (q.points === 0) return;
    q.flushing = true;
    try {
      const payload = Buffer.concat(q.buffers, q.bytes);
      const blockMeta: BlockIndexEntry = {
        minTs: q.minTs,
        maxTs: q.maxTs,
        byteOffsetStart: 0n,
        byteOffsetEnd: 0n,
        pointCount: q.points,
        minTagId: q.minTagId,
        maxTagId: q.maxTagId
      };
      const file = await this.openFiles(q.partitionFolder, q.shard);
      blockMeta.byteOffsetStart = file.segOffset;
      const written = await file.segHandle.write(payload, 0, payload.length, Number(file.segOffset));
      file.segOffset += BigInt(written.bytesWritten);
      blockMeta.byteOffsetEnd = file.segOffset;
      if (this.config.index.indexBlockOnFlush) {
        const idx = encodeBlockIndexEntry(blockMeta);
        await file.idxHandle.write(idx);
      }
      q.buffers = [];
      q.bytes = 0;
      q.points = 0;
      q.minTs = 0n;
      q.maxTs = 0n;
      q.minTagId = Number.MAX_SAFE_INTEGER;
      q.maxTagId = 0;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[writer] flush failed on ${q.key}`, err);
    } finally {
      q.flushing = false;
    }
  }

  private openFiles(partitionFolder: string, shard: number): Promise<FileState> {
    const key = `${partitionFolder}|${shard}`;
    const existing = this.files.get(key);
    if (existing) return existing;
    const pending = this.openFilesInternal(partitionFolder, shard);
    this.files.set(key, pending);
    return pending;
  }

  private async openFilesInternal(partitionFolder: string, shard: number): Promise<FileState> {
    const [day, hour] = partitionFolder.split("/");
    const partition = { day, hour, folder: partitionFolder, partitionStartMs: 0 };
    const seg = segmentPath(this.config.storage.dataDir, partition, shard);
    const idx = indexPath(this.config.storage.dataDir, partition, shard);
    await ensureParentDir(seg);
    await ensureParentDir(idx);
    const segHandle = await fs.open(seg, "a+");
    const idxHandle = await fs.open(idx, "a+");
    const stat = await segHandle.stat();
    return { segHandle, idxHandle, segOffset: BigInt(stat.size) };
  }
}
