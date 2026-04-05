import { performance } from "node:perf_hooks";

export interface PerfSample {
  durationMs: number;
  operations: number;
}

export interface PerfResult {
  name: string;
  iterations: number;
  operations: number;
  totalMs: number;
  avgMsPerIteration: number;
  avgMsPerOperation: number;
  opsPerSecond: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  memoryDeltaMb: number;
}

function formatNumber(value: number, fractionDigits = 2): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : "NaN";
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function runPerfCase(
  name: string,
  iterations: number,
  operationsPerIteration: number,
  execute: (iteration: number) => void
): PerfResult {
  const samples: PerfSample[] = [];
  const memoryBefore = process.memoryUsage().heapUsed;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    execute(iteration);
    const endedAt = performance.now();
    samples.push({
      durationMs: endedAt - startedAt,
      operations: operationsPerIteration
    });
  }

  const memoryAfter = process.memoryUsage().heapUsed;
  const durations = samples.map((sample) => sample.durationMs);
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const totalOperations = samples.reduce((sum, sample) => sum + sample.operations, 0);

  return {
    name,
    iterations,
    operations: totalOperations,
    totalMs,
    avgMsPerIteration: totalMs / Math.max(1, iterations),
    avgMsPerOperation: totalMs / Math.max(1, totalOperations),
    opsPerSecond: totalOperations / Math.max(0.001, totalMs / 1000),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    p95Ms: percentile(durations, 0.95),
    memoryDeltaMb: (memoryAfter - memoryBefore) / (1024 * 1024)
  };
}

export function printPerfResults(results: PerfResult[]): void {
  const rows = results.map((result) => ({
    name: result.name,
    iterations: result.iterations,
    operations: result.operations,
    totalMs: formatNumber(result.totalMs),
    avgMsIteration: formatNumber(result.avgMsPerIteration),
    avgMsOperation: formatNumber(result.avgMsPerOperation, 4),
    opsPerSecond: formatNumber(result.opsPerSecond),
    p95Ms: formatNumber(result.p95Ms),
    memoryDeltaMb: formatNumber(result.memoryDeltaMb, 3)
  }));

  console.table(rows);
}
