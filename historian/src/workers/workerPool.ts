import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { HistorianConfig } from "../config/types";
import { QueryJob, QueryJobResult } from "../query/types";

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerState {
  worker: Worker;
  busy: boolean;
}

export class WorkerPool {
  private readonly workers: WorkerState[] = [];
  private readonly queue: QueryJob[] = [];
  private readonly pending = new Map<number, PendingJob>();
  private nextJobId = 1;
  private activeWorkerCount = 0;

  constructor(private readonly config: HistorianConfig) {}

  async start(): Promise<void> {
    const cpuBased = Math.max(1, os.cpus().length - 1);
    const requested = this.config.workers.poolSize > 0 ? this.config.workers.poolSize : cpuBased;
    const maxPool = this.config.workers.maxPoolSize > 0 ? this.config.workers.maxPoolSize : requested;
    const poolSize = Math.max(1, Math.min(requested, maxPool));
    this.activeWorkerCount = poolSize;
    const workerJs = path.resolve(__dirname, "queryWorker.js");
    const workerTs = path.resolve(__dirname, "queryWorker.ts");
    const workerFile = existsSync(workerJs) ? workerJs : workerTs;
    const execArgv = workerFile.endsWith(".ts") ? ["--import", "tsx"] : undefined;
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerFile, { workerData: { config: this.config }, execArgv });
      const state: WorkerState = { worker, busy: false };
      worker.on("message", (msg: QueryJobResult) => this.onMessage(state, msg));
      worker.on("error", (err) => this.onError(state, err));
      worker.on("exit", (code) => {
        if (code !== 0) this.onError(state, new Error(`Worker exited with code ${code}`));
      });
      this.workers.push(state);
    }
  }

  getSize(): number {
    return this.activeWorkerCount;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.worker.terminate()));
    this.workers.length = 0;
    for (const [_, p] of this.pending) {
      p.reject(new Error("worker pool closed"));
    }
    this.pending.clear();
  }

  run(kind: QueryJob["kind"], payload: QueryJob["payload"]): Promise<unknown> {
    const id = this.nextJobId++;
    const job: QueryJob = { id, kind, payload };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.queue.push(job);
      this.dispatch();
    });
  }

  private dispatch(): void {
    for (const w of this.workers) {
      if (w.busy) continue;
      const job = this.queue.shift();
      if (!job) return;
      w.busy = true;
      w.worker.postMessage(job);
    }
  }

  private onMessage(state: WorkerState, msg: QueryJobResult): void {
    state.busy = false;
    const p = this.pending.get(msg.id);
    if (p) {
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? "worker error"));
    }
    this.dispatch();
  }

  private onError(state: WorkerState, err: unknown): void {
    state.busy = false;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(err);
    }
    this.dispatch();
  }
}
