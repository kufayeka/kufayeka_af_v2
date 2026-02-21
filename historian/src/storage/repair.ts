import { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HistorianConfig } from "../config/types";
import { BLOCK_INDEX_ENTRY_SIZE, decodeSegmentRecord } from "./codec";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let items: Dirent[] = [];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return out;
    throw err;
  }
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function repairSegment(filePath: string): Promise<{ truncated: boolean; oldSize: number; newSize: number }> {
  const data = await fs.readFile(filePath);
  let off = 0;
  while (off < data.length) {
    const d = decodeSegmentRecord(data, off);
    if (!d) break;
    off += d.bytesRead;
  }
  if (off === data.length) return { truncated: false, oldSize: data.length, newSize: off };
  await fs.truncate(filePath, off);
  return { truncated: true, oldSize: data.length, newSize: off };
}

async function repairIndex(filePath: string): Promise<{ truncated: boolean; oldSize: number; newSize: number }> {
  const stat = await fs.stat(filePath);
  const aligned = Math.floor(stat.size / BLOCK_INDEX_ENTRY_SIZE) * BLOCK_INDEX_ENTRY_SIZE;
  if (aligned === stat.size) return { truncated: false, oldSize: stat.size, newSize: aligned };
  await fs.truncate(filePath, aligned);
  return { truncated: true, oldSize: stat.size, newSize: aligned };
}

export async function repairStorageTail(config: HistorianConfig): Promise<void> {
  const rawDir = path.join(config.storage.dataDir, "raw");
  const indexDir = path.join(config.storage.dataDir, "index");
  const files = await walk(rawDir);
  for (const f of files) {
    if (!f.endsWith(".seg")) continue;
    const r = await repairSegment(f);
    if (r.truncated) {
      // eslint-disable-next-line no-console
      console.warn(`[repair] truncated segment ${f} ${r.oldSize} -> ${r.newSize}`);
    }
  }
  const idxFiles = await walk(indexDir);
  for (const f of idxFiles) {
    if (!f.endsWith(".idx")) continue;
    const r = await repairIndex(f);
    if (r.truncated) {
      // eslint-disable-next-line no-console
      console.warn(`[repair] truncated index ${f} ${r.oldSize} -> ${r.newSize}`);
    }
  }
}
