import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type { AssetSection, EventTemplateDefinition } from "../../../runtime/core/runtimeTypes";
import { openEventFromTemplate, closeEventFromTemplate } from "../../../runtime/event/template/EventTemplateLifecycle";
import { SimEventStore } from "../../shared/simEventStore";
import { printPerfResults, type PerfResult } from "../shared/perfReport";

// How fast can a single open()+close() capture cycle actually run, end to
// end, through the real EventTemplateLifecycle code (not a reimplementation)?
// This measures the resolver+in-memory-store cost in isolation — it does NOT
// include real per-node queue latency from the live Runtime (setImmediate
// hops, node backpressure), which is a separate, already-measured cost via
// NodeProfilingMonitor in the live system.

function speedAttr() {
  return {
    enabled: true,
    name: "Speed",
    valueType: "float64" as const,
    default: 0,
    unit: "m/min",
    historianEnabled: false,
    historianTimeSourcePath: "",
    historianTargetId: "default",
    dashboardVisible: true,
    dashboardEditable: true,
    nullable: false,
    inputType: "text",
    options: [],
    optionsScript: "",
    numberMin: null,
    numberMax: null,
    numberAllowNegative: true,
    numberUseThousandSeparator: false,
    numberPrefix: "",
    numberSuffix: "",
    numberAllowDecimal: true,
    numberPrecision: 2
  };
}

function buildSection(machineCount: number): AssetSection {
  const assets = [];
  for (let i = 0; i < machineCount; i += 1) {
    assets.push({ id: `m${i}`, name: `Machine${i}`, parentId: null, templateIds: ["tmpl"], attributes: {} });
  }
  return {
    assets,
    attributeTemplates: [{ id: "tmpl", name: "tmpl", attributes: [speedAttr()] }],
    historians: []
  };
}

function buildTemplate(): EventTemplateDefinition {
  return {
    id: "downtime",
    enabled: true,
    eventPathTemplate: "Plant.{machine}.Downtime",
    closePatternTemplate: "Plant.{machine}.Downtime",
    assetPaths: [{ id: "machine", source: "variable", key: "machine" }],
    capture: { onOpen: true, onClose: true },
    captureFields: [{ key: "speed", source: "asset_path_attribute", assetPathId: "machine", attributeName: "Speed" }]
  };
}

async function runOpenCloseCycleBench(machineCount: number, iterations: number): Promise<PerfResult> {
  const store = createAssetStore(buildSection(machineCount));
  const eventStore = new SimEventStore();
  const templateMap = new Map([["downtime", buildTemplate()]]);
  const samples: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const machine = `Machine${i % machineCount}`;
    store.setAttribute(`${machine}.Speed`, 0);
    const started = process.hrtime.bigint();
    const opened = await openEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      openOptions: { vars: { machine } }
    });
    store.setAttribute(`${machine}.Speed`, 120);
    await closeEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      closeOptions: { id: opened.id, vars: { machine } }
    });
    const ended = process.hrtime.bigint();
    samples.push(Number(ended - started) / 1e6);
  }

  const totalMs = samples.reduce((a, b) => a + b, 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    name: `open()+close() cycle, ${machineCount} machines`,
    iterations,
    operations: iterations,
    totalMs,
    avgMsPerIteration: totalMs / iterations,
    avgMsPerOperation: totalMs / iterations,
    opsPerSecond: iterations / (totalMs / 1000),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p95Ms: p95,
    memoryDeltaMb: 0
  };
}

async function main(): Promise<void> {
  const results: PerfResult[] = [];
  results.push(await runOpenCloseCycleBench(2, 500));
  results.push(await runOpenCloseCycleBench(200, 500));

  console.log("");
  console.log("Event Capture Timing Benchmark");
  console.log("Measures a full openEventFromTemplate()+closeEventFromTemplate() cycle end to end,");
  console.log("through the real event-template resolver code, against an in-memory EventStore.");
  console.log("");
  printPerfResults(results);
}

main();
