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
- `getEarliestTs(pattern, from, to, status, contextFilters, options?)`
- `getLatestTs(pattern, from, to, status, contextFilters, options?)`
- `getRange(pattern, from, to, status, contextFilters, options?)`
- `openTemplate(templateId, options?)`
- `closeTemplate(templateId, options?)`
- `openTemplateFromAction(options?)`
- `closeTemplateFromAction(options?)`

Example:

```js
const range = await eventSys.getRange(
  "Jasuindo.OffsetPrinter.Taiyo1/Job/WO-2026-0011/*",
  "*",
  "*",
  "*",
  {},
  { limit: 5000 }
);

helpers.log("range", range.start_ts, range.end_ts, range.count);
```

Notes:
- `start_ts` = earliest `start_ts` from matched rows.
- `end_ts` = latest `end_ts` from matched rows.
- If latest matched `end_ts` is empty, runtime falls back to `helpers.now()`.

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

## Event Templates

Event templates are reusable event configuration objects for the event engine.

They do not replace scripts.

- Scripts still decide when to emit open or close.
- Event templates define how an event should be built, timestamped, enriched, coordinated, and auto-captured.

Think of them as the event equivalent of script templates:

- script template = reusable logic
- event template = reusable event model

### Mental model

One event template answers these questions:

1. What should the event path look like?
2. What wildcard pattern should be used to close this event?
3. Which inputs are required from the event action?
4. What timestamp should be used for open and close?
5. What extra context should be stored?
6. What values should be captured on open and close?
7. Can this event run in parallel or must it be unique?
8. Should opening this event close other events first?
9. Does this event require a parent to already be open?
10. Should closing this event automatically close its children?

### High-level structure

An event template now supports these main sections:

- `bindings`
- `eventPathBuilder`
- `closePatternBuilder`
- `uniquePatternBuilder`
- `requiredParentBuilder`
- `closeOnOpenPatternBuilders`
- `closeChildrenOnClosePatternBuilders`
- `timeSource`
- `contextFields`
- `captureFields`
- `capture.onOpen`
- `capture.onClose`
- `severity`
- `concurrencyMode`

### Why bindings exist

Bindings are the registry of inputs required by the template.

Every other part of the template reuses those same bindings:

- path builders
- time source
- context fields
- captured values
- event action required bindings

This avoids hidden placeholders and makes the editor predictable.

Supported binding types:

- `msg_path`
- `asset`
- `attribute`
- `static_string`
- `static_number`
- `static_boolean`
- `static_array`
- `static_object`

Typical uses:

- `msg_path`: work order, activity name, transition state, operator id from message
- `asset`: machine asset, line asset, parent asset
- `attribute`: operator attribute, material code attribute, machine mode attribute
- `static_*`: source system labels, fixed mode names, fixed thresholds

### Field-by-field guide

#### `Template ID`

What it is:

- unique id of the event template

What it is used for:

- referenced by event actions
- stored in event metadata for auto close and auto capture

Use case:

- `job_activity`
- `job_lifecycle`
- `machine_alarm`

#### `Template Enabled`

What it is:

- on/off switch for the template

What it is used for:

- prevents event actions from using a template that should be temporarily disabled

Use case:

- disable an unfinished template in development without deleting it

#### `Default Severity`

What it is:

- default severity for events opened by this template

What it is used for:

- fallback severity when event action or script does not override it

Use case:

- `high` for alarms
- `other` or `info` for lifecycle/activity

#### `Bindings`

What it is:

- table of required inputs for the template

What it is used for:

- drives every builder and every event action that inherits this template

Use case:

- `assetPath`
- `workOrder`
- `activity`
- `operator`
- `timestamp`

Notes:

- if a binding type is defined in the template, the event action cannot change that type
- event action only fills the value
- for binding type `asset`, the UI filters the asset list by selected asset template

#### `Open Event Path Builder`

What it is:

- ordered segments that build the final `event_path` string used during open

What it is used for:

- create exact event path with hierarchy

Use case:

- `assetPath / Job / workOrder / Activity / activity`

Design rule:

- keep open path exact
- do not put broad wildcard behavior here

#### `Close Event Pattern Builder`

What it is:

- ordered segments that build the wildcard pattern used when this template closes events by pattern

What it is used for:

- supports exact close or wildcard close

Use case:

- exact close: `assetPath / Job / workOrder / Activity / activity`
- wildcard close: `assetPath / Job / workOrder / Activity / *`

#### `Concurrency Mode`

What it is:

- policy that controls whether multiple open events of the same logical group are allowed

Options:

- `Parallel Allowed`
- `Unique By Exact Event Path`
- `Unique By Pattern / Group`

What each mode means:

- `Parallel Allowed`
  - every new open can create a new row
  - use this when multiple simultaneous events are valid
- `Unique By Exact Event Path`
  - only one open row with the same exact `event_path`
  - repeated trigger returns existing open event instead of creating a new one
- `Unique By Pattern / Group`
  - only one open row in the pattern/group defined by `Unique Pattern Builder`
  - useful when different exact paths still belong to one mutually-exclusive group

Use case:

- lifecycle per work order: `Unique By Pattern / Group`
- alarm by exact alarm path: `Unique By Exact Event Path`
- parallel machine subactivities: `Parallel Allowed`

#### `Unique Pattern Builder`

What it is:

- builder for the pattern used when `Concurrency Mode = Unique By Pattern / Group`

What it is used for:

- group multiple exact event paths into one uniqueness domain

Use case:

- `assetPath / Job / workOrder / Lifecycle / *`

This means:

- only one lifecycle state may remain open for one machine and one work order at a time

#### `Time Source`

What it is:

- configuration for `open` time and `close` time

Options:

- `now`
- `variable`
- `asset_path_attribute`

What it is used for:

- determines actual timestamp stored in `start_ts` and `end_ts`

Use case:

- `now`: runtime clock is enough
- `variable`: timestamp already supplied from AF or API message
- `asset_path_attribute`: timestamp lives in an asset attribute

Design advice:

- use `variable` when upstream source already has authoritative transition time
- use `now` when event timestamp is runtime-generated

#### `Context Fields`

What it is:

- structured data stored in `context`

Allowed sources:

- `variable`
- `static`
- `asset_path_attribute`
- `captured_value`

What it is used for:

- store business identifiers and human-readable context

Use case:

- work order number
- operator
- activity type
- source system
- a captured value reused as context

Design advice:

- keep context focused on business meaning
- do not dump internal metadata here

#### `Captured Values`

What it is:

- structured values that runtime computes on open and close and stores into `captured_data_on_open` / `captured_data_on_close`

Allowed sources:

- `variable`
- `static`
- `asset_path_attribute`

What it is used for:

- snapshot process values tied to the event lifecycle

Use case:

- paper total consumed at open and close
- active operator at transition
- current job speed
- material barcode

Design advice:

- use meaningful keys like `paperTotalStart`, `paperTotalEnd`, `operator`, `materialCode`
- use capture for values that may change over time and must be frozen

#### `Capture On Open`

What it is:

- toggle to populate `captured_data_on_open`

Use case:

- snapshot initial condition when event starts

Example:

- total material consumed when activity started
- job state at start

#### `Capture On Close`

What it is:

- toggle to populate `captured_data_on_close`

Use case:

- snapshot final condition when event ends

Important:

- this also works when close comes from API or plain `eventSys.close(...)`
- runtime uses `event_metadata` in the database row to resolve the template and capture values automatically

#### `Close Other Events On Open`

What it is:

- list of pattern builders
- each row defines a pattern of open events that must be closed before this event opens

What it is used for:

- coordination between mutually-related states

Use case:

- when `B` opens, close all `A`
- when `C` opens, close all `A` and `B`

Example patterns:

- `assetPath / Job / workOrder / Activity / Setup / *`
- `assetPath / Job / workOrder / Activity / Idle / *`

Design advice:

- use this for transition rules between sibling states
- keep pattern scope as narrow as possible

#### `Required Parent Builder`

What it is:

- pattern builder for the parent event that must already be open before this event may open

What it is used for:

- enforce hierarchical event model

Use case:

- activity may only open if lifecycle for same work order is already open

Example:

- `assetPath / Job / workOrder / Lifecycle / *`

Behavior:

- if no matching parent is open, child open is rejected
- if child timestamp is before parent `start_ts`, child open is rejected

#### `Close Child Events On Close`

What it is:

- list of pattern builders
- each row defines children that must be closed when this event closes

What it is used for:

- cascade close from parent to child

Use case:

- closing job lifecycle should close all activities under same work order

Example:

- `assetPath / Job / workOrder / Activity / *`

Behavior:

- child close uses the same final close timestamp as parent
- child close still runs auto capture on close

### Example designs

#### Example 1: Job lifecycle parent

Recommended setup:

- `eventPathBuilder`: `assetPath / Job / workOrder / Lifecycle / state`
- `closePatternBuilder`: `assetPath / Job / workOrder / Lifecycle / *`
- `concurrencyMode`: `Unique By Pattern / Group`
- `uniquePatternBuilder`: `assetPath / Job / workOrder / Lifecycle / *`
- `closeChildrenOnClosePatterns`:
  - `assetPath / Job / workOrder / Activity / *`

Why:

- only one lifecycle state should be active for the same job
- when lifecycle ends, all activities under that job should also end

#### Example 2: Job activity child

Recommended setup:

- `eventPathBuilder`: `assetPath / Job / workOrder / Activity / activity`
- `closePatternBuilder`: exact path or targeted wildcard
- `concurrencyMode`: `Parallel Allowed`
- `requiredParentBuilder`: `assetPath / Job / workOrder / Lifecycle / *`

Why:

- activities should only exist inside lifecycle window
- different activities may be allowed in parallel if business logic permits

#### Example 3: Transition rule between sibling groups

Requirement:

- `A` can be parallel
- `B` must be unique
- opening `B` must close all `A`
- `C` can be parallel, but opening `C` closes both `A` and `B`

Recommended modeling:

- Template A:
  - `concurrencyMode = Parallel Allowed`
- Template B:
  - `concurrencyMode = Unique By Pattern / Group`
  - `closeOnOpenPatternBuilders` includes `A`
- Template C:
  - `concurrencyMode = Parallel Allowed`
  - `closeOnOpenPatternBuilders` includes `A` and `B`

### Storage model

Business data is stored cleanly:

- `context`: user-facing event context
- `captured_data_on_open`: snapshot data at open
- `captured_data_on_close`: snapshot data at close

Internal event engine metadata is stored separately:

- `event_metadata`

Why this matters:

- auto close from API still works after restart
- auto capture on close can still resolve template, bindings, asset paths, parent relation, and policy
- user-facing context and capture data remain clean

### Script examples

Open using the action's configured event template:

```js
await eventSys.openTemplateFromAction({
  vars: {
    assetPath: AssetPath,
    workOrder: WorkOrderAttribute?.value,
    activity: JobActivityAttribute?.value,
    operator: OperatorAttribute?.value,
    timestamp: Timestamp?.value
  },
  notes: "activity started"
});
```

Close using the action's configured event template:

```js
await eventSys.closeTemplateFromAction({
  vars: {
    assetPath: AssetPath,
    workOrder: WorkOrderAttribute?.value,
    activity: JobActivityAttribute?.value,
    operator: OperatorAttribute?.value,
    timestamp: Timestamp?.value
  },
  notes: "activity ended"
});
```

Close sibling events by wildcard:

```js
await eventSys.closeTemplateFromAction({
  vars: {
    assetPath: AssetPath,
    workOrder: WorkOrderAttribute?.value,
    activity: "Setup/*"
  },
  notes: "auto close by transition"
});
```

Open by explicit template id:

```js
await eventSys.openTemplate("job_activity", {
  vars: {
    assetPath: AssetPath,
    workOrder: WorkOrderAttribute?.value,
    activity: "Production/Run",
    operator: OperatorAttribute?.value,
    timestamp: Timestamp?.value
  }
});
```

### API usage

Open from external client:

```json
{
  "template_id": "job_activity",
  "vars": {
    "assetPath": "Jasuindo.OffsetPrinter.Taiyo1",
    "workOrder": "WO-2026-0003",
    "activity": "Idle/Ngopi",
    "operator": "Budi"
  },
  "notes": "opened from external API"
}
```

Close from external client with automatic close snapshot:

```json
{
  "template_id": "job_activity",
  "vars": {
    "assetPath": "Jasuindo.OffsetPrinter.Taiyo1",
    "workOrder": "WO-2026-0003",
    "activity": "Idle/*"
  },
  "capture_auto": true,
  "notes": "closed from external API"
}
```

`capture_auto: true` keeps `captured_data_on_close` populated even when the close request comes from outside AF/runtime scripts, as long as the event row was opened from a template or the request itself uses a template.

### Operational notes

- `eventSys.close(...)`, API `/api/events/close`, and API `/api/events/close-id` automatically perform close capture for templated events.
- `watcher_event_falling` listens to event lifecycle in memory and does not poll the database.
- wildcard pattern matching for event watcher is segment-aware by `/`.
- event coordination and parent-child rules run in the runtime before/after event open-close, not in database polling jobs.

## Best Practices

- Use `await` on async APIs (`asset.set`, `eventSys.*`, `db.*`, `helpers.http`).
- Prefer parameterized SQL with `db.query`.
- Keep scripts idempotent where possible.
- Add explicit guard clauses before writes.
- Add timeout and error handling for HTTP.
- Avoid unbounded loops and heavy synchronous work.
