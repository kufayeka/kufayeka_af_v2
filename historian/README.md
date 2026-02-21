# File-based TimeSeries Historian (MVP)

MVP historian bergaya industrial dengan:
- UDP ingest throughput tinggi (batch binary).
- Append-only segmented file archive (`.seg`).
- Block index (`.idx`) per flush block untuk pruning query time-range.
- Last-value side index (`data/meta/last-values.log`) untuk `GET /hist/last` cepat ala `LATEST ON`.
- Query HTTP via `worker_threads` pool agar ingest path tetap independen.

Timestamp disimpan sebagai signed int64 epoch **microseconds** (`timestampUnit: "us"` default). Bisa diubah ke `"ns"` di config.

## Project tree

```text
historian/
  historian.config.json
  package.json
  tsconfig.json
  README.md
  data/
    raw/YYYY-MM-DD/HH/shard-XX.seg
    index/YYYY-MM-DD/HH/shard-XX.idx
    meta/config.json
    meta/last-values.log
  src/
    main.ts
    config/
      defaults.ts
      loader.ts
      types.ts
    types/
      valueTypes.ts
    ingest/
      udpServer.ts
    storage/
      codec.ts
      layout.ts
      repair.ts
      retention.ts
      writer.ts
    query/
      engine.ts
      types.ts
    workers/
      queryWorker.ts
      workerPool.ts
    http/
      server.ts
  scripts/
    udp_sender.ts
    query_examples.ts
    benchmark.ts
```

## Binary formats

UDP batch packet:
- `u32 pointCount`
- Repeated points:
- `u32 tagId`
- `i64 tsEpoch`
- `u8 typeCode`
- Fixed numeric value bytes OR for string: `u32 strlen` + UTF-8 bytes

Segment record (`.seg`, append-only):
- `u32 tagId`
- `i64 tsEpoch`
- `u8 typeCode`
- `u32 valueLen` (`0` for fixed numeric)
- `value bytes`

Block index entry (`.idx`, append per flush block):
- `i64 minTs`
- `i64 maxTs`
- `u64 byteOffsetStart`
- `u64 byteOffsetEnd`
- `u32 pointCount`
- `u32 minTagId`
- `u32 maxTagId`

## Run

```bash
cd historian
npm install
npm run dev
```

## Send UDP load

```bash
npm run send:udp
```

Custom sender params:
- Mode default otomatis generate data `per detik` untuk `3 hari terakhir` (dari sekarang).
- `npm run send:udp`
- Parameter opsional:
- `npm run send:udp -- <secondsPerPacket> <intervalMs>`
- Contoh cepat: `npm run send:udp -- 600 0`
- Sender default memakai 3 tag tetap agar langsung cocok dengan query examples:
- `tagId=1` -> `int32`
- `tagId=2` -> `float32`
- `tagId=3` -> `string`

## Query examples

```bash
npm run query:examples
```

Manual `curl`:

```bash
# Last value per tag
curl "http://127.0.0.1:8080/hist/last?tagIds=1,2,3&time=iso"

# Raw rows (epoch or ISO input, default order=desc)
curl "http://127.0.0.1:8080/hist/raw?tagIds=1,2,3&from=1740000000000000&to=1740000060000000&limit=1000&order=desc&time=epoch"
curl "http://127.0.0.1:8080/hist/raw?tagIds=1,2,3&from=2026-02-21T18:00:00Z&to=2026-02-21T18:10:00Z&limit=1000&order=desc&time=iso"

# Bucketed aggregation (single agg per request)
curl "http://127.0.0.1:8080/hist/range?tagIds=1,2,3&from=1740000000000000&to=1740000060000000&bucketMs=1000&agg=avg&order=desc&time=iso"
```

## Benchmark quick run

```bash
npm run bench
```

`bench` menjalankan sender UDP + query loop range secara paralel.

## Retention policy

Di `historian.config.json`:
- `retention.enabled`: aktif/nonaktif.
- `retention.maxAgeHours`: usia partisi maksimum.
- `retention.checkIntervalMs`: interval housekeeping.

Retention akan menghapus folder partisi lama di `raw/` dan `index/`.

## Query output format

Semua endpoint query mengembalikan format row pivot:

```json
{
  "rows": [
    { "time": "2026-02-21T18:40:00.000Z", "tag1": 12, "tag2": 12.5, "tag3": "state-1" }
  ],
  "truncated": false
}
```

- `time` bisa `epoch` atau `iso` via query param `time=epoch|iso`.
- Input `from/to` bisa epoch integer atau ISO timestamp.
- `agg` di `/hist/range` hanya satu nilai per request (`min|max|avg|first|last|count`).
- Range query tidak dibatasi `maxRangeMs` (bebas sepanjang data tersedia), tapi `limit` tetap berlaku untuk endpoint raw.

## Worker and Parallel Settings

Di `historian.config.json` bagian `workers`:
- `poolSize`: jumlah worker yang diminta (`0` = auto `cpuCores - 1`).
- `maxPoolSize`: batas maksimum thread worker yang boleh dipakai.
- `jobTimeoutMs`: timeout job worker sebelum fallback local async I/O.
- `offloadMinRangeMs`: query range minimum untuk di-offload ke worker.
- `offloadMinLimit`: limit minimum raw query untuk di-offload ke worker.

Default sekarang hybrid:
- Query kecil -> local async I/O (lebih cepat karena tanpa overhead worker serialization).
- Query besar/berat -> worker threads.

## Crash tolerance

Saat startup, proses repair akan:
- Scan semua `.seg`, parse record berurutan.
- Jika tail record incomplete (partial write), file di-truncate ke offset valid terakhir.
- `.idx` juga di-truncate ke kelipatan ukuran entry.

Ini menjaga reader aman pada crash/power loss di tengah append.
