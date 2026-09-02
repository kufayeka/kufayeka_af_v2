import path from "node:path";

// Fase 0 gate: murni mengukur biaya crossing panggilan JS<->Rust (napi-rs)
// dibanding operasi setara di JS murni (Map). Native module di sini
// SENGAJA dibuat bodoh (cuma HashMap, tanpa logic asset domain apapun) --
// tujuannya cuma satu: apakah overhead crossing per-panggilan itu masih
// bisa diterima, sebelum kita investasikan waktu port AssetStoreIndex
// sungguhan ke Rust (Fase 1).

interface FfiBenchStoreCtor {
  new (): {
    set(key: string, value: unknown): void;
    get(key: string): unknown;
    len(): number;
  };
}

function loadNativeStore(): FfiBenchStoreCtor {
  const modulePath = path.resolve(process.cwd(), "native", "asset-store", "index.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modulePath) as { FfiBenchStore: FfiBenchStoreCtor };
  return mod.FfiBenchStore;
}

interface Stats {
  label: string;
  iterations: number;
  avgNs: number;
  p50Ns: number;
  p95Ns: number;
  p99Ns: number;
  maxNs: number;
}

function summarize(label: string, samplesNs: number[]): Stats {
  const sorted = [...samplesNs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pick = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return {
    label,
    iterations: sorted.length,
    avgNs: sum / sorted.length,
    p50Ns: pick(0.5),
    p95Ns: pick(0.95),
    p99Ns: pick(0.99),
    maxNs: sorted[sorted.length - 1]
  };
}

function benchSet(iterations: number, warmup: number, run: (i: number) => void): number[] {
  for (let i = 0; i < warmup; i += 1) run(i);
  const samples: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i += 1) {
    const started = process.hrtime.bigint();
    run(i);
    const ended = process.hrtime.bigint();
    samples[i] = Number(ended - started);
  }
  return samples;
}

function printTable(rows: Stats[]): void {
  console.table(
    rows.map((r) => ({
      label: r.label,
      iterations: r.iterations,
      avgNs: r.avgNs.toFixed(0),
      avgUs: (r.avgNs / 1000).toFixed(3),
      p50Ns: r.p50Ns.toFixed(0),
      p95Ns: r.p95Ns.toFixed(0),
      p99Ns: r.p99Ns.toFixed(0),
      maxNs: r.maxNs.toFixed(0)
    }))
  );
}

function main(): void {
  const FfiBenchStore = loadNativeStore();
  const iterations = 200_000;
  const warmup = 5_000;
  const keys = Array.from({ length: 1000 }, (_, i) => `Plant.Machine${i % 50}.Attr${i % 20}`);

  // --- Baseline: plain JS Map ---
  const jsMap = new Map<string, unknown>();
  let ji = 0;
  const jsSetSamples = benchSet(iterations, warmup, () => {
    const key = keys[ji % keys.length];
    jsMap.set(key, ji);
    ji += 1;
  });
  let jgi = 0;
  const jsGetSamples = benchSet(iterations, warmup, () => {
    const key = keys[jgi % keys.length];
    jsMap.get(key);
    jgi += 1;
  });

  // --- Native: napi-rs FfiBenchStore ---
  const nativeStore = new FfiBenchStore();
  let ni = 0;
  const nativeSetSamples = benchSet(iterations, warmup, () => {
    const key = keys[ni % keys.length];
    nativeStore.set(key, ni);
    ni += 1;
  });
  let ngi = 0;
  const nativeGetSamples = benchSet(iterations, warmup, () => {
    const key = keys[ngi % keys.length];
    nativeStore.get(key);
    ngi += 1;
  });

  console.log("");
  console.log("FFI overhead benchmark: plain JS Map vs napi-rs native module");
  console.log(`iterations=${iterations} (+${warmup} warmup, discarded), 1000 rotating keys`);
  console.log("");

  printTable([
    summarize("JS Map.set", jsSetSamples),
    summarize("Native .set (napi-rs)", nativeSetSamples),
    summarize("JS Map.get", jsGetSamples),
    summarize("Native .get (napi-rs)", nativeGetSamples)
  ]);

  const setOverheadNs = summarize("", nativeSetSamples).avgNs - summarize("", jsSetSamples).avgNs;
  const getOverheadNs = summarize("", nativeGetSamples).avgNs - summarize("", jsGetSamples).avgNs;
  console.log("");
  console.log(`Pure crossing overhead vs plain JS Map -- set: ${(setOverheadNs / 1000).toFixed(3)}us/call, get: ${(getOverheadNs / 1000).toFixed(3)}us/call`);
}

main();
