# Action Script HTTP Requests

This document explains all HTTP request options available inside runtime script actions.

## Available Clients in Script

Inside script action, you can use:

- `helpers.fetch(...)` (native Fetch API)
- `helpers.axios` (axios client)
- `helpers.http(options)` (axios-powered convenience wrapper)

All of them are async. Use `await`.

## 1) `helpers.fetch(...)`

Use when you want native Fetch behavior.

```js
const res = await helpers.fetch("https://httpbin.org/get?line=A", {
  method: "GET",
  headers: {
    "x-api-key": "token-1"
  }
});

const data = await res.json();
helpers.log("status", res.status, data);
```

## 2) `helpers.axios`

Use when you want full axios API.

### GET with query params + headers

```js
const res = await helpers.axios.get("https://httpbin.org/get", {
  params: { machine: "Taiyo1", shift: 2 },
  headers: {
    "x-api-key": "token-1"
  },
  timeout: 5000
});

helpers.log("status", res.status, "data", res.data);
```

### POST with JSON body

```js
const res = await helpers.axios.post(
  "https://httpbin.org/post",
  { workOrder: "WO-777", activity: "Production" },
  {
    headers: {
      "content-type": "application/json",
      "x-request-id": msg.id
    }
  }
);
```

### Generic axios request

```js
const res = await helpers.axios.request({
  url: "https://httpbin.org/anything",
  method: "PATCH",
  params: { mode: "quick" },
  headers: { "x-env": "prod" },
  data: { enabled: true },
  timeout: 4000
});
```

## 3) `helpers.http(options)` (recommended for scripts)

Wrapper result shape:

```ts
{
  ok: boolean;
  status: number;
  statusText: string;
  data: unknown;
  headers: Record<string, unknown>;
  request: { method: string; url: string };
}
```

### Supported options

- `url: string` required
- `method?: string` default `GET`
- `query?: Record<string, string|number|boolean|null|undefined>`
- `params?: Record<string, string|number|boolean|null|undefined>` alias of `query`
- `headers?: Record<string, string>`
- `cookies?: Record<string, string|number|boolean>` auto-formatted to `Cookie` header
- `body?: unknown`
- `data?: unknown` alias of `body`
- `timeoutMs?: number`
- `responseType?: "json" | "text" | "arraybuffer"`

### GET with query + headers

```js
const res = await helpers.http({
  url: "https://httpbin.org/get",
  method: "GET",
  query: {
    line: "Taiyo1",
    shift: 1
  },
  headers: {
    "x-api-key": "token-1"
  },
  timeoutMs: 3000
});
```

### POST with body + cookie + custom header

```js
const res = await helpers.http({
  url: "https://httpbin.org/post",
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-correlation-id": msg.id
  },
  cookies: {
    session: "abc123",
    plant: "A"
  },
  body: {
    workOrder: "WO-777",
    operator: OperatorAttribute?.value || "-"
  }
});
```

### PUT with params + payload

```js
const res = await helpers.http({
  url: "https://httpbin.org/put",
  method: "PUT",
  params: {
    dryRun: false
  },
  body: {
    status: "closed",
    reason: "completed"
  }
});
```

## Passing Request Body

You can pass JSON/object/array/string/number/bool:

```js
await helpers.http({ url, method: "POST", body: { a: 1 } });
await helpers.http({ url, method: "POST", body: ["A", "B"] });
await helpers.http({ url, method: "POST", body: "plain-text" });
await helpers.http({ url, method: "POST", body: 42 });
await helpers.http({ url, method: "POST", body: true });
```

## Passing Query Params

Use `query` or `params`.

```js
await helpers.http({
  url: "https://httpbin.org/get",
  query: {
    q: "paper",
    page: 1,
    strict: true
  }
});
```

## Passing Cookies

Use `cookies` object:

```js
await helpers.http({
  url: "https://httpbin.org/anything",
  method: "GET",
  cookies: {
    session: "abc123",
    role: "operator"
  }
});
```

It becomes:

`Cookie: session=abc123; role=operator`

## Error Handling Pattern

Use `try/catch` and check status:

```js
try {
  const res = await helpers.http({
    url: "https://api.example.com/orders",
    method: "POST",
    body: { id: msg.id }
  });

  if (!res.ok) {
    helpers.log("HTTP non-2xx", res.status, res.data);
    send({ ...msg, payload: { ok: false, status: res.status, data: res.data } });
    return;
  }

  send({ ...msg, payload: { ok: true, data: res.data } });
} catch (error) {
  helpers.log("HTTP failed", error instanceof Error ? error.message : String(error));
  send({ ...msg, payload: { ok: false, error: String(error) } });
}
```

## Best Practices

- Always use `await` for HTTP calls.
- Add `timeoutMs`/`timeout` to prevent hanging requests.
- Include correlation ID header (`x-correlation-id: msg.id`) for tracing.
- Avoid large payloads in tight loops.
- For critical flows, validate response shape before writing asset/event.

