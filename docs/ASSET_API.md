# Runtime API Frontend Integration Guide

This guide describes how frontend clients should integrate with the runtime API.

## Base URLs

- Runtime base: `http://localhost:4000`
- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /docs-json`
- Compatibility aliases:
  - `GET /api/openapi`
  - `GET /api/openapi.json`

## General Rules

- Error payload format:

```json
{ "error": "message" }
```

- Wildcard matching supports `*` in path segments.
- For `/api/assets/value/{encodedPath}`, always use `encodeURIComponent(path)`.
- Event timestamps accept ISO datetime or epoch values.
- Boolean query parsing accepts `1|true|yes` for true.

## Assets Service

### Get full asset snapshot

- `GET /api/assets/system`
- Alias: `GET /api/assets`

### Replace full asset snapshot

- `PUT /api/assets/system`
- Alias: `PUT /api/assets`
- Full replace, not patch.
- Body must include `assets`, `attributeTemplates`, and `historians`.

### Hierarchy

- `GET /api/assets/hierarchy?populated=true|false`
- `populated` defaults to `true`.

### Query by wildcard path

- `GET /api/assets/query?path=<dot-path>`

### Find asset paths by raw attribute value

- `POST /api/assets/find-asset-paths`

Body:

```json
{
  "scopePath": "Jasuindo.OffsetPrinter.*",
  "logic": "AND",
  "filters": [
    {
      "attributeName": "Machine Operator",
      "operator": "contains_object",
      "value": {
        "value": "90efaa37-9275-41d5-bb90-06352d055f1b"
      }
    }
  ]
}
```

Operators:
- `eq`: raw attribute value must equal request value exactly
- `neq`: raw attribute value must not equal request value exactly
- `contains`: string contains substring, or array contains element
- `contains_object`: request value must be a subset of the raw object value

Notes:
- Comparison target is always raw `asset.attributes[attributeName].value`
- Result is an array of asset matches, because one filter can match multiple assets

Example response:

```json
{
  "scopePath": "Jasuindo.OffsetPrinter.*",
  "logic": "AND",
  "count": 1,
  "matches": [
    {
      "path": "Jasuindo.OffsetPrinter.Taiyo1",
      "assetId": "asset_1771561995737_511",
      "name": "Taiyo1"
    }
  ]
}
```

### Find by value

- `GET /api/assets/find-by-value?path=<path>&value=<json-or-string>&strict=<bool>`
- Alias: `GET /api/assets/find`

### Read attribute value(s)

- `GET /api/assets/value/{encodedPath}`

### Write attribute value(s)

- `PUT /api/assets/value/{encodedPath}`
- Body: `{ "value": <json-value> }`

### Batch write

- `PUT /api/assets/values:batch`

```json
{
  "items": [
    { "path": "Taiyo1.Line1.M1.Speed", "value": 1200 },
    { "path": "Taiyo1.Line1.M2.Speed", "value": 1195 }
  ]
}
```

### Historian tags from path

- `GET /api/assets/historian-tags?path=<dot-path>`

## Events Service

### Query events

- `GET /api/events`

Query parameters:
- `pattern` (default `*`): wildcard filter for `event_path`
- `from`, `to`: ISO or epoch timestamp bounds
- `status`: `open|closed|*`
- `severity`: `other|info|low|medium|high|critical|*`
- `context`: URL-encoded JSON string filter
- `limit`: page size (runtime clamp: 1..5000)
- `offset`: 0-based offset
- `sortBy`: `id|event_path|start_ts|end_ts|status|severity|is_acknowledge|acknowledged_ts`
- `sortDir`: `asc|desc`

`context` examples:

```json
{"site":"A","line":"L1"}
```

```json
{
  "op": "OR",
  "conditions": [
    { "path": "site", "operator": "eq", "value": "A" },
    { "path": "shift", "operator": "in", "value": [1, 2] }
  ]
}
```

Supported operators: `eq`, `neq`, `in`, `not_in`, `exists`, `not_exists`.

Event storage (`af_event`):
- `context` uses `JSONB`
- `captured_data_on_open` uses `JSONB`
- `captured_data_on_close` uses `JSONB`

### Get event range

- `GET /api/events/range`

Query parameters:
- `pattern` (default `*`): wildcard filter for `event_path`
- `from`, `to`: ISO or epoch timestamp bounds
- `status`: `open|closed|*`
- `context`: URL-encoded JSON string filter
- `limit`: max rows scanned (default `5000`)

Response:
- `start_ts`: earliest matched `start_ts`
- `end_ts`: latest matched `end_ts`
- `count`: matched row count

If the latest matched row has empty `end_ts`, runtime returns current server time for `end_ts`.

Example:

```http
GET /api/events/range?pattern=Jasuindo.OffsetPrinter.Taiyo1/Job/WO-2026-0011/*&status=*&limit=5000
```

### Open event

- `POST /api/events/open`
- Required: `event_path` (or `path`)
- Optional:
  - `context` (object, stored as `JSONB`)
  - `captured_data_on_open` (object, stored as `JSONB`)
  - `notes_on_open`, `severity`, `ts`

### Close by pattern

- `POST /api/events/close`
- Uses `pattern` (or `event_path`)
- Optional:
  - `captured_data_on_close` (object, stored as `JSONB`)
  - `notes_on_close`, `ts`

### Close by id

- `POST /api/events/close-id`
- Required: `id`
- Optional:
  - `captured_data_on_close` (object, stored as `JSONB`)
  - `notes_on_close`, `ts`

### Acknowledge by id

- `POST /api/events/ack-id`
- Required: `id`

### Delete by id

- `DELETE /api/events/by-id?id=<id>`

### Delete by filter

- `DELETE /api/events?pattern=...&status=...&from=...&to=...&severity=...`

## Historian Service

Runtime historian now uses TimescaleDB directly (no external historian HTTP query dependency).
Ingest remains UDP-based from runtime bridge.

Storage model:
- database: `af`
- table: `af_historian` (hypertable)
- columns:
  - `ts` (`TIMESTAMPTZ`)
  - `attribute_path` (`TEXT`)
  - `value` (`JSONB`)
- chunk interval: 12 hours

### Supported read endpoints

- `GET /api/historian/raw`
- `GET /api/historian/range`
- `GET /api/historian/last`
- `GET /api/historian/first`

### Query model

- `path` is required for all historian reads.
- `path` supports:
  - single path: `Taiyo1.Line1.M1.Speed`
  - wildcard path: `Taiyo1.*.*.Speed`
  - comma-separated list: `Taiyo1.Line1.M1.Speed,Taiyo1.Line1.M1.Tension`
- Runtime resolves wildcard path to full attribute paths from asset model.
- Result rows are pivoted by timestamp (`time` + one column per attribute path).

### Time model

- `from` and `to` accept ISO timestamp or epoch string.
- `raw`, `range`, and `first` are window-based (`from` and `to` required in practice).
- `last` is snapshot-based.
- `time` controls output format:
  - `iso`
  - `epoch`

### Endpoint details

#### Raw (`GET /api/historian/raw`)

Use for original points.

Parameters:
- `path` required
- `from`, `to` window
- `order=asc|desc` optional
- `time=iso|epoch` optional
- `limit` optional (default 1000)

Response:
- `rows` pivoted by timestamp
- `truncated=true` if rows exceed limit

#### Range (`GET /api/historian/range`)

Use for bucketed aggregates.

Parameters:
- `path` required
- `from`, `to` window
- `order=asc|desc` optional
- `time=iso|epoch` optional
- `bucketMs` optional (if empty, returns raw-like timeline with aggregation context)
- `agg` optional: `min|max|avg|first|last|count|delta|reverseDelta`

Response:
- `rows` bucketed results
- `agg` echoes chosen aggregation
- `delta` means `last - first` per path in selected window
- `reverseDelta` means `first - last` per path in selected window
- for `delta`/`reverseDelta`, `from` and `to` are mandatory

#### Last (`GET /api/historian/last`)

Use for latest value per path.

Parameters:
- `path` required
- `time=iso|epoch` optional

Response:
- latest point set (current snapshot style)

#### First (`GET /api/historian/first`)

Use for earliest value in a window per path.

Parameters:
- `path` required
- `from`, `to` window
- `time=iso|epoch` optional

Behavior:
- earliest point per attribute path inside requested window

### Read examples

First value in event window:

```http
GET /api/historian/first?path=Taiyo1.Line1.M1.Speed&from=2026-02-27T08:00:00Z&to=2026-02-27T08:05:00Z&time=iso
```

Last value now:

```http
GET /api/historian/last?path=Taiyo1.Line1.M1.Speed
```

Raw points:

```http
GET /api/historian/raw?path=Taiyo1.Line1.M1.Speed&from=2026-02-27T08:00:00Z&to=2026-02-27T08:05:00Z&order=asc&limit=500
```

Average by 1-second buckets:

```http
GET /api/historian/range?path=Taiyo1.Line1.M1.Speed&from=2026-02-27T08:00:00Z&to=2026-02-27T08:05:00Z&bucketMs=1000&agg=avg
```

Multiple attributes in one range query:

```http
GET /api/historian/range?path=Taiyo1.Line1.M1.Speed,Taiyo1.Line1.M1.Tension,Taiyo1.Line1.M1.PaperUsage&from=2026-02-27T08:00:00Z&to=2026-02-27T10:00:00Z&bucketMs=60000&agg=avg&order=asc&time=iso
```

Delta per attribute in one window:

```http
GET /api/historian/range?path=Taiyo1.Line1.M1.TotalPaper,Taiyo1.Line1.M1.TotalLength&from=2026-02-27T08:00:00Z&to=2026-02-27T10:00:00Z&agg=delta&time=iso
```

### Response shape

```json
{
  "path": "Taiyo1.Line1.M1.Speed",
  "paths": ["Taiyo1.Line1.M1.Speed"],
  "matches": [
    {
      "path": "Taiyo1.Line1.M1.Speed",
      "assetId": "M1",
      "attributeName": "Speed",
      "tagId": 123456789,
      "historianTargetId": "default",
      "type": "float64",
      "unit": "m/min",
      "latestValue": 1200,
      "latestTs": "2026-02-27T08:04:59Z",
      "historianEnabled": true,
      "historianTimeSourcePath": ""
    }
  ],
  "rows": [
    {
      "time": "2026-02-27T08:00:00Z",
      "Taiyo1.Line1.M1.Speed": 1188.2
    }
  ],
  "truncated": false,
  "agg": "avg",
  "historianTargetId": "default"
}
```

### Direct SQL examples (TimescaleDB)

These examples run directly on database `af`, table `public.af_historian`.

Raw points for multiple attributes in time range:

```sql
SELECT
  ts,
  attribute_path,
  value
FROM public.af_historian
WHERE attribute_path = ANY(ARRAY[
  'Taiyo1.Line1.M1.Speed',
  'Taiyo1.Line1.M1.Tension',
  'Taiyo1.Line1.M1.PaperUsage'
])
  AND ts >= '2026-02-27T08:00:00Z'::timestamptz
  AND ts <= '2026-02-27T10:00:00Z'::timestamptz
ORDER BY ts ASC
LIMIT 5000;
```

Average per 1-minute bucket (numeric JSON value):

```sql
SELECT
  time_bucket('1 minute', ts) AS bucket,
  attribute_path,
  AVG((value #>> '{}')::double precision) AS avg_value
FROM public.af_historian
WHERE attribute_path = ANY(ARRAY[
  'Taiyo1.Line1.M1.Speed',
  'Taiyo1.Line1.M1.Tension'
])
  AND ts >= '2026-02-27T08:00:00Z'::timestamptz
  AND ts <= '2026-02-27T10:00:00Z'::timestamptz
GROUP BY bucket, attribute_path
ORDER BY bucket ASC, attribute_path ASC;
```

First and last value per attribute in a window:

```sql
WITH scoped AS (
  SELECT ts, attribute_path, value
  FROM public.af_historian
  WHERE attribute_path = ANY(ARRAY[
    'Taiyo1.Line1.M1.TotalPaper',
    'Taiyo1.Line1.M1.TotalLength'
  ])
    AND ts >= '2026-02-27T08:00:00Z'::timestamptz
    AND ts <= '2026-02-27T10:00:00Z'::timestamptz
),
firsts AS (
  SELECT DISTINCT ON (attribute_path)
    attribute_path,
    ts AS first_ts,
    value AS first_value
  FROM scoped
  ORDER BY attribute_path, ts ASC
),
lasts AS (
  SELECT DISTINCT ON (attribute_path)
    attribute_path,
    ts AS last_ts,
    value AS last_value
  FROM scoped
  ORDER BY attribute_path, ts DESC
)
SELECT
  f.attribute_path,
  f.first_ts,
  l.last_ts,
  f.first_value,
  l.last_value
FROM firsts f
JOIN lasts l USING (attribute_path)
ORDER BY f.attribute_path;
```

Delta and reverse delta per attribute:

```sql
WITH scoped AS (
  SELECT ts, attribute_path, value
  FROM public.af_historian
  WHERE attribute_path = ANY(ARRAY[
    'Taiyo1.Line1.M1.TotalPaper',
    'Taiyo1.Line1.M1.TotalLength'
  ])
    AND ts >= '2026-02-27T08:00:00Z'::timestamptz
    AND ts <= '2026-02-27T10:00:00Z'::timestamptz
),
firsts AS (
  SELECT DISTINCT ON (attribute_path)
    attribute_path,
    (value #>> '{}')::double precision AS first_num
  FROM scoped
  ORDER BY attribute_path, ts ASC
),
lasts AS (
  SELECT DISTINCT ON (attribute_path)
    attribute_path,
    (value #>> '{}')::double precision AS last_num
  FROM scoped
  ORDER BY attribute_path, ts DESC
)
SELECT
  f.attribute_path,
  (l.last_num - f.first_num) AS delta,
  (f.first_num - l.last_num) AS reverse_delta
FROM firsts f
JOIN lasts l USING (attribute_path)
ORDER BY f.attribute_path;
```

Delete historian data by path and time range:

```sql
DELETE FROM public.af_historian
WHERE attribute_path = ANY(ARRAY[
  'Taiyo1.Line1.M1.Speed',
  'Taiyo1.Line1.M1.Tension'
])
  AND ts >= '2026-02-27T08:00:00Z'::timestamptz
  AND ts <= '2026-02-27T10:00:00Z'::timestamptz;
```

### Common errors

- `400` missing path
- `404` no matching attribute path
- `400` invalid time range (`to < from`)
- `503` historian backend not initialized

### Recommended event-window pattern

1. Query events from `/api/events`.
2. Build window per event:
   - `from = event.start_ts`
   - `to = event.end_ts` (or current time when still open)
3. Query historian:
   - avg speed: `/api/historian/range?...&agg=avg`
   - first value in event: `/api/historian/first?...`
   - last value: `/api/historian/last?path=...`
4. Derive usage:
   - totalizer tags: `usage = last - first`
   - rate tags: integrate bucket values over time

### Target and diagnostics

- `GET /api/historian/targets`
- `GET /api/historian/target-metrics?targetId=default`
- `GET /api/historian/target-logs?targetId=default&kind=&limit=100`

### Delete historian data

- `DELETE /api/historian/delete-attribute?path=<path>&from=<ts>&to=<ts>`
- `DELETE /api/historian/delete-template-attribute?templateId=<id>&attributeName=<name>&from=<ts>&to=<ts>`

## Global Store Service

- `GET /api/global`
- `GET /api/global/{key}`
- `PUT /api/global/{key}` body: `{ "value": <json-value> }`
- `DELETE /api/global/{key}`

## Frontend Do / Don't

Do:
- URL-encode path parameters.
- URL-encode `context` JSON query values.
- Handle `400`, `404`, and `502` gracefully.
- Use pagination for event lists.

Don't:
- Assume partial merge on `PUT /api/assets/system`.
- Run broad delete requests in production without confirmation.

## Script Runtime Docs

- Script action runtime API (global/asset/event/db/cron): `docs/SCRIPT_ACTIONS_MANUAL.md`
- HTTP requests inside action script (fetch/axios/helpers.http): `docs/ACTION_SCRIPT_HTTP.md`
