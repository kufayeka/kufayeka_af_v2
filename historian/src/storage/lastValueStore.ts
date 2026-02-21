import fs from "node:fs/promises";
import path from "node:path";
import { HistorianConfig } from "../config/types";
import { decodeSegmentRecord, encodeSegmentRecord } from "./codec";
import { Point } from "../types/valueTypes";

export class LastValueStore {
  private readonly latest = new Map<number, Point>();
  private readonly queue: Buffer[] = [];
  private queueBytes = 0;
  private fileHandle?: fs.FileHandle;
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private readonly filePath: string;

  constructor(private readonly config: HistorianConfig) {
    this.filePath = path.join(config.storage.dataDir, "meta", "last-values.log");
  }

  async start(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.loadFromDisk();
    this.fileHandle = await fs.open(this.filePath, "a+");
    this.flushTimer = setInterval(() => void this.flush(), 25);
    this.flushTimer.unref();
  }

  async close(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
    await this.fileHandle?.close().catch(() => undefined);
  }

  update(point: Point): void {
    const cur = this.latest.get(point.tagId);
    if (!cur || point.tsEpoch >= cur.tsEpoch) {
      this.latest.set(point.tagId, point);
    }
    const rec = encodeSegmentRecord(point);
    this.queue.push(rec);
    this.queueBytes += rec.length;
    if (this.queueBytes >= 64 * 1024) {
      void this.flush();
    }
  }

  getLatest(tagIds: number[]): Point[] {
    const out: Point[] = [];
    for (const id of tagIds) {
      const p = this.latest.get(id);
      if (p) out.push(p);
    }
    return out;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queueBytes === 0 || !this.fileHandle) return;
    this.flushing = true;
    try {
      const payload = Buffer.concat(this.queue, this.queueBytes);
      this.queue.length = 0;
      this.queueBytes = 0;
      await this.fileHandle.write(payload);
    } catch {
      // best-effort side index; raw segment remains source of truth
    } finally {
      this.flushing = false;
    }
  }

  private async loadFromDisk(): Promise<void> {
    let data: Buffer;
    try {
      data = await fs.readFile(this.filePath);
    } catch {
      return;
    }
    let off = 0;
    while (off < data.length) {
      const rec = decodeSegmentRecord(data, off);
      if (!rec) break;
      off += rec.bytesRead;
      const p = rec.point;
      const cur = this.latest.get(p.tagId);
      if (!cur || p.tsEpoch >= cur.tsEpoch) {
        this.latest.set(p.tagId, p);
      }
    }
    if (off < data.length) {
      await fs.truncate(this.filePath, off).catch(() => undefined);
    }
  }
}
