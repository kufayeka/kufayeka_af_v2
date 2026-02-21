import os from "node:os";
import { HistorianConfig } from "./types";

export const DEFAULT_CONFIG: HistorianConfig = {
  udp: {
    host: "0.0.0.0",
    port: 9900
  },
  http: {
    host: "0.0.0.0",
    port: 8080,
    maxPoints: 100_000,
    maxRangeMs: 24 * 3600 * 1000,
    streamThresholdPoints: 5_000
  },
  storage: {
    dataDir: "./data",
    shardCount: 16,
    partitionDurationMs: 3600 * 1000,
    timestampUnit: "us"
  },
  flush: {
    flushIntervalMs: 5,
    flushBytes: 256 * 1024,
    maxQueuePoints: 200_000,
    backpressurePolicy: "drop_new"
  },
  index: {
    indexBlockOnFlush: true,
    enablePerTagSparseIndex: false,
    indexStridePerTag: 4096
  },
  retention: {
    enabled: false,
    maxAgeHours: 24 * 7,
    checkIntervalMs: 5 * 60 * 1000
  },
  workers: {
    poolSize: Math.max(1, os.cpus().length - 1),
    maxPoolSize: 8,
    jobTimeoutMs: 15000,
    offloadMinRangeMs: 2 * 3600 * 1000,
    offloadMinLimit: 5000
  }
};
