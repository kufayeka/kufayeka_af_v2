import { performance } from "node:perf_hooks";
import type { PerfResult } from "../shared/perfReport";
import { printPerfResults } from "../shared/perfReport";
import { createEventActionHandler } from "../../../runtime/action/EventActionHandlerFactory";
import { createScriptActionHandler } from "../../../runtime/action/ScriptActionHandlerFactory";
import { buildResolvedBindings, resolveFlowVariableMap } from "../../../runtime/action/ScriptActionSupport";
import { resolveBindings } from "../../../runtime/action/EventActionSupport";
import type { EventTemplateDefinition } from "../../../runtime/core/runtimeTypes";
import { createSendCapture, createTestNodeContext } from "../../shared/runtimeTestUtils";

interface PerfScenario {
  name: string;
  iterations: number;
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
  const scenarios: PerfScenario[] = [
    { name: "small", iterations: 10 },
    { name: "medium", iterations: 30 }
  ];
  const results: PerfResult[] = [];

  for (const scenario of scenarios) {
    const context = createTestNodeContext({
      assetValues: { "Machine.Temp": 7, "Machine.Speed": 12 },
      flowVariables: { workOrder: "WO-100", offset: 5 },
      eventSys: {
        openTemplate: async () => ({
          id: "row-1",
          event_path: "Plant.Machine",
          start_ts: "2026-01-01T00:00:00.000Z",
          end_ts: null,
          status: "open",
          severity: "info",
          context: {},
          is_acknowledge: false,
          acknowledged_ts: null,
          notes_on_open: null,
          notes_on_close: null,
          event_metadata: null,
          captured_data_on_open: null,
          captured_data_on_close: null
        }),
        closeTemplate: async () => ({
          pattern: "*",
          closedCount: 1,
          ts: "2026-01-01T00:00:00.000Z",
          notes_on_close: null,
          rows: []
        })
      }
    });

    results.push(
      await runAsyncPerfCase(`${scenario.name}: buildResolvedBindings x100`, scenario.iterations, 100, async () => {
        for (let index = 0; index < 100; index += 1) {
          await buildResolvedBindings(
            {
              id: "act-bind",
              templateId: "tmpl-bind",
              config: { __flowId: "flow-1" }
            },
            context,
            {
              templateById: new Map([
                [
                  "tmpl-bind",
                  {
                    id: "tmpl-bind",
                    variableBindings: [
                      { name: "temp", source: "attribute", attributePath: "Machine.Temp" },
                      { name: "speed", source: "attribute", attributePath: "Machine.Speed" },
                      { name: "offset", source: "flow_variable", attributePath: "offset" }
                    ]
                  }
                ]
              ]),
              flowById: new Map([["flow-1", { id: "flow-1", variables: [{ name: "offset", source: "static_number", staticValue: 5 }] }]])
            }
          );
        }
      })
    );

    results.push(
      await runAsyncPerfCase(`${scenario.name}: resolveFlowVariableMap x150`, scenario.iterations, 150, async () => {
        for (let index = 0; index < 150; index += 1) {
          await resolveFlowVariableMap(
            "flow-1",
            context,
            { flowById: new Map([["flow-1", { id: "flow-1", variables: [{ name: "offset", source: "static_number", staticValue: 5 }] }]]) }
          );
        }
      })
    );

    results.push(
      await runAsyncPerfCase(`${scenario.name}: script handler invoke x80`, scenario.iterations, 80, async () => {
        const handler = createScriptActionHandler({
          id: "act-script",
          script: `msg.total = Number(msg.delta || 0) + Number(flowVars.offset || 0); send(msg);`,
          config: { __flowId: "flow-1" }
        });
        for (let index = 0; index < 80; index += 1) {
          const capture = createSendCapture();
          await handler({ id: `m-${index}`, ts: "2026-01-01T00:00:00.000Z", delta: index }, capture.send, context);
        }
      })
    );

    const eventTemplate: EventTemplateDefinition = {
      id: "evt-1",
      eventPathTemplate: "Plant/{asset}",
      bindings: [{ name: "asset", source: "static_string", defaultValue: "MachineA" }]
    };
    results.push(
      await runAsyncPerfCase(`${scenario.name}: event binding resolution x100`, scenario.iterations, 100, async () => {
        for (let index = 0; index < 100; index += 1) {
          await resolveBindings(
            eventTemplate,
            { asset: { source: "static_string", staticValue: `Machine-${index}` } },
            context,
            { id: `m-${index}`, ts: "2026-01-01T00:00:00.000Z" }
          );
        }
      })
    );

    results.push(
      await runAsyncPerfCase(`${scenario.name}: event open handler x80`, scenario.iterations, 80, async () => {
        const handler = createEventActionHandler(
          { id: "evt-open", templateId: "evt-1", bindings: { asset: { source: "static_string", staticValue: "MachineA" } } },
          "open",
          { eventTemplateById: new Map([[eventTemplate.id, eventTemplate]]) }
        );
        for (let index = 0; index < 80; index += 1) {
          const capture = createSendCapture();
          await handler({ id: `m-${index}`, ts: "2026-01-01T00:00:00.000Z" }, capture.send, context);
        }
      })
    );
  }

  console.log("");
  console.log("Action Performance Benchmark");
  console.log("This benchmark targets binding resolution, script execution, and event action routing.");
  console.log("");
  printPerfResults(results);
}

void main();
