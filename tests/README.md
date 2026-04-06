# Test README

Folder `tests/` dipakai untuk quality-code testing runtime AF, dengan fokus pada:

- correctness
- bug-catching / regression detection
- stress testing
- performance benchmarking

Struktur utama:

- `tests/stress/`
- `tests/perf/`
- `tests/shared/`

## Yang Sudah Ada

### `event`

File:

- [eventStore.stress.test.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/stress/event/eventStore.stress.test.ts)
- [eventStore.fakeRepository.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/stress/event/eventStore.fakeRepository.ts)
- [eventStore.oracle.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/stress/event/eventStore.oracle.ts)
- [eventStore.bench.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/event/eventStore.bench.ts)
- [eventStore.fixture.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/event/eventStore.fixture.ts)

Coverage utama:

- random lifecycle stress 10k operations
- oracle comparison untuk state correctness
- cache warmup concurrency
- warmup failure recovery
- benchmark `open`, `ack`, `closeById`, warmup, query, mixed lifecycle

Catatan:

- suite ini sudah berhasil menemukan bug nyata di `EventStoreService.deleteByPattern()` dan bug itu sudah dipatch

### `action`

File:

- [actionQuality.test.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/stress/action/actionQuality.test.ts)
- [action.bench.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/action/action.bench.ts)

Coverage utama:

- script action execution
- implicit await rewrite
- timeout handling
- event action success/fail routing
- binding validation
- randomized script invocation stress
- benchmark binding resolution, script handler invoke, event action open

### `flow`

File:

- [flowQuality.test.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/stress/flow/flowQuality.test.ts)
- [flow.bench.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/flow/flow.bench.ts)

Coverage utama:

- flow variable resolution
- fallback flow building
- duplicate node id detection
- node registration
- link registration
- watcher trigger behavior
- event trigger behavior
- hot-path helper stress
- benchmark wildcard matching, watcher filtering, trigger message creation

### `asset`

File:

- [assetStore.bench.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/asset/assetStore.bench.ts)
- [assetStore.fixture.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/asset/assetStore.fixture.ts)

Coverage utama:

- asset store performance benchmark
- hot-path `getValue`, `setAttribute`, `setAttributes`, mixed read/write

## Shared Helpers

File:

- [runtimeTestUtils.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/shared/runtimeTestUtils.ts)
- [perfReport.ts](/d:/DEV/kufayeka/node_red_style_event_loop/tests/perf/shared/perfReport.ts)

Dipakai untuk:

- fake runtime context
- fake send capture
- fake flow runtime
- performance result formatting

## Cara Menjalankan

Type safety:

```bash
npm run typecheck
```

Stress tests:

```bash
npm run test:stress:event
npm run test:stress:action
npm run test:stress:flow
```

Performance benchmarks:

```bash
npm run perf:asset
npm run perf:event
npm run perf:action
npm run perf:flow
```

## Cara Baca Hasil

Stress test:

- target utama adalah fail cepat saat ada mismatch logic
- pass berarti invariant utama tetap konsisten
- fail berarti kemungkinan besar ada bug logic, cache invalidation issue, wiring issue, atau contract mismatch

Perf benchmark:

- `avgMsOperation` = rata-rata biaya per operasi
- `opsPerSecond` = throughput kasar
- `p95Ms` = tail latency per iterasi
- `memoryDeltaMb` = sinyal kasar heap growth, bukan angka absolut

## Apakah Ini Sudah Battle-Tested?

Jawaban jujurnya: **belum full battle-tested, tapi sudah cukup kuat untuk internal QC level serius**.

Yang sudah kuat:

- event logic sudah dites dengan oracle + randomized stress
- action dan flow sudah punya bug-catching coverage yang nyata
- perf baseline untuk asset, event, action, flow sudah ada
- suite sekarang cukup bagus untuk nangkep regression sebelum bug masuk lebih jauh

Yang belum cukup untuk disebut full battle-tested:

- belum ada end-to-end composition test yang menyambungkan `asset + flow + action + event` dalam satu runtime nyata
- belum ada long-run soak test, misalnya 100k sampai 1M operation
- belum ada concurrent multi-node runtime load test level produksi
- belum ada benchmark dengan DB/Postgres sungguhan untuk event store
- belum ada restart/recovery durability test lintas proses
- belum ada snapshot baselines yang dibekukan untuk CI trend tracking

## Status Saat Ini

Status praktis saat ini lebih tepat disebut:

- `quality-tested`
- `stress-tested` untuk domain utama tertentu
- `performance-baselined`

Belum tepat disebut:

- `fully battle-tested`
- `production-proven under sustained real-world load`

## Rekomendasi Next Step

Kalau targetmu mau naik ke level battle-tested, prioritas berikutnya:

1. tambah `tests/stress/composition/` untuk end-to-end runtime chain
2. tambah soak test jangka panjang
3. tambah benchmark dengan repository DB sungguhan
4. simpan perf baseline dan threshold untuk CI
5. tambah failure-injection test untuk restart, timeout, partial dependency failure

## Ringkasan Singkat

Suite yang ada sekarang sudah sangat berguna untuk:

- menemukan bug logic lebih cepat
- menjaga regression tidak lolos
- memetakan bottleneck performa utama

Tapi untuk klaim “battle-tested”, sistem ini masih butuh satu lapisan lagi: composition realism, sustained load, dan infra-backed failure testing.
