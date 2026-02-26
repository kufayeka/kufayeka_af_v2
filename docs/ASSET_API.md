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

### Read

- `GET /api/historian/raw`
- `GET /api/historian/range`
- `GET /api/historian/last`

Common query params:
- `path` (required)
- `from`, `to`
- `order` (`asc|desc`)
- `time` (`iso|epoch`)
- `limit` (raw)
- `bucketMs`, `agg` (range)

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
