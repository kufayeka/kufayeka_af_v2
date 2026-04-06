import { performance } from "node:perf_hooks";
import type { PerfResult } from "../shared/perfReport";
import { printPerfResults } from "../shared/perfReport";
import { OpenEventCache } from "../../../runtime/event/store/OpenEventCache";
import { EventStoreService } from "../../../runtime/event/store/EventStoreService";
import { FakeEventStoreRepository } from "../../stress/event/eventStore.fakeRepository";
import { createEventPerfFixture } from "./eventStore.fixture";

interface BenchmarkScenario {
  name: string;
  openRowCount: number;
  openIterations: number;
  closeByIdIterations: number;
  acknowledgeIterations: number;
  queryIterations: number;
  mixedIterations: number;
  warmupIterations: number;
}

function isFullModeEnabled(): boolean {
  const raw = String(process.env.EVENT_PERF_MODE || "quick").trim().toLowerCase();
  return raw === "full" || raw === "stress";
}

function createStore(openRowCount: number): EventStoreService {
  const fixture = createEventPerfFixture({ openRowCount });
  const repository = new FakeEventStoreRepository({ initialRows: fixture.openRows });
  return new EventStoreService(repository, new OpenEventCache());
}

async function runAsyncPerfCase(
  name: string,
  iterations: number,
  operationsPerIteration: number,
  execute: (iteration: number) => Promise<void>
): Promise<PerfResult> {
  const samples: Array<{ durationMs: number; operations: number }> = [];
  const memoryBefore = process.memoryUsage().heapUsed;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    await execute(iteration);
    const endedAt = performance.now();
    samples.push({ durationMs: endedAt - startedAt, operations: operationsPerIteration });
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

async function runScenario(scenario: BenchmarkScenario): Promise<PerfResult[]> {
  const fixture = createEventPerfFixture({ openRowCount: scenario.openRowCount });
  const results: PerfResult[] = [];

  results.push(
    await runAsyncPerfCase(`${scenario.name}: warmup loadOpenRows`, scenario.warmupIterations, fixture.openRows.length, async () => {
      const store = createStore(scenario.openRowCount);
      await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    })
  );

  {
    const store = createStore(scenario.openRowCount);
    await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    const writesPerIteration = 100;
    results.push(
      await runAsyncPerfCase(`${scenario.name}: open x${writesPerIteration}`, scenario.openIterations, writesPerIteration, async (iteration) => {
        for (let index = 0; index < writesPerIteration; index += 1) {
          const path = fixture.hotPaths[(iteration + index) % fixture.hotPaths.length];
          await store.open(path, new Date(Date.UTC(2026, 0, 2, 0, iteration, index)).toISOString(), { machine: `perf-${index}`, category: "production" }, "", "medium", null, null);
        }
      })
    );
  }

  {
    const store = createStore(scenario.openRowCount);
    await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    const operations = 150;
    results.push(
      await runAsyncPerfCase(`${scenario.name}: acknowledgeById x${operations}`, scenario.acknowledgeIterations, operations, async (iteration) => {
        for (let index = 0; index < operations; index += 1) {
          const id = fixture.hotIds[(iteration + index) % fixture.hotIds.length];
          await store.acknowledgeById(id, new Date(Date.UTC(2026, 0, 2, 1, iteration, index)).toISOString());
        }
      })
    );
  }

  {
    const store = createStore(scenario.openRowCount);
    await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    const operations = 150;
    results.push(
      await runAsyncPerfCase(`${scenario.name}: closeById x${operations}`, scenario.closeByIdIterations, operations, async (iteration) => {
        for (let index = 0; index < operations; index += 1) {
          const id = fixture.hotIds[(iteration + index) % fixture.hotIds.length];
          await store.closeById(id, new Date(Date.UTC(2026, 0, 2, 2, iteration, index)).toISOString(), "", null);
        }
      })
    );
  }

  {
    const store = createStore(scenario.openRowCount);
    await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    results.push(
      await runAsyncPerfCase(`${scenario.name}: query exact path x200`, scenario.queryIterations, 200, async (iteration) => {
        for (let index = 0; index < 200; index += 1) {
          const path = fixture.hotPaths[(iteration + index) % fixture.hotPaths.length];
          await store.query(path, "*", "*", "open", {}, { limit: 25 });
        }
      })
    );
    results.push(
      await runAsyncPerfCase(`${scenario.name}: query wildcard path x200`, scenario.queryIterations, 200, async (iteration) => {
        for (let index = 0; index < 200; index += 1) {
          const path = fixture.hotPaths[(iteration + index) % fixture.hotPaths.length];
          const parts = path.split(".");
          await store.query(`${parts[0]}.${parts[1]}.*`, "*", "*", "open", {}, { limit: 50 });
        }
      })
    );
    results.push(
      await runAsyncPerfCase(`${scenario.name}: query context filter x120`, scenario.queryIterations, 120, async (iteration) => {
        for (let index = 0; index < 120; index += 1) {
          const filters = fixture.hotContextFilters[(iteration + index) % fixture.hotContextFilters.length];
          await store.query("*", "*", "*", "open", filters, { limit: 50, severity: "*" });
        }
      })
    );
  }

  {
    const store = createStore(scenario.openRowCount);
    await store.query("*", "*", "*", "open", {}, { limit: 5000 });
    const operations = 200;
    results.push(
      await runAsyncPerfCase(`${scenario.name}: mixed lifecycle x${operations}`, scenario.mixedIterations, operations, async (iteration) => {
        for (let index = 0; index < 80; index += 1) {
          const path = fixture.hotPaths[(iteration + index) % fixture.hotPaths.length];
          await store.open(path, new Date(Date.UTC(2026, 0, 2, 3, iteration, index)).toISOString(), { cycle: iteration }, "", "info", null, null);
        }
        for (let index = 0; index < 40; index += 1) {
          const id = fixture.hotIds[(iteration + index) % fixture.hotIds.length];
          await store.acknowledgeById(id, new Date(Date.UTC(2026, 0, 2, 4, iteration, index)).toISOString());
        }
        for (let index = 0; index < 40; index += 1) {
          const id = fixture.hotIds[(iteration + index) % fixture.hotIds.length];
          await store.closeById(id, new Date(Date.UTC(2026, 0, 2, 5, iteration, index)).toISOString(), "", null);
        }
        for (let index = 0; index < 40; index += 1) {
          const path = fixture.hotPaths[(iteration + index) % fixture.hotPaths.length];
          const parts = path.split(".");
          await store.query(`${parts[0]}.${parts[1]}.*`, "*", "*", "open", {}, { limit: 25 });
        }
      })
    );
  }

  return results;
}

async function main(): Promise<void> {
  const quickScenarios: BenchmarkScenario[] = [
    { name: "small", openRowCount: 1000, openIterations: 4, closeByIdIterations: 4, acknowledgeIterations: 4, queryIterations: 8, mixedIterations: 4, warmupIterations: 3 },
    { name: "medium", openRowCount: 10000, openIterations: 3, closeByIdIterations: 3, acknowledgeIterations: 3, queryIterations: 6, mixedIterations: 3, warmupIterations: 2 }
  ];
  const fullOnlyScenarios: BenchmarkScenario[] = [
    { name: "large", openRowCount: 50000, openIterations: 2, closeByIdIterations: 2, acknowledgeIterations: 2, queryIterations: 4, mixedIterations: 2, warmupIterations: 2 }
  ];

  const scenarios = isFullModeEnabled() ? [...quickScenarios, ...fullOnlyScenarios] : quickScenarios;
  const results: PerfResult[] = [];
  for (const scenario of scenarios) {
    results.push(...(await runScenario(scenario)));
  }

  console.log("");
  console.log("Event Store Performance Benchmark");
  console.log("This benchmark targets event lifecycle operations, open-cache warmup, and hot-path queries.");
  console.log(`Mode: ${isFullModeEnabled() ? "full" : "quick"}`);
  console.log("");
  printPerfResults(results);
}

void main();
