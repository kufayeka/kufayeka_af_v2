import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import { createRustAssetStore } from "../../../runtime/asset/RustAssetStore";
import { createAssetPerfFixture } from "../../perf/asset/assetStore.fixture";
import type { AttributeQueryMatch, QueryMatch } from "../../../runtime/core/runtimeTypes";

// Phase 2 correctness gate: the pure-TypeScript AssetStoreIndex and the
// native Rust keyspace must behave IDENTICALLY, not just each pass its own
// hand-derived assertions. So this runs the exact same randomized operation
// sequence against both implementations side by side (an oracle pair,
// same spirit as the event-store oracle tests elsewhere in this repo) and
// diffs their observable output after every step.
//
// `ts` fields are excluded from comparisons -- each implementation stamps
// its own wall-clock timestamp independently, so exact match isn't
// meaningful (or guaranteed) there; every other field must match exactly.

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function stripTs(match: AttributeQueryMatch): Omit<AttributeQueryMatch, "ts"> {
  const { ts: _ts, ...rest } = match;
  return rest;
}

function stripTsFromMatches(matches: AttributeQueryMatch[]): Array<Omit<AttributeQueryMatch, "ts">> {
  return matches.map(stripTs);
}

function stripTsFromQueryMatches(matches: QueryMatch[]): unknown[] {
  return matches.map((m) => (m.kind === "attribute" ? stripTs(m) : m));
}

function sortByPath<T extends { path: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.path.localeCompare(b.path));
}

describe("Rust asset store parity with the TypeScript implementation", () => {
  it("produces identical getValue/setAttribute results across 5k randomized operations on mixed string+numeric attributes", () => {
    const fixture = createAssetPerfFixture({ machineCount: 60, attributesPerMachine: 15 });
    const tsStore = createAssetStore(fixture.section);
    const rustStore = createRustAssetStore(fixture.section);
    const rng = createSeededRng(7734221);
    const paths = fixture.hotAttributePaths;

    // Sanity: initial state must already agree before any writes happen.
    for (const path of paths) {
      assert.deepEqual(tsStore.getValue(path), rustStore.getValue(path), `initial mismatch at ${path}`);
    }

    for (let step = 0; step < 5_000; step += 1) {
      const path = paths[Math.floor(rng() * paths.length)];
      if (!path) continue;
      const attrNumberMatch = /\.Attr(\d{3})$/.exec(path);
      const attrNumber = attrNumberMatch ? Number(attrNumberMatch[1]) : 0;
      const isStringAttr = attrNumber % 5 === 1;

      if (rng() < 0.6) {
        const nextValue = isStringAttr ? `v-${step}-${Math.floor(rng() * 1000)}` : Math.floor(rng() * 100_000) - 50_000;
        const tsResult = stripTsFromMatches(tsStore.setAttribute(path, nextValue));
        const rustResult = stripTsFromMatches(rustStore.setAttribute(path, nextValue));
        assert.deepEqual(rustResult, tsResult, `setAttribute(${path}, ${JSON.stringify(nextValue)}) diverged at step ${step}`);
      } else {
        const tsValue = tsStore.getValue(path);
        const rustValue = rustStore.getValue(path);
        assert.deepEqual(rustValue, tsValue, `getValue(${path}) diverged at step ${step}`);
      }
    }

    // Full-state parity check after the randomized run.
    for (const path of paths) {
      assert.deepEqual(rustStore.getValue(path), tsStore.getValue(path), `post-run mismatch at ${path}`);
    }
  });

  it("matches on wildcard query results", () => {
    const fixture = createAssetPerfFixture({ machineCount: 25, attributesPerMachine: 10 });
    const tsStore = createAssetStore(fixture.section);
    const rustStore = createRustAssetStore(fixture.section);

    tsStore.setAttribute(fixture.hotAttributePaths[3]!, 4242);
    rustStore.setAttribute(fixture.hotAttributePaths[3]!, 4242);

    const wildcardPath = "MainSite.Area1.*.*.Attr002";
    const tsMatches = stripTsFromQueryMatches(sortByPath(tsStore.query(wildcardPath) as Array<QueryMatch & { path: string }>));
    const rustMatches = stripTsFromQueryMatches(sortByPath(rustStore.query(wildcardPath) as Array<QueryMatch & { path: string }>));
    assert.deepEqual(rustMatches, tsMatches);
  });

  it("matches on getHierarchy structure (ignoring ts)", () => {
    const fixture = createAssetPerfFixture({ machineCount: 8, attributesPerMachine: 6 });
    const tsStore = createAssetStore(fixture.section);
    const rustStore = createRustAssetStore(fixture.section);

    tsStore.setAttribute(fixture.hotAttributePaths[0]!, 111);
    rustStore.setAttribute(fixture.hotAttributePaths[0]!, 111);

    const stripHierarchyTs = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripHierarchyTs);
      if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === "ts") continue;
          out[k] = stripHierarchyTs(v);
        }
        return out;
      }
      return value;
    };

    const tsHierarchy = stripHierarchyTs(tsStore.getHierarchy());
    const rustHierarchy = stripHierarchyTs(rustStore.getHierarchy());
    assert.deepEqual(rustHierarchy, tsHierarchy);
  });

  it("matches on findAttributesByValue (strict and loose)", () => {
    const fixture = createAssetPerfFixture({ machineCount: 30, attributesPerMachine: 12 });
    const tsStore = createAssetStore(fixture.section);
    const rustStore = createRustAssetStore(fixture.section);

    for (let i = 0; i < 10; i += 1) {
      tsStore.setAttribute(fixture.hotAttributePaths[i]!, 7);
      rustStore.setAttribute(fixture.hotAttributePaths[i]!, 7);
    }

    const tsStrict = tsStore.findAttributesByValue("MainSite.*.*.*.Attr002", 7, { strict: true });
    const rustStrict = rustStore.findAttributesByValue("MainSite.*.*.*.Attr002", 7, { strict: true });
    assert.equal(rustStrict.count, tsStrict.count);
    assert.equal(rustStrict.assetCount, tsStrict.assetCount);

    const tsLoose = tsStore.findAttributesByValue("MainSite.*.*.*.Attr002", "7", { strict: false });
    const rustLoose = rustStore.findAttributesByValue("MainSite.*.*.*.Attr002", "7", { strict: false });
    assert.equal(rustLoose.count, tsLoose.count);
    assert.equal(rustLoose.assetCount, tsLoose.assetCount);
  });
});
