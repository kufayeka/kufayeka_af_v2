import Runtime from "../../../runtime/Runtime";
import type { RuntimeMessage } from "../../../runtime/core/runtimeTypes";

// Answers a concrete question: when many machines all tick at the same fast
// interval (e.g. every 100ms), how much does Runtime's single-threaded,
// per-node-queued dispatch (setImmediate hops through a trigger -> calc
// chain -> "event open" node) add to the gap between "the real tick" and
// "the event-open handler actually starts running"? This is the queue-wait
// component of event-capture drift that the EventActionHandlerFactory fix
// does NOT address (that fix only removed drift *inside* the handler's own
// resolution work; this measures the remaining, structural queueing cost).
//
// Handlers here are intentionally near-instant (just forward the message) --
// real asset reads/writes are already separately proven to cost ~0.05-0.14ms
// (see assetStoreSubscribed.bench.ts), so keeping these minimal isolates the
// pure dispatch/queueing overhead instead of conflating it with real work.

interface ChainIds {
  triggerId: string;
  eventOpenId: string;
}

function buildMachineChain(runtime: Runtime, machineIndex: number, chainLength: number): ChainIds {
  const prefix = `m${machineIndex}`;
  const calcIds: string[] = [];
  for (let i = 0; i < chainLength; i += 1) {
    const nodeId = `${prefix}.calc${i}`;
    calcIds.push(nodeId);
    runtime.addNode(nodeId, async (msg, send) => {
      send(msg, "default");
    });
  }
  const eventOpenId = `${prefix}.eventOpen`;
  const latencySamples: number[] = [];
  runtime.addNode(eventOpenId, async (msg) => {
    const tickTime = (msg.payload as { tickTime?: number })?.tickTime;
    if (typeof tickTime === "number") {
      latencySamples.push(Date.now() - tickTime);
    }
  });
  (runtime as unknown as { __latencySamplesByEventOpenId?: Map<string, number[]> }).__latencySamplesByEventOpenId ??= new Map();
  (runtime as unknown as { __latencySamplesByEventOpenId: Map<string, number[]> }).__latencySamplesByEventOpenId.set(eventOpenId, latencySamples);

  const triggerId = `${prefix}.trigger`;
  const wireFrom = [triggerId, ...calcIds];
  const wireTo = [...calcIds, eventOpenId];
  for (let i = 0; i < wireFrom.length; i += 1) {
    runtime.wire(wireFrom[i], wireTo[i]);
  }
  return { triggerId, eventOpenId };
}

interface ScenarioResult {
  machineCount: number;
  ticks: number;
  samples: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  droppedMessages: number;
}

async function runScenario(machineCount: number, chainLength: number, tickMs: number, durationMs: number): Promise<ScenarioResult> {
  const runtime = new Runtime({ maxInflightPerNode: 50, maxQueuePerNode: 5000, nodeExecutionTimeoutMs: 0 });
  const chains: ChainIds[] = [];
  for (let m = 0; m < machineCount; m += 1) {
    chains.push(buildMachineChain(runtime, m, chainLength));
  }

  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const tickTime = Date.now();
    for (const chain of chains) {
      runtime.send(chain.triggerId, { payload: { tickTime } } as unknown as RuntimeMessage);
    }
  }, tickMs);

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  clearInterval(timer);
  // let any in-flight/queued messages from the last couple of ticks settle
  await new Promise((resolve) => setTimeout(resolve, Math.max(200, tickMs * 3)));
  await runtime.shutdown();

  const latencySamplesByEventOpenId = (runtime as unknown as { __latencySamplesByEventOpenId?: Map<string, number[]> }).__latencySamplesByEventOpenId;
  const allSamples: number[] = [];
  if (latencySamplesByEventOpenId) {
    for (const samples of latencySamplesByEventOpenId.values()) allSamples.push(...samples);
  }
  allSamples.sort((a, b) => a - b);
  const expectedSamples = machineCount * ticks;
  const sum = allSamples.reduce((a, b) => a + b, 0);
  const p = (ratio: number) => allSamples[Math.min(allSamples.length - 1, Math.floor(allSamples.length * ratio))] ?? 0;

  return {
    machineCount,
    ticks,
    samples: allSamples.length,
    avgLatencyMs: allSamples.length ? sum / allSamples.length : 0,
    p50LatencyMs: p(0.5),
    p95LatencyMs: p(0.95),
    maxLatencyMs: allSamples[allSamples.length - 1] ?? 0,
    droppedMessages: Math.max(0, expectedSamples - allSamples.length)
  };
}

async function main(): Promise<void> {
  const scales = [10, 50, 200, 500];
  const chainLength = 5; // trigger -> 5 calc nodes -> event-open, matching the ~6-hop shape of flow_main
  const tickMs = 100;
  const durationMs = 5000;

  console.log("");
  console.log("Queue-wait / dispatch contention benchmark");
  console.log(`chainLength=${chainLength} (trigger -> ${chainLength} calc nodes -> eventOpen), tick every ${tickMs}ms, ${durationMs}ms per scale`);
  console.log("Measures REAL end-to-end latency (tick fired -> eventOpen handler runs) through the actual Runtime dispatch queue.");
  console.log("");

  const results: ScenarioResult[] = [];
  for (const machineCount of scales) {
    const result = await runScenario(machineCount, chainLength, tickMs, durationMs);
    results.push(result);
  }

  console.table(
    results.map((r) => ({
      machines: r.machineCount,
      ticks: r.ticks,
      samples: r.samples,
      dropped: r.droppedMessages,
      avgLatencyMs: r.avgLatencyMs.toFixed(3),
      p50LatencyMs: r.p50LatencyMs.toFixed(3),
      p95LatencyMs: r.p95LatencyMs.toFixed(3),
      maxLatencyMs: r.maxLatencyMs.toFixed(3)
    }))
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
