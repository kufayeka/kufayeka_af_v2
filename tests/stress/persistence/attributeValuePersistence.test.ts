import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import Runtime from "../../../runtime/Runtime";
import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import {
  startAttributeValuePersistence,
  type PersistenceDb,
  type PersistenceStatement
} from "../../../runtime/persistence/attributeValuePersistence";
import type { AssetSection } from "../../../runtime/core/runtimeTypes";

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attr-persist-"));
  return path.join(dir, "attribute-values.sqlite");
}

function readAllRows(dbPath: string): Array<{ asset_id: string; attribute_name: string; value_json: string }> {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    return db.prepare("SELECT asset_id, attribute_name, value_json FROM attribute_values").all() as Array<{
      asset_id: string;
      attribute_name: string;
      value_json: string;
    }>;
  } finally {
    db.close();
  }
}

function attr(name: string, valueType: "float64" | "string" = "float64") {
  return {
    enabled: true,
    name,
    valueType,
    default: valueType === "string" ? "" : 0,
    unit: "",
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

function buildSection(): AssetSection {
  return {
    assets: [
      { id: "m1", name: "M1", parentId: null, templateIds: ["tmpl"], attributes: {} },
      { id: "m2", name: "M2", parentId: null, templateIds: ["tmpl"], attributes: {} }
    ],
    attributeTemplates: [{ id: "tmpl", name: "tmpl", attributes: [attr("Speed"), attr("Status", "string")] }],
    historians: []
  };
}

function createRuntimeWithStore() {
  const store = createAssetStore(buildSection());
  const runtime = new Runtime();
  runtime.setProgramComposition({ assetStore: store } as any);
  return { runtime, store };
}

function createFakeDb(
  options: { failTimes?: number } = {}
): PersistenceDb & { runCalls: number; __rows: Map<string, { asset_id: string; attribute_name: string; value_json: string }> } {
  let remainingFailures = options.failTimes ?? 0;
  const rows = new Map<string, { asset_id: string; attribute_name: string; value_json: string }>();
  const fake = {
    runCalls: 0,
    pragma: () => undefined,
    exec: () => undefined,
    prepare: (): PersistenceStatement => ({
      run: (...params: unknown[]) => {
        fake.runCalls += 1;
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error("simulated transient disk failure");
        }
        const [assetId, attributeName, valueJson] = params as [string, string, string, string | null, string];
        rows.set(`${assetId}:${attributeName}`, { asset_id: assetId, attribute_name: attributeName, value_json: valueJson });
        return undefined;
      }
    }),
    transaction: (fn: () => void) => () => fn(),
    close: () => undefined,
    __rows: rows
  };
  return fake;
}

describe("attribute value persistence (delta/AOF-style)", () => {
  it("only upserts rows that actually changed since the last flush", () => {
    const { runtime, store } = createRuntimeWithStore();
    const dbPath = makeTempDbPath();
    const persistence = startAttributeValuePersistence(runtime, { filePath: dbPath, intervalMs: 60_000 });
    try {
      store.setAttribute("M1.Speed", 10);
      store.setAttribute("M2.Status", "running");
      persistence.flushNow();

      const rows = readAllRows(dbPath);
      assert.equal(rows.length, 2);
      const speedRow = rows.find((r) => r.asset_id === "m1" && r.attribute_name === "Speed");
      assert.equal(JSON.parse(speedRow!.value_json), 10);

      // No changes since last flush -> must be a no-op, not a full re-dump.
      persistence.flushNow();
      assert.equal(readAllRows(dbPath).length, 2);

      // Change only one attribute; the unrelated row must be left untouched.
      store.setAttribute("M1.Speed", 42);
      persistence.flushNow();
      const rowsAfterDelta = readAllRows(dbPath);
      assert.equal(rowsAfterDelta.length, 2, "upsert must not duplicate rows");
      const updatedSpeed = rowsAfterDelta.find((r) => r.asset_id === "m1" && r.attribute_name === "Speed");
      assert.equal(JSON.parse(updatedSpeed!.value_json), 42);
      const untouchedStatus = rowsAfterDelta.find((r) => r.asset_id === "m2" && r.attribute_name === "Status");
      assert.equal(JSON.parse(untouchedStatus!.value_json), "running");
    } finally {
      persistence.stop();
    }
  });

  it("keeps a dirty row queued for retry when the flush transaction fails, instead of losing it", () => {
    const { runtime, store } = createRuntimeWithStore();
    const fakeDb = createFakeDb({ failTimes: 1 });
    const persistence = startAttributeValuePersistence(runtime, { filePath: "unused", intervalMs: 60_000 }, { db: fakeDb });

    store.setAttribute("M1.Speed", 7);
    persistence.flushNow(); // fails once; row must be re-queued, not dropped

    persistence.flushNow(); // second attempt succeeds
    persistence.stop();

    const row = fakeDb.__rows.get("m1:Speed");
    assert.ok(row, "the row must eventually be persisted, not silently lost");
    assert.equal(JSON.parse(row!.value_json), 7);
    assert.equal(fakeDb.runCalls, 2, "expected exactly 2 attempts: 1 failure + 1 success");
  });
});
