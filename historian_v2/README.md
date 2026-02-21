# historian_v2 (Rust)

Rust implementation of the same historian MVP features from `historian/`:

- UDP binary ingest (batch points).
- Append-only segmented storage by shard + hour partition.
- Block index per flush for time-range pruning.
- Tail repair on startup for incomplete writes.
- Last-value side index for fast `/hist/last`.
- HTTP query API:
- `GET /hist/last`
- `GET /hist/raw`
- `GET /hist/range`
- Timestamp input accepts epoch integer or ISO (`from`, `to`).
- Output format is pivot rows: `{ time, tagX, tagY, ... }`.
- `/hist/range` supports single aggregate per request.
- Retention policy support.

## Run

```bash
cd historian_v2
cargo run
```

## Send UDP data (3 days, per second, auto)

```bash
cargo run --bin udp_sender
```

Optional:

```bash
cargo run --bin udp_sender -- 600 0
```

- arg1: `secondsPerPacket`
- arg2: `intervalMs`

## Query examples

```bash
cargo run --bin query_examples
```

## HTTP examples

```bash
# Last
curl "http://127.0.0.1:8080/hist/last?tagIds=1,2,3&time=iso"

# Raw
curl "http://127.0.0.1:8080/hist/raw?tagIds=1,2,3&from=2026-02-18T00:00:00Z&to=2026-02-22T00:00:00Z&order=asc&time=iso&limit=1000"

# Range bucket + agg (single agg)
curl "http://127.0.0.1:8080/hist/range?tagIds=1,2,3&from=2026-02-18T00:00:00Z&to=2026-02-22T00:00:00Z&bucketMs=1000&agg=avg&order=asc&time=iso"
```

## Data layout

```text
data/
  raw/YYYY-MM-DD/HH/shard-XX.seg
  index/YYYY-MM-DD/HH/shard-XX.idx
  meta/config.json
  meta/last-values.log
```
