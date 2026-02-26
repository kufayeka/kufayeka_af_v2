# Script Actions Manual

This manual explains runtime script actions, context APIs, variable bindings, and safe usage patterns.

## Runtime Context

A script action receives:
- `msg`
- `send`
- `context`
- `helpers`

`msg` guarantees:
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
- `set(path, value)`
- `setMany(items)`
- `findByValue(path, expected, options?)`
- `hierarchy(options?)`

### `context.eventSys`

- `open(path, ts, context, notes, severity?)`
- `close(pattern, ts, notes)`
- `get(pattern, from, to, status, contextFilters, options?)`

## Variable Bindings

Bindings are defined in Script Templates and resolved at runtime.

Common sources:
- `asset`
- `attribute`
- `static_string`
- `static_number`
- `static_boolean`
- `static_array`
- `static_object`

## Value Shape Notes

`asset` and `attribute` bindings may return:
- single object
- array
- null

Use helper patterns to normalize in scripts.

## Persistence Notes

- `assetStorage` is the source of truth for runtime attribute values.
- Compatibility snapshot is available under global key `assetFramework`.

## Best Practices

- Keep scripts deterministic and idempotent when possible.
- Validate input before writes.
- Use explicit error handling with clear messages.
- Avoid unbounded loops and large synchronous operations.
