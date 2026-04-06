import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type { AssetStore } from "../../../runtime/core/runtimeTypes";
import { createAssetPerfFixture } from "./assetStore.fixture";
import { printPerfResults, runPerfCase, type PerfResult } from "../shared/perfReport";

interface BenchmarkScenario {
  name: string;
  machineCount: number;
  attributesPerMachine: number;
  exactGetIterations: number;
  exactSetIterations: number;
  exactMixedIterations: number;
}

function selectNumericPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    const match = path.match(/\.Attr(\d{3})$/);
    if (!match) return false;
    const attributeNumber = Number(match[1]);
    return Number.isFinite(attributeNumber) && attributeNumber % 5 !== 1;
  });
}

function isFullModeEnabled(): boolean {
  const raw = String(process.env.ASSET_EXACT_PERF_MODE || "quick").trim().toLowerCase();
  return raw === "full" || raw === "stress";
}

function runScenario(scenario: BenchmarkScenario): PerfResult[] {
  const fixture = createAssetPerfFixture({
    machineCount: scenario.machineCount,
    attributesPerMachine: scenario.attributesPerMachine
  });
  const store = createAssetStore(fixture.section);
  const hotPaths = selectNumericPaths(fixture.hotAttributePaths);
  return [
    runExactGetCase(store, hotPaths, scenario.exactGetIterations, scenario.name),
    runExactSetCase(store, hotPaths, scenario.exactSetIterations, scenario.name),
    runExactMixedCase(store, hotPaths, scenario.exactMixedIterations, scenario.name)
  ];
}

function runExactGetCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const readsPerIteration = Math.min(2000, hotPaths.length * 4);
  return runPerfCase(`${scenarioName}: exact getValue x${readsPerIteration}`, iterations, readsPerIteration, (iteration) => {
    for (let index = 0; index < readsPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.getValue(path);
    }
  });
}

function runExactSetCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const writesPerIteration = Math.min(500, hotPaths.length * 2);
  return runPerfCase(`${scenarioName}: exact setAttribute x${writesPerIteration}`, iterations, writesPerIteration, (iteration) => {
    for (let index = 0; index < writesPerIteration; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.setAttribute(path, iteration * writesPerIteration + index);
    }
  });
}

function runExactMixedCase(store: AssetStore, hotPaths: string[], iterations: number, scenarioName: string): PerfResult {
  const operationsPerIteration = 1000;
  return runPerfCase(`${scenarioName}: exact mixed 80r/20w`, iterations, operationsPerIteration, (iteration) => {
    for (let index = 0; index < 800; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.getValue(path);
    }
    for (let index = 0; index < 200; index += 1) {
      const path = hotPaths[(iteration + index) % hotPaths.length];
      store.setAttribute(path, iteration * 200 + index);
    }
  });
}

function main(): void {
  const quickScenarios: BenchmarkScenario[] = [
    {
      name: "small",
      machineCount: 50,
      attributesPerMachine: 12,
      exactGetIterations: 12,
      exactSetIterations: 8,
      exactMixedIterations: 8
    },
    {
      name: "medium",
      machineCount: 250,
      attributesPerMachine: 20,
      exactGetIterations: 10,
      exactSetIterations: 6,
      exactMixedIterations: 6
    }
  ];
  const fullOnlyScenarios: BenchmarkScenario[] = [
    {
      name: "large",
      machineCount: 1000,
      attributesPerMachine: 40,
      exactGetIterations: 8,
      exactSetIterations: 4,
      exactMixedIterations: 4
    }
  ];

  const scenarios = isFullModeEnabled() ? [...quickScenarios, ...fullOnlyScenarios] : quickScenarios;
  const results = scenarios.flatMap((scenario) => runScenario(scenario));
  console.log("");
  console.log("Asset Exact-Path Performance Benchmark");
  console.log("This benchmark isolates exact-path getValue/setAttribute hot paths before indexing refactors.");
  console.log(`Mode: ${isFullModeEnabled() ? "full" : "quick"}`);
  console.log("");
  printPerfResults(results);
}

main();
