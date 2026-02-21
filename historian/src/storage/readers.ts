import fs from "node:fs/promises";
import { BLOCK_INDEX_ENTRY_SIZE, BlockIndexEntry, decodeBlockIndex, decodeSegmentRecord } from "./codec";
import { Point } from "../types/valueTypes";

export interface SegmentScanRange {
  start: bigint;
  end: bigint;
}

export async function readBlockIndex(idxPath: string): Promise<BlockIndexEntry[]> {
  try {
    const st = await fs.stat(idxPath);
    if (st.size < BLOCK_INDEX_ENTRY_SIZE) return [];
    const buf = await fs.readFile(idxPath);
    return decodeBlockIndex(buf);
  } catch {
    return [];
  }
}

export async function readSegmentRanges(segPath: string, ranges: SegmentScanRange[]): Promise<Buffer[]> {
  if (ranges.length === 0) return [];
  const fh = await fs.open(segPath, "r");
  try {
    const out: Buffer[] = [];
    for (const r of ranges) {
      const len = Number(r.end - r.start);
      if (len <= 0) continue;
      const b = Buffer.allocUnsafe(len);
      const rd = await fh.read(b, 0, len, Number(r.start));
      out.push(rd.buffer.subarray(0, rd.bytesRead));
    }
    return out;
  } finally {
    await fh.close();
  }
}

export function decodePointsFromChunks(chunks: Buffer[], onPoint: (p: Point) => boolean): void {
  for (const chunk of chunks) {
    let off = 0;
    while (off < chunk.length) {
      const rec = decodeSegmentRecord(chunk, off);
      if (!rec) break;
      off += rec.bytesRead;
      const keepGoing = onPoint(rec.point);
      if (!keepGoing) return;
    }
  }
}
