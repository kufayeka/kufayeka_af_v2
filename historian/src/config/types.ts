export type BackpressurePolicy = "drop_new" | "drop_oldest";
export type TimestampUnit = "us" | "ns";

export interface HistorianConfig {
  udp: {
    host: string;
    port: number;
  };
  http: {
    host: string;
    port: number;
    maxPoints: number;
    maxRangeMs: number;
    streamThresholdPoints: number;
  };
  storage: {
    dataDir: string;
    shardCount: number;
    partitionDurationMs: number;
    timestampUnit: TimestampUnit;
  };
  flush: {
    flushIntervalMs: number;
    flushBytes: number;
    maxQueuePoints: number;
    backpressurePolicy: BackpressurePolicy;
  };
  index: {
    indexBlockOnFlush: boolean;
    enablePerTagSparseIndex: boolean;
    indexStridePerTag: number;
  };
  retention: {
    enabled: boolean;
    maxAgeHours: number;
    checkIntervalMs: number;
  };
  workers: {
    poolSize: number;
    maxPoolSize: number;
    jobTimeoutMs: number;
    offloadMinRangeMs: number;
    offloadMinLimit: number;
  };
}
