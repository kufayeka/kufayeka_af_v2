import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type { AssetStore } from "../../../runtime/core/runtimeTypes";
import { createAssetPerfFixture } from "./assetStore.fixture";
import { printPerfResults, runPerfCase, type PerfResult } from "../shared/perfReport";

// This mirrors assetStore.bench.ts, but attaches a subscriber before running
// the write benchmarks. Production always has at least one live subscriber
// (watcher triggers, persistence, the historian bridge), so a benchmark with
// zero listeners never exercises the emitChange() notification path at all —
// which is exactly where the old structuredClone()-per-write cost lived.

interface BenchmarkScenario {
  name: string;
  machineCount: number;
  attributesPerMachine: number;
  setIterations: number;
  batchIterations: number;
}

function isFullModeEnabled(): boolean {
  const raw = String(process.env.ASSET_PERF_MODE || "quick").trim().toLowerCase();
  return raw === "full" || raw === "stress";
}

function buildWriteBatch(paths: string[], startValue: number, batchSize: number): Array<{ path: string; value: unknown }> {
  const items: Array<{ path: string; value: unknown }> = [];
  for (let index = 0; index < batchSize; index += 1) {
    const path = paths[(startValue + index) % paths.length];
    items.push({ path, value: startValue + index });
  }
  return items;
}

function runSetSingleCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const writesPerIteration = Math.min(200, hotPaths.length);
  return runPerfCase(`${scenarioName}: setAttribute x${writesPerIteration} (1 subscriber)`, iterations, writesPerIteration, (iteration) => {
    for (let index = 0; index < writesPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.setAttribute(path, iteration + index);
    }
  });
}

function runSetBatchCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const batchSize = Math.min(200, hotPaths.length);
  return runPerfCase(`${scenarioName}: setAttributes batch ${batchSize} (1 subscriber)`, iterations, batchSize, (iteration) => {
    store.setAttributes(buildWriteBatch(hotPaths, iteration * batchSize, batchSize));
  });
}

function runScenario(scenario: BenchmarkScenario): PerfResult[] {
  const fixture = createAssetPerfFixture({
    machineCount: scenario.machineCount,
    attributesPerMachine: scenario.attributesPerMachine
  });
  const store = createAssetStore(fixture.section);
  // Mimic a live watcher trigger / persistence subscriber. A no-op listener
  // is enough to force emitChange() to do whatever work it does per write.
  store.subscribe(() => {});

  return [
    runSetSingleCase(store, fixture.hotAttributePaths, scenario.setIterations, scenario.name),
    runSetBatchCase(store, fixture.hotAttributePaths, scenario.batchIterations, scenario.name)
  ];
}

function main(): void {
  const quickScenarios: BenchmarkScenario[] = [
    { name: "small", machineCount: 50, attributesPerMachine: 12, setIterations: 6, batchIterations: 6 },
    { name: "medium", machineCount: 250, attributesPerMachine: 20, setIterations: 4, batchIterations: 4 }
  ];

  const fullOnlyScenarios: BenchmarkScenario[] = [
    { name: "large", machineCount: 1000, attributesPerMachine: 40, setIterations: 3, batchIterations: 3 }
  ];
  const scenarios = isFullModeEnabled() ? [...quickScenarios, ...fullOnlyScenarios] : quickScenarios;

  const results = scenarios.flatMap((scenario) => runScenario(scenario));
  console.log("");
  console.log("Asset Store Performance Benchmark (with a subscriber attached)");
  console.log("This reproduces production conditions (watcher triggers always exist) to catch");
  console.log("notification-path costs that a subscriber-less benchmark can't see.");
  console.log(`Mode: ${isFullModeEnabled() ? "full" : "quick"}`);
  console.log("");
  printPerfResults(results);
}

main();
