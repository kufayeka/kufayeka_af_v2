import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG } from "./defaults";
import { HistorianConfig } from "./types";

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return (override as T) ?? base;
  }
  const merged = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(override)) {
    const existing = merged[k];
    if (isObject(existing) && isObject(v)) {
      merged[k] = deepMerge(existing, v);
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }
  return merged as T;
}

function validate(config: HistorianConfig): void {
  if (config.storage.shardCount <= 0) throw new Error("storage.shardCount must be > 0");
  if (config.storage.partitionDurationMs <= 0) throw new Error("storage.partitionDurationMs must be > 0");
  if (config.flush.flushIntervalMs <= 0) throw new Error("flush.flushIntervalMs must be > 0");
  if (config.flush.flushBytes <= 0) throw new Error("flush.flushBytes must be > 0");
  if (config.flush.maxQueuePoints <= 0) throw new Error("flush.maxQueuePoints must be > 0");
  if (config.http.maxPoints <= 0) throw new Error("http.maxPoints must be > 0");
  if (config.http.maxRangeMs <= 0) throw new Error("http.maxRangeMs must be > 0");
}

export async function loadConfig(configPath = "historian.config.json"): Promise<HistorianConfig> {
  const absPath = path.resolve(configPath);
  let fileConfig: Partial<HistorianConfig> = {};
  try {
    const raw = await fs.readFile(absPath, "utf8");
    fileConfig = JSON.parse(raw) as Partial<HistorianConfig>;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
  }

  const config = deepMerge(DEFAULT_CONFIG, fileConfig);
  validate(config);
  return config;
}
