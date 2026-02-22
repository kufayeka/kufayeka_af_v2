# historian_v3 (Go, 24/7-focused)

File-based industrial historian di Go untuk ingest UDP tinggi + query berat paralel.

## Arsitektur singkat
- Ingest: UDP binary batch -> queue per `(partition-hour, shard)` -> flush append-only ke `.seg`.
- Index: setiap flush block menulis 1 entry `.idx` (min/max ts, offset range, point count, min/max tag).
- Query:
- `/hist/raw` scan block ter-prune by index.
- `/hist/range` bucket + single aggregate.
- `/hist/last` dari last-value side index (`meta/last-values.log`).
- Recovery:
- Tail repair untuk `.seg`/`.idx`.
- WAL replay (`meta/*.wal`) saat startup.
- Retention: hapus partisi lama (opsional).

## Data layout
```text
data/
  raw/YYYY-MM-DD/HH/shard-XX.seg
  index/YYYY-MM-DD/HH/shard-XX.idx
  meta/config.json
  meta/last-values.log
  meta/ingest-active.wal
```

## Run
```bash
cd historian_v3
go run ./cmd/server
```

## Load generator (3 hari, per detik, otomatis)
```bash
go run ./cmd/udp_sender
```
Opsional:
```bash
go run ./cmd/udp_sender -- 600 0
```
- arg1: `secondsPerPacket`
- arg2: `intervalMs`

## Query examples
```bash
go run ./cmd/query_examples
```

## API
- `GET /hist/last?tagIds=1,2,3&time=iso`
- `GET /hist/raw?tagIds=1,2,3&from=...&to=...&order=asc|desc&time=epoch|iso&limit=1000`
- `GET /hist/range?tagIds=1,2,3&from=...&to=...&bucketMs=1000&agg=avg&order=asc|desc&time=epoch|iso`
- `GET /metrics`
- `GET /health`

### Catatan API
- `from/to` menerima epoch integer **atau** ISO (`RFC3339`).
- Output selalu pivot row: `{time, tagX, tagY, ...}`.
- `/hist/raw` tidak menerima `bucketMs/agg` (pakai `/hist/range`).
- `/hist/range` aggregate hanya **satu** per request.

## Metrics
`/metrics` mengembalikan:
- `writer`:
- `acceptedPoints`, `droppedPoints`, `decodeErrors`
- `segmentSyncCount`, `segmentSyncErrors`
- `query`:
- `count`, `errors`, `totalLatencyMs`
- `wal`:
- `appendOk`, `appendErrors`
- `replayBatches`, `replayPoints`
- `rotateCount`
- `syncCount`, `syncErrors`

## Konfigurasi (`historian.config.yaml`)
Catatan:
- File aktif yang dibaca server adalah `historian.config.yaml`.
- YAML mendukung komentar.
- Field numerik/durasi bisa ditulis sebagai ekspresi integer dengan operator `+`, `-`, `*` (contoh: `24 * 60 * 60 * 1000`).
- Konfigurasi cukup 1 file: `historian.config.yaml` (sudah berisi komentar panduan).

### `udp`
- `host`: bind UDP.
- `port`: port ingest UDP.

### `http`
- `host`, `port`: bind HTTP.
- `maxPoints`: hard cap result points raw/range internal.
- `streamThresholdPoints`: reserved threshold (kompatibilitas).

### `storage`
- `dataDir`: root data folder.
- `shardCount`: jumlah shard berdasarkan `tagId % shardCount`.
- `partitionDurationMs`: default 1 jam.
- `timestampUnit`: `us` atau `ns`.

### `flush`
- `flushIntervalMs`: interval flush scheduler.
- `flushBytes`: auto flush bila queue bytes >= nilai ini.
- `maxQueuePoints`: limit queue per key.
- `backpressurePolicy`: `drop_new` atau `drop_oldest`.

### `index`
- `indexBlockOnFlush`: nyalakan block index.
- `enablePerTagSparseIndex`: placeholder (belum dipakai).
- `indexStridePerTag`: placeholder konfigurasi.

### `retention`
- `enabled`: aktif/nonaktif.
- `maxAgeHours`: usia partisi maksimum.
- `checkIntervalMs`: interval housekeeping.

### `query`
- `maxParallel`: maksimum goroutine paralel scan query.
- `scanChunkBytes`: ukuran chunk baca file saat scan range (lebih kecil = RAM lebih stabil, lebih besar = throughput baca bisa naik).
- `fdCacheEnabled`: aktifkan cache file descriptor untuk kurangi open/close berulang.
- `fdCacheMaxOpen`: batas jumlah FD cache.
- `fdCacheIdleMs`: FD idle lebih lama dari ini akan ditutup otomatis.

### `fsync`
- `walPolicy`: `always | interval | off`
- `walIntervalMs`: interval sync WAL saat policy `interval`.
- `segmentPolicy`: `always | interval | off`
- `segmentIntervalMs`: interval sync segment/index saat policy `interval`.

## Fsync policy: untuk apa?
- `always`: durability paling tinggi, throughput turun.
- `interval`: balance durability/performance (recommended 24/7).
- `off`: throughput tertinggi, risiko data hilang saat crash/power-loss meningkat.

Saran baseline industri:
- `walPolicy=interval`, `walIntervalMs=100-300`
- `segmentPolicy=interval`, `segmentIntervalMs=300-1000`

## Durability model
- Ingest masuk WAL dulu (`Append`), lalu ke queue.
- Flush sukses ke segment/index -> WAL rotate + file lama dihapus.
- Saat startup, WAL direplay sebelum service mulai normal.

## Graceful shutdown
- Tangkap `SIGINT/SIGTERM`.
- Stop HTTP.
- Stop UDP loop via context cancel.
- Flush writer.
- Flush last-value async queue.
- Close WAL.
