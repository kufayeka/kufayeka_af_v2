# Script Actions Manual

This manual describes script runtime APIs, SQL access, HTTP clients, and trigger behavior.

## Runtime Inputs

Each script action receives:

- `msg`
- `send`
- `context`
- `helpers`
- resolved template bindings (in scope by binding name)

`msg` always has:

- `msg.id` (UUID)
- `msg.ts` (ISO timestamp)

## Context APIs

### `context.global`

- `get(key, defaultValue?)`
- `set(key, value)`
- `has(key)`
- `delete(key)`

### `context.asset`

- `query(path)`
- `get(path, defaultValue?)`
- `getAll(path)`
- `set(path, value)` async
- `setMany(items)` async
- `findByValue(path, expected, options?)`
- `find(path, expected, options?)`
- `hierarchy(options?)`

Note:

- `asset.set` and `asset.setMany` are serialized in runtime to reduce write race conditions.
- You should still use `await`.

### `context.eventSys`

- `open(path, ts, context, notes, severity?, captured_data_on_open?)`
- `close(pattern, ts, notes, captured_data_on_close?)`
- `get(pattern, from, to, status, contextFilters, options?)`

### `context.db`

- `query(sql, params?)`
- `executeSafe(sql)`
- `testConnection()`

Examples:

```js
const openRows = await db.query(
  "SELECT id, event_path FROM public.af_event WHERE status = $1 LIMIT $2",
  ["open", 50]
);
```

```js
const ping = await db.executeSafe("SELECT NOW() AS ts");
helpers.log("db ts", ping.rows?.[0]?.ts);
```

## Helpers

- `helpers.log(...args)`
- `helpers.sleep(ms)`
- `helpers.fetch(...)`
- `helpers.axios` (axios instance)
- `helpers.http(options)` (axios-powered wrapper)
- `helpers.now()`

HTTP details are documented in:

- `docs/ACTION_SCRIPT_HTTP.md`

## Variable Bindings

Bindings are defined in Script Templates.

Supported sources:

- `asset`
- `attribute`
- `static_string`
- `static_number`
- `static_boolean`
- `static_array`
- `static_object`

Binding values can be:

- single object
- array
- null

Normalize before processing if required.

## Trigger Types

Supported trigger types:

- `interval`
- `cron`
- `watcher_set`
- `watcher_valuechange`
- `watcher_event_falling`

### `interval`

- emits every `intervalMs`
- optional active window:
  - `activeFrom` (`HH:mm`)
  - `activeTo` (`HH:mm`)
  - `timezone` (IANA, e.g. `Asia/Jakarta`)

### `cron`

- powered by real cron library (`cron`)
- uses `cronExpression`
- optional:
  - `timezone`
  - `activeFrom` / `activeTo`

Examples:

- every 5 seconds: `*/5 * * * * *`
- every day 06:00:00: `0 0 6 * * *`
- every 1 minute between 08:00-17:59: `0 */1 8-17 * * *`

### watcher triggers

- `watcher_set`: fires on attribute set operation
- `watcher_valuechange`: fires on value signature change
- `watcher_event_falling`: fires when event transitions `open -> closed` (close/closeById lifecycle), with `event_path` wildcard filter

## Best Practices

- Use `await` on async APIs (`asset.set`, `eventSys.*`, `db.*`, `helpers.http`).
- Prefer parameterized SQL with `db.query`.
- Keep scripts idempotent where possible.
- Add explicit guard clauses before writes.
- Add timeout and error handling for HTTP.
- Avoid unbounded loops and heavy synchronous work.
