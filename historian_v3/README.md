# Historian v3

High-throughput file-based historian (Go) for UDP ingestion and parallel query workloads.

## Features

- UDP ingest with buffered batching.
- Segment/index storage layout for efficient scans.
- Tail repair for `.seg` / `.idx` files.
- Raw, range, and last-value query APIs.
- Delete APIs by tag/time range.

## API Notes

- `/hist/raw` does not use `bucketMs`/`agg`.
- Use `/hist/range` for aggregated bucket queries.

## Configuration

- Active config file: `historian.config.yaml`.
- Numeric/duration values may use integer expressions with `+`, `-`, `*`.

## Runtime Notes

- WAL is replayed during startup before serving normal traffic.
- Tune `maxPoints`, queue limits, and flush intervals based on throughput and latency requirements.
- `enablePerTagSparseIndex` is currently reserved/placeholder.

## Fsync Policy

- `always`: safest durability, highest fsync overhead.
- `interval`: balanced durability/performance.
- `off`: highest performance, lowest durability guarantee.
