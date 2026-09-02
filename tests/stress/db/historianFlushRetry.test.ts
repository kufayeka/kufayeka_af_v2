import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBackoffMs, DbConnectionManager, type InjectablePool } from "../../../runtime/db/dbConnectionManager";
import { getDefaultDbConfig, type DbRuntimeConfig } from "../../../runtime/db/dbConfig";

interface FakePoolCall {
  sql: string;
  params: unknown[];
}

interface FakePoolOptions {
  failTimes?: number;
}

function createFakePool(options: FakePoolOptions = {}): InjectablePool & { calls: FakePoolCall[] } {
  let remainingFailures = options.failTimes ?? 0;
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("simulated transient db failure");
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

function createTestConfig(overrides: {
  batchSize?: number;
  maxQueue?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
} = {}): DbRuntimeConfig {
  const cfg = getDefaultDbConfig();
  cfg.enabled = true;
  cfg.queue.historian.enabled = true;
  cfg.queue.historian.batchSize = overrides.batchSize ?? 10;
  cfg.queue.historian.maxQueue = overrides.maxQueue ?? 1000;
  // Keep the periodic timer from firing during the test; we drive flushes manually.
  cfg.queue.historian.flushIntervalMs = 60_000;
  cfg.queue.historian.retry.baseDelayMs = overrides.baseDelayMs ?? 5;
  cfg.queue.historian.retry.maxDelayMs = overrides.maxDelayMs ?? 20;
  return cfg;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("historian flush retry/backoff", () => {
  it("computeBackoffMs stays within [base, max] envelope (plus jitter) and grows with attempts", () => {
    const first = computeBackoffMs(1, 100, 1000);
    assert.ok(first >= 80 && first <= 120, `expected ~100 +-20%, got ${first}`);

    const capped = computeBackoffMs(10, 100, 1000);
    assert.ok(capped >= 800 && capped <= 1200, `expected capped ~1000 +-20%, got ${capped}`);

    assert.ok(computeBackoffMs(0, 100, 1000) >= 0);
  });

  it("requeues a failed batch instead of dropping it, and eventually flushes once the DB recovers", async () => {
    const cfg = createTestConfig();
    const pool = createFakePool({ failTimes: 2 });
    const manager = new DbConnectionManager(cfg, { pool });
    await manager.init();

    manager.enqueueHistorian({ ts: new Date(), attributePath: "Plant.Line1.Speed", value: 42 });

    await manager.flushNow();
    let metrics = manager.getMetrics() as any;
    assert.equal(metrics.queue.historian, 1, "row must still be queued after a failed attempt");
    assert.equal(metrics.historianFlushRetriesTotal, 1);
    assert.equal(metrics.flushErrorsTotal, 1);
    assert.equal(metrics.historianConsecutiveFailures, 1);

    await wait(30); // clear backoff window (maxDelayMs=20)
    await manager.flushNow();
    metrics = manager.getMetrics() as any;
    assert.equal(metrics.queue.historian, 1, "row must still be queued after a second failed attempt");
    assert.equal(metrics.historianFlushRetriesTotal, 2);
    assert.equal(metrics.historianConsecutiveFailures, 2);

    await wait(30); // clear the (larger) backoff window from the second failure
    await manager.flushNow();
    metrics = manager.getMetrics() as any;
    assert.equal(metrics.queue.historian, 0, "row must be flushed once the DB call finally succeeds");
    assert.equal(metrics.historianInsertedRowsTotal, 1);
    assert.equal(metrics.historianConsecutiveFailures, 0, "success must reset the failure streak");
    assert.equal(pool.calls.length, 3, "expected exactly 3 insert attempts: 2 failures + 1 success");
  });

  it("still enforces maxQueue (dropping the oldest rows) after a failed batch is requeued", async () => {
    const cfg = createTestConfig({ maxQueue: 2 });
    const pool = createFakePool({ failTimes: Number.POSITIVE_INFINITY });
    const manager = new DbConnectionManager(cfg, { pool });
    await manager.init();

    manager.enqueueHistorian({ ts: new Date(), attributePath: "Plant.Line1.A", value: 1 });
    await manager.flushNow(); // fails, row is requeued (queue length 1, under maxQueue)

    manager.enqueueHistorian({ ts: new Date(), attributePath: "Plant.Line1.B", value: 2 });
    manager.enqueueHistorian({ ts: new Date(), attributePath: "Plant.Line1.C", value: 3 }); // pushes queue to 3, over maxQueue=2

    const metrics = manager.getMetrics() as any;
    assert.equal(metrics.queue.historian, 2, "queue must be trimmed back down to maxQueue");
    assert.equal(metrics.historianDroppedRowsTotal, 1, "the oldest (requeued) row must be the one dropped");
  });
});
