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

### Open event

- `POST /api/events/open`
- Required: `event_path` (or `path`)

### Close by pattern

- `POST /api/events/close`
- Uses `pattern` (or `event_path`)

### Close by id

- `POST /api/events/close-id`
- Required: `id`

### Acknowledge by id

- `POST /api/events/ack-id`
- Required: `id`

### Delete by id

- `DELETE /api/events/by-id?id=<id>`

### Delete by filter

- `DELETE /api/events?pattern=...&status=...&from=...&to=...&severity=...`

## Historian Service

Historian endpoints in this runtime are path-based wrappers over historian tag IDs.
Client sends attribute path(s), runtime resolves tag IDs and historian target, then proxies to historian service.

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
- Runtime deduplicates by `(assetId, attributeName)`.
- One request must map to one historian target.
  - mixed target mapping returns `400`.

### Time model

- `from` and `to` accept ISO timestamp or epoch string.
- `raw`, `range`, and `first` are window-based.
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
- `limit` optional

Response:
- `rows` pivoted by timestamp
- `truncated=true` if upstream limit cuts rows

#### Range (`GET /api/historian/range`)

Use for bucketed aggregates.

Parameters:
- `path` required
- `from`, `to` window
- `order=asc|desc` optional
- `time=iso|epoch` optional
- `bucketMs` optional
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
- internally mapped to raw query with forced `order=asc` and `limit=1`

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

### Common errors

- `400` missing path
- `404` no matching attribute path
- `400` one request resolves to multiple historian targets
- `502` historian upstream error/unavailable

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
