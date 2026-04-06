import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import { createAssetPerfFixture } from "../../perf/asset/assetStore.fixture";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function selectNumericPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    const match = path.match(/\.Attr(\d{3})$/);
    if (!match) return false;
    const attributeNumber = Number(match[1]);
    return Number.isFinite(attributeNumber) && attributeNumber % 5 !== 1;
  });
}

describe("Asset exact-path quality and stress", () => {
  it("keeps exact getValue and setAttribute consistent across 20k randomized operations", () => {
    const fixture = createAssetPerfFixture({
      machineCount: 300,
      attributesPerMachine: 24
    });
    const store = createAssetStore(fixture.section);
    const rng = createSeededRng(20260406);
    const expected = new Map<string, unknown>();
    const numericPaths = selectNumericPaths(fixture.hotAttributePaths);

    for (const path of numericPaths) {
      expected.set(path, store.getValue(path));
    }

    for (let step = 0; step < 20_000; step += 1) {
      const path = numericPaths[Math.floor(rng() * numericPaths.length)];
      if (!path) continue;
      if (rng() < 0.55) {
        const nextValue = Math.floor(rng() * 100_000);
        store.setAttribute(path, nextValue);
        expected.set(path, nextValue);
      } else {
        const actual = store.getValue(path);
        assert.equal(actual, expected.get(path));
      }
    }

    for (let index = 0; index < 200; index += 1) {
      const path = numericPaths[index % numericPaths.length];
      assert.equal(store.getValue(path), expected.get(path));
    }
  });

  it("emits attribute.set metadata for exact updates without losing revision ordering", () => {
    const fixture = createAssetPerfFixture({
      machineCount: 20,
      attributesPerMachine: 8
    });
    const store = createAssetStore(fixture.section);
    const numericPaths = selectNumericPaths(fixture.hotAttributePaths);
    const observed: Array<{ revision: number; updatedAt: string; paths: string[] }> = [];
    const unsubscribe = store.subscribe((_state, meta) => {
      observed.push({
        revision: meta.revision,
        updatedAt: meta.updatedAt,
        paths: (meta.change.changes || []).map((item) => item.path)
      });
    });

    const pathA = numericPaths[0];
    const pathB = numericPaths[1];
    assert.ok(pathA);
    assert.ok(pathB);

    store.setAttribute(pathA!, 123);
    store.setAttribute(pathB!, 456);

    unsubscribe();

    assert.equal(observed.length, 2);
    assert.ok(observed[0]!.revision < observed[1]!.revision);
    assert.deepEqual(observed[0]!.paths, [pathA!]);
    assert.deepEqual(observed[1]!.paths, [pathB!]);
  });

  it("keeps exact path updates isolated from unrelated attributes", () => {
    const fixture = createAssetPerfFixture({
      machineCount: 40,
      attributesPerMachine: 12
    });
    const store = createAssetStore(fixture.section);
    const numericPaths = selectNumericPaths(fixture.hotAttributePaths);

    const target = numericPaths[10];
    const control = numericPaths[11];
    assert.ok(target);
    assert.ok(control);

    const beforeControl = store.getValue(control!);
    store.setAttribute(target!, 9999);

    assert.equal(store.getValue(target!), 9999);
    assert.equal(store.getValue(control!), beforeControl);
  });
});
