import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type { AssetStore } from "../../../runtime/core/runtimeTypes";
import { createAssetPerfFixture } from "./assetStore.fixture";
import { printPerfResults, runPerfCase, type PerfResult } from "../shared/perfReport";

interface BenchmarkScenario {
  name: string;
  machineCount: number;
  attributesPerMachine: number;
  getIterations: number;
  setIterations: number;
  batchIterations: number;
  mixedIterations: number;
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

function runScenario(scenario: BenchmarkScenario): PerfResult[] {
  const fixture = createAssetPerfFixture({
    machineCount: scenario.machineCount,
    attributesPerMachine: scenario.attributesPerMachine
  });
  const store = createAssetStore(fixture.section);
  const results: PerfResult[] = [];

  results.push(runGetHotPathCase(store, fixture.hotAttributePaths, scenario.getIterations, scenario.name));
  results.push(runSetSingleCase(store, fixture.hotAttributePaths, scenario.setIterations, scenario.name));
  results.push(runSetBatchCase(store, fixture.hotAttributePaths, scenario.batchIterations, scenario.name));
  results.push(runMixedReadWriteCase(store, fixture.hotAttributePaths, scenario.mixedIterations, scenario.name));

  return results;
}

function runGetHotPathCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const readsPerIteration = Math.min(500, hotPaths.length);
  return runPerfCase(`${scenarioName}: getValue x${readsPerIteration}`, iterations, readsPerIteration, (iteration) => {
    for (let index = 0; index < readsPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.getValue(path);
    }
  });
}

function runSetSingleCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const writesPerIteration = Math.min(200, hotPaths.length);
  return runPerfCase(`${scenarioName}: setAttribute x${writesPerIteration}`, iterations, writesPerIteration, (iteration) => {
    for (let index = 0; index < writesPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.setAttribute(path, iteration + index);
    }
  });
}

function runSetBatchCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const batchSize = Math.min(200, hotPaths.length);
  return runPerfCase(`${scenarioName}: setAttributes batch ${batchSize}`, iterations, batchSize, (iteration) => {
    store.setAttributes(buildWriteBatch(hotPaths, iteration * batchSize, batchSize));
  });
}

function runMixedReadWriteCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const operationsPerIteration = 300;
  return runPerfCase(`${scenarioName}: mixed 70r/30w`, iterations, operationsPerIteration, (iteration) => {
    const writes = buildWriteBatch(hotPaths, iteration * 90, 90);
    for (let index = 0; index < 210; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.getValue(path);
    }
    store.setAttributes(writes);
  });
}

function main(): void {
  const quickScenarios: BenchmarkScenario[] = [
    {
      name: "small",
      machineCount: 50,
      attributesPerMachine: 12,
      getIterations: 12,
      setIterations: 6,
      batchIterations: 6,
      mixedIterations: 6
    },
    {
      name: "medium",
      machineCount: 250,
      attributesPerMachine: 20,
      getIterations: 8,
      setIterations: 4,
      batchIterations: 4,
      mixedIterations: 4
    }
  ];

  const fullOnlyScenarios: BenchmarkScenario[] = [
    {
      name: "large",
      machineCount: 1000,
      attributesPerMachine: 40,
      getIterations: 6,
      setIterations: 3,
      batchIterations: 3,
      mixedIterations: 3
    }
  ];
  const scenarios = isFullModeEnabled() ? [...quickScenarios, ...fullOnlyScenarios] : quickScenarios;

  const results = scenarios.flatMap((scenario) => runScenario(scenario));
  console.log("");
  console.log("Asset Store Performance Benchmark");
  console.log("This benchmark targets hot-path attribute reads and writes in the in-memory asset store.");
  console.log(`Mode: ${isFullModeEnabled() ? "full" : "quick"}`);
  console.log("");
  printPerfResults(results);
}

main();
