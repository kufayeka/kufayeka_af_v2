import { parentPort, workerData } from "node:worker_threads";
import { HistorianConfig } from "../config/types";
import { QueryEngine } from "../query/engine";
import { QueryJob, QueryJobResult } from "../query/types";

const config = workerData.config as HistorianConfig;
const engine = new QueryEngine(config);

if (!parentPort) {
  throw new Error("queryWorker must run in worker thread");
}

parentPort.on("message", async (job: QueryJob) => {
  const result: QueryJobResult = { id: job.id, ok: true };
  try {
    switch (job.kind) {
      case "last":
        result.result = await engine.last(job.payload as never);
        break;
      case "raw":
        result.result = await engine.raw(job.payload as never);
        break;
      case "range":
        result.result = await engine.range(job.payload as never);
        break;
      default:
        throw new Error(`unknown job kind ${(job as { kind: string }).kind}`);
    }
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
  }
  parentPort!.postMessage(result);
});
