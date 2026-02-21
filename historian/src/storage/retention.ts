import { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HistorianConfig } from "../config/types";

function parsePartitionFolder(day: string, hour: string): number | null {
  const dt = new Date(`${day}T${hour}:00:00.000Z`);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function safeRm(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export class RetentionManager {
  private timer?: NodeJS.Timeout;

  constructor(private readonly config: HistorianConfig) {}

  start(): void {
    if (!this.config.retention.enabled) return;
    this.timer = setInterval(() => void this.runOnce(), this.config.retention.checkIntervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    const maxAgeMs = this.config.retention.maxAgeHours * 3600 * 1000;
    const cutoff = Date.now() - maxAgeMs;
    for (const top of ["raw", "index"]) {
      const topDir = path.join(this.config.storage.dataDir, top);
      let dayDirs: Dirent[] = [];
      try {
        dayDirs = await fs.readdir(topDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dayDir of dayDirs) {
        if (!dayDir.isDirectory()) continue;
        const dayPath = path.join(topDir, dayDir.name);
        let hourDirs: Dirent[] = [];
        try {
          hourDirs = await fs.readdir(dayPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const hourDir of hourDirs) {
          if (!hourDir.isDirectory()) continue;
          const partMs = parsePartitionFolder(dayDir.name, hourDir.name);
          if (partMs === null || partMs >= cutoff) continue;
          await safeRm(path.join(dayPath, hourDir.name));
        }
        const leftovers = await fs.readdir(dayPath).catch(() => []);
        if (leftovers.length === 0) {
          await safeRm(dayPath);
        }
      }
    }
  }
}
