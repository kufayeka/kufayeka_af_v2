import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventRow, EventStoreChangeMeta } from "../../../runtime/core/runtimeTypes";
import { OpenEventCache } from "../../../runtime/event/store/OpenEventCache";
import { EventStoreService } from "../../../runtime/event/store/EventStoreService";
import { FakeEventStoreRepository } from "./eventStore.fakeRepository";
import { OracleEventStore } from "./eventStore.oracle";

type OperationKind = "open" | "close" | "closeById" | "acknowledgeById" | "deleteById" | "deleteByPattern" | "query" | "getById";

interface Operation {
  kind: OperationKind;
  path?: string;
  pattern?: string;
  id?: string;
  ts?: string;
  context?: Record<string, unknown>;
  notes?: string;
  severity?: string;
  captured?: unknown | null;
  metadata?: Record<string, unknown> | null;
  status?: string;
  from?: string;
  to?: string;
  contextFilters?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

function maybe<T>(rng: () => number, value: T, probability = 0.5): T | undefined {
  return rng() < probability ? value : undefined;
}

function createTs(step: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, step)).toISOString();
}

function normalizeRows(rows: EventRow[]): EventRow[] {
  return [...rows]
    .map((row) => ({
      ...row,
      context: row.context || {},
      event_metadata: row.event_metadata || null,
      captured_data_on_open: row.captured_data_on_open ?? null,
      captured_data_on_close: row.captured_data_on_close ?? null
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildPaths(): string[] {
  const paths: string[] = [];
  for (let line = 1; line <= 6; line += 1) {
    for (let machine = 1; machine <= 8; machine += 1) {
      for (const signal of ["Job", "Alarm", "Lifecycle"]) {
        paths.push(`Plant.Line${line}.Machine${String(machine).padStart(2, "0")}.${signal}`);
      }
    }
  }
  return paths;
}

function buildPatterns(paths: string[]): string[] {
  const patterns = new Set<string>(["*"]);
  for (const path of paths) {
    const parts = path.split(".");
    patterns.add(path);
    patterns.add(`${parts[0]}.*`);
    patterns.add(`${parts[0]}.${parts[1]}.*`);
    patterns.add(`${parts[0]}.${parts[1]}.${parts[2]}.*`);
  }
  return Array.from(patterns);
}

function buildContext(rng: () => number, step: number): Record<string, unknown> {
  return {
    machine: `M${String((step % 20) + 1).padStart(2, "0")}`,
    workOrder: `WO-${1000 + (step % 40)}`,
    category: pick(rng, ["production", "setup", "idle"]),
    shift: pick(rng, ["A", "B", "C"]),
    counters: {
      batch: step % 10,
      zone: `Z${(step % 4) + 1}`
    }
  };
}

function buildOperation(rng: () => number, step: number, knownIds: string[], paths: string[], patterns: string[]): Operation {
  const roll = rng();
  if (roll < 0.35) {
    return {
      kind: "open",
      path: pick(rng, paths),
      ts: createTs(step),
      context: buildContext(rng, step),
      notes: maybe(rng, `opened-${step}`, 0.7),
      severity: pick(rng, ["other", "info", "low", "medium", "high", "critical"]),
      captured: maybe(rng, { source: "sensor", step }, 0.35) ?? null,
      metadata: maybe(rng, { templateId: `tmpl-${step % 5}` }, 0.25) ?? null
    };
  }
  if (roll < 0.5) {
    return { kind: "close", pattern: pick(rng, patterns), ts: createTs(step), notes: maybe(rng, `closed-${step}`, 0.6), captured: maybe(rng, { closedBy: "stress", step }, 0.25) ?? null };
  }
  if (roll < 0.6) {
    return { kind: "closeById", id: knownIds.length > 0 ? pick(rng, knownIds) : `missing-${step}`, ts: createTs(step), notes: maybe(rng, `closed-id-${step}`, 0.7), captured: maybe(rng, { method: "closeById", step }, 0.25) ?? null };
  }
  if (roll < 0.7) {
    return { kind: "acknowledgeById", id: knownIds.length > 0 ? pick(rng, knownIds) : `missing-${step}`, ts: createTs(step) };
  }
  if (roll < 0.8) {
    return { kind: "deleteById", id: knownIds.length > 0 ? pick(rng, knownIds) : `missing-${step}` };
  }
  if (roll < 0.85) {
    return { kind: "deleteByPattern", pattern: pick(rng, patterns), status: pick(rng, ["*", "open", "closed"]), severity: pick(rng, ["*", "other", "info", "medium", "critical"]) };
  }
  if (roll < 0.95) {
    const category = pick(rng, ["production", "setup", "idle"]);
    return {
      kind: "query",
      pattern: pick(rng, patterns),
      from: "*",
      to: "*",
      status: pick(rng, ["*", "open", "closed"]),
      contextFilters: rng() < 0.5 ? { category } : { shift: pick(rng, ["A", "B", "C"]) },
      options: {
        severity: pick(rng, ["*", "other", "info", "medium", "critical"]),
        limit: 50,
        offset: 0,
        sortBy: pick(rng, ["start_ts", "event_path", "severity"]),
        sortDir: pick(rng, ["asc", "desc"])
      }
    };
  }
  return { kind: "getById", id: knownIds.length > 0 ? pick(rng, knownIds) : `missing-${step}` };
}

async function applyOperation(operation: Operation, service: EventStoreService, oracle: OracleEventStore): Promise<void> {
  switch (operation.kind) {
    case "open": {
      const row = await service.open(String(operation.path), operation.ts, operation.context, operation.notes, operation.severity, operation.captured, operation.metadata ?? null);
      oracle.applyOpenedRow(row);
      return;
    }
    case "close": {
      const result = await service.close(operation.pattern, operation.ts, operation.notes, operation.captured);
      const changed = oracle.close(result.pattern, result.ts, result.notes_on_close, result.captured_data_on_close);
      assert.equal(result.closedCount, changed.length);
      return;
    }
    case "closeById": {
      const result = await service.closeById(String(operation.id), operation.ts, operation.notes, operation.captured);
      const changed = oracle.closeById(result.id, result.ts, result.notes_on_close, result.captured_data_on_close);
      assert.equal(result.closedCount, changed.length);
      return;
    }
    case "acknowledgeById": {
      const result = await service.acknowledgeById(String(operation.id), operation.ts);
      const changed = oracle.acknowledgeById(result.id, result.acknowledged_ts);
      assert.equal(result.acknowledgedCount, changed);
      return;
    }
    case "deleteById": {
      const result = await service.deleteById(String(operation.id));
      const changed = oracle.deleteById(result.id);
      assert.equal(result.deletedCount, changed);
      return;
    }
    case "deleteByPattern": {
      const result = await service.deleteByPattern(operation.pattern, operation.status, operation.from, operation.to, operation.severity);
      const changed = oracle.deleteByPattern(result.pattern, result.status, operation.from, operation.to, result.severity);
      assert.equal(result.deletedCount, changed);
      return;
    }
    case "query": {
      const actual = await service.query(operation.pattern, operation.from, operation.to, operation.status, operation.contextFilters, operation.options);
      const expected = oracle.query(operation.pattern, operation.from, operation.to, operation.status, operation.contextFilters, operation.options);
      assert.deepEqual(normalizeRows(actual.rows), normalizeRows(expected.rows));
      assert.equal(actual.total, expected.total);
      return;
    }
    case "getById": {
      const actual = await service.getById(String(operation.id));
      const expected = oracle.getById(String(operation.id));
      assert.deepEqual(actual, expected);
      return;
    }
    default:
      throw new Error(`Unknown operation: ${String((operation as Operation).kind)}`);
  }
}

async function assertServiceMatchesOracle(service: EventStoreService, oracle: OracleEventStore): Promise<void> {
  const actualOpen = await service.query("*", "*", "*", "open", {}, { limit: 5000, sortBy: "id", sortDir: "asc" });
  const expectedOpen = oracle.query("*", "*", "*", "open", {}, { limit: 5000, sortBy: "id", sortDir: "asc" });
  assert.deepEqual(normalizeRows(actualOpen.rows), normalizeRows(expectedOpen.rows));
  assert.equal(actualOpen.total, expectedOpen.total);
  assert.equal(service.getMeta().openEventCache.openCount, oracle.openCount());
  for (const row of actualOpen.rows) {
    assert.equal(row.status, "open");
  }
}

describe("EventStoreService stress QC", () => {
  it("matches oracle across 10k randomized lifecycle operations", async () => {
    const repository = new FakeEventStoreRepository();
    const service = new EventStoreService(repository, new OpenEventCache());
    const oracle = new OracleEventStore();
    const listeners: EventStoreChangeMeta[] = [];
    service.subscribe((meta) => {
      listeners.push(meta);
    });

    const rng = createSeededRng(1337);
    const paths = buildPaths();
    const patterns = buildPatterns(paths);

    for (let step = 0; step < 10_000; step += 1) {
      const knownIds = oracle.allRows().map((row) => row.id);
      const operation = buildOperation(rng, step, knownIds, paths, patterns);
      await applyOperation(operation, service, oracle);
      await assertServiceMatchesOracle(service, oracle);
    }

    assert.ok(listeners.length > 0);
  });

  it("warms the open cache correctly under concurrent first-read pressure", async () => {
    const initialRows: EventRow[] = Array.from({ length: 200 }, (_, index) => ({
      id: `row-${index + 1}`,
      event_path: `Plant.Line1.Machine${String((index % 20) + 1).padStart(2, "0")}.Alarm`,
      start_ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      end_ts: null,
      status: "open",
      severity: "medium",
      context: { machine: `M${index % 20}`, category: "production" },
      is_acknowledge: false,
      acknowledged_ts: null,
      notes_on_open: null,
      notes_on_close: null,
      event_metadata: null,
      captured_data_on_open: null,
      captured_data_on_close: null
    }));

    const repository = new FakeEventStoreRepository({ initialRows, artificialDelayMs: 5 });
    const service = new EventStoreService(repository, new OpenEventCache());
    const results = await Promise.all(Array.from({ length: 20 }, () => service.query("Plant.Line1.*", "*", "*", "open", {}, { limit: 5000 })));

    for (const result of results) {
      assert.equal(result.total, 200);
      assert.equal(result.rows.length, 200);
    }
    assert.equal(service.getMeta().openEventCache.openCount, 200);
    assert.equal(repository.stats.loadOpenRowsCalls, 1);
  });

  it("recovers after warmup failure and succeeds on the next open-query attempt", async () => {
    const initialRows: EventRow[] = [
      {
        id: "row-1",
        event_path: "Plant.Line1.Machine01.Job",
        start_ts: "2026-01-01T00:00:00.000Z",
        end_ts: null,
        status: "open",
        severity: "info",
        context: { workOrder: "WO-1" },
        is_acknowledge: false,
        acknowledged_ts: null,
        notes_on_open: null,
        notes_on_close: null,
        event_metadata: null,
        captured_data_on_open: null,
        captured_data_on_close: null
      }
    ];
    const repository = new FakeEventStoreRepository({ initialRows, failLoadOpenRowsTimes: 1 });
    const service = new EventStoreService(repository, new OpenEventCache());

    await assert.rejects(() => service.query("*", "*", "*", "open"));

    const recovered = await service.query("*", "*", "*", "open", {}, { limit: 5000 });
    assert.equal(recovered.total, 1);
    assert.equal(recovered.rows[0]?.id, "row-1");
    assert.equal(repository.stats.loadOpenRowsCalls, 2);
  });
});
