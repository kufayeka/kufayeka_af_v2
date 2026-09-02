import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import { createRustAssetStore } from "../../../runtime/asset/RustAssetStore";
import type { AssetStore } from "../../../runtime/core/runtimeTypes";
import { createAssetPerfFixture } from "./assetStore.fixture";
import { printPerfResults, runPerfCase, type PerfResult } from "../shared/perfReport";

// Phase 2 head-to-head: same scenarios as assetStoreSubscribed.bench.ts (a
// subscriber is always attached, matching real production conditions where
// watcher triggers/persistence are always listening), run against both the
// pure-TypeScript store and the native-Rust-backed one, side by side.

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

function runSetSingleCase(store: AssetStore, hotPaths: string[], iterations: number, label: string): PerfResult {
  const writesPerIteration = Math.min(200, hotPaths.length);
  return runPerfCase(`${label}: setAttribute x${writesPerIteration}`, iterations, writesPerIteration, (iteration) => {
    for (let index = 0; index < writesPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.setAttribute(path, iteration + index);
    }
  });
}

function runSetBatchCase(store: AssetStore, hotPaths: string[], iterations: number, label: string): PerfResult {
  const batchSize = Math.min(200, hotPaths.length);
  return runPerfCase(`${label}: setAttributes batch ${batchSize}`, iterations, batchSize, (iteration) => {
    store.setAttributes(buildWriteBatch(hotPaths, iteration * batchSize, batchSize));
  });
}

function runGetCase(store: AssetStore, hotPaths: string[], iterations: number, label: string): PerfResult {
  const readsPerIteration = Math.min(500, hotPaths.length);
  return runPerfCase(`${label}: getValue x${readsPerIteration}`, iterations, readsPerIteration, (iteration) => {
    for (let index = 0; index < readsPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.getValue(path);
    }
  });
}

function runForImpl(
  label: string,
  createStore: (section: unknown) => AssetStore,
  scenario: BenchmarkScenario
): PerfResult[] {
  const fixture = createAssetPerfFixture({
    machineCount: scenario.machineCount,
    attributesPerMachine: scenario.attributesPerMachine
  });
  const store = createStore(fixture.section);
  store.subscribe(() => {});

  return [
    runGetCase(store, fixture.hotAttributePaths, scenario.setIterations, `${scenario.name} [${label}]`),
    runSetSingleCase(store, fixture.hotAttributePaths, scenario.setIterations, `${scenario.name} [${label}]`),
    runSetBatchCase(store, fixture.hotAttributePaths, scenario.batchIterations, `${scenario.name} [${label}]`)
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

  const results: PerfResult[] = [];
  for (const scenario of scenarios) {
    results.push(...runForImpl("TS", createAssetStore, scenario));
    results.push(...runForImpl("Rust", createRustAssetStore, scenario));
  }

  console.log("");
  console.log("Asset Store head-to-head: pure TypeScript vs native Rust keyspace (1 subscriber attached, matching production)");
  console.log(`Mode: ${isFullModeEnabled() ? "full" : "quick"}`);
  console.log("");
  printPerfResults(results);
}

main();
