import { performance } from "node:perf_hooks";
import type { PerfResult } from "../shared/perfReport";
import { printPerfResults } from "../shared/perfReport";
import {
  createTriggerMessage,
  matchWildcardPath,
  matchWildcardText,
  resolveTriggerConfig,
  shouldEmitAttributeChange
} from "../../../runtime/flow/ProgramTriggerSupport";

async function runAsyncPerfCase(
  name: string,
  iterations: number,
  operationsPerIteration: number,
  execute: (iteration: number) => void | Promise<void>
): Promise<PerfResult> {
  const samples: Array<{ durationMs: number; operations: number }> = [];
  const memoryBefore = process.memoryUsage().heapUsed;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    await execute(iteration);
    samples.push({ durationMs: performance.now() - startedAt, operations: operationsPerIteration });
  }

  const durations = samples.map((sample) => sample.durationMs);
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const operations = samples.reduce((sum, sample) => sum + sample.operations, 0);
  const sorted = [...durations].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  const memoryAfter = process.memoryUsage().heapUsed;

  return {
    name,
    iterations,
    operations,
    totalMs,
    avgMsPerIteration: totalMs / Math.max(1, iterations),
    avgMsPerOperation: totalMs / Math.max(1, operations),
    opsPerSecond: operations / Math.max(0.001, totalMs / 1000),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    p95Ms: sorted[p95Index] ?? 0,
    memoryDeltaMb: (memoryAfter - memoryBefore) / (1024 * 1024)
  };
}

async function main(): Promise<void> {
  const results: PerfResult[] = [];

  results.push(
    await runAsyncPerfCase("flow: matchWildcardPath x5000", 20, 5000, (iteration) => {
      for (let index = 0; index < 5000; index += 1) {
        matchWildcardPath("Plant.Line1.*.Speed", `Plant.Line1.Machine${(iteration + index) % 50}.Speed`);
      }
    })
  );

  results.push(
    await runAsyncPerfCase("flow: matchWildcardText x5000", 20, 5000, (iteration) => {
      for (let index = 0; index < 5000; index += 1) {
        matchWildcardText("Plant/Line1/*", `Plant/Line1/Machine${(iteration + index) % 50}`);
      }
    })
  );

  results.push(
    await runAsyncPerfCase("flow: shouldEmitAttributeChange x3000", 15, 3000, (iteration) => {
      const lastSeen = new Map<string, string>();
      for (let index = 0; index < 3000; index += 1) {
        shouldEmitAttributeChange(
          "valuechange",
          {
            kind: "attribute",
            path: `Plant.Line1.Machine${(index % 20) + 1}.Speed`,
            assetId: `m${(index % 20) + 1}`,
            attributeName: "Speed",
            value: (iteration + index) % 7,
            ts: `ts-${iteration}-${index}`
          },
          "Plant.Line1.*.Speed",
          lastSeen
        );
      }
    })
  );

  results.push(
    await runAsyncPerfCase("flow: createTriggerMessage x4000", 20, 4000, (iteration) => {
      for (let index = 0; index < 4000; index += 1) {
        createTriggerMessage(
          { id: "trg-1", type: "interval", message: { payload: 0, marker: iteration } },
          { seq: index },
          { type: "interval" },
          { now: () => "2026-01-01T00:00:00.000Z", cloneMessage: <T>(value: T) => structuredClone(value) }
        );
      }
    })
  );

  results.push(
    await runAsyncPerfCase("flow: resolveTriggerConfig x2000", 20, 2000, (iteration) => {
      const templateById = new Map([
        [
          "tmpl-1",
          {
            id: "tmpl-1",
            type: "watcher_set",
            intervalMs: 1000,
            watchPath: "Plant.Line1.*.Speed",
            message: { payload: 0 }
          }
        ]
      ]);
      for (let index = 0; index < 2000; index += 1) {
        resolveTriggerConfig(
          {
            id: `trg-${iteration}-${index}`,
            kind: "trigger",
            templateId: "tmpl-1",
            config: { intervalMs: 500 + index, type: "watcher_set" }
          } as any,
          templateById as any
        );
      }
    })
  );

  console.log("");
  console.log("Flow Performance Benchmark");
  console.log("This benchmark targets trigger matching, watcher filtering, and message creation hot paths.");
  console.log("");
  printPerfResults(results);
}

void main();
