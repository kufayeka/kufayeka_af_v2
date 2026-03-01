export const OPENAPI_RUNTIME_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Kufayeka Runtime API",
    version: "1.4.0",
    description:
      "Runtime API for asset system, attribute values, hierarchy, finder, event system, historian, and global store."
  },
  servers: [{ url: "http://localhost:4000" }],
  tags: [
    { name: "OpenAPI", description: "OpenAPI/Swagger documentation endpoints." },
    { name: "Assets", description: "Asset model, path query, attribute reads/writes, and finder endpoints." },
    { name: "Events", description: "Event lifecycle: open, query, close, acknowledge, and delete." },
    { name: "Historian", description: "Historian read/delete bridge endpoints resolved by asset path." },
    { name: "Global", description: "Runtime global key-value storage endpoints." }
  ],
  paths: {
    "/docs": {
      get: {
        tags: ["OpenAPI"],
        summary: "Swagger UI page",
        operationId: "getDocsPage",
        responses: { 200: { description: "HTML docs page" } }
      }
    },
    "/docs-json": {
      get: {
        tags: ["OpenAPI"],
        summary: "OpenAPI JSON for codegen (Orval)",
        operationId: "getOpenApiJson",
        responses: {
          200: {
            description: "OpenAPI spec JSON",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } }
          }
        }
      }
    },
    "/api/openapi": { get: { tags: ["OpenAPI"], summary: "Alias of /docs", operationId: "getDocsPageAlias", responses: { 200: { description: "HTML docs page" } } } },
    "/api/openapi.json": { get: { tags: ["OpenAPI"], summary: "Alias of /docs-json", operationId: "getOpenApiJsonAlias", responses: { 200: { description: "OpenAPI spec JSON" } } } },

    "/api/assets/system": {
      get: {
        tags: ["Assets"],
        summary: "Get full asset system snapshot",
        description: "Returns the complete runtime asset state, including assets, attribute templates, and historian targets.",
        operationId: "getAssetSystem",
        responses: { 200: { description: "Asset system snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemResponse" } } } } }
      },
      put: {
        tags: ["Assets"],
        summary: "Replace full asset system snapshot",
        description:
          "Full replace (not patch). Frontend should GET current snapshot, modify locally, then PUT the whole object back.",
        operationId: "replaceAssetSystem",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssetSystemState" },
              examples: {
                minimal: {
                  value: {
                    assets: [{ id: "Taiyo1", name: "Taiyo1", parentId: null, templateIds: [], attributes: {} }],
                    attributeTemplates: [],
                    historians: []
                  }
                }
              }
            }
          }
        },
        responses: { 200: { description: "Updated snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemResponse" } } } } }
      }
    },
    "/api/assets": {
      get: { tags: ["Assets"], summary: "Alias of /api/assets/system", operationId: "getAssetSystemAlias", responses: { 200: { description: "Asset system snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemResponse" } } } } } },
      put: { tags: ["Assets"], summary: "Alias of /api/assets/system", operationId: "replaceAssetSystemAlias", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemState" } } } }, responses: { 200: { description: "Updated snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemResponse" } } } } } }
    },
    "/api/assets/hierarchy": {
      get: {
        tags: ["Assets"],
        summary: "Get asset hierarchy",
        operationId: "getAssetHierarchy",
        parameters: [{ name: "populated", in: "query", required: false, schema: { type: "boolean", default: true }, description: "Include effectiveAttributes" }],
        responses: { 200: { description: "Hierarchy response", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetHierarchyResponse" } } } } }
      }
    },
    "/api/assets/query": {
      get: {
        tags: ["Assets"],
        summary: "Query assets/attributes by wildcard path",
        operationId: "queryAssets",
        parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }],
        responses: { 200: { description: "Query result", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetQueryResponse" } } } }, 400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      }
    },
    "/api/assets/find-by-value": {
      get: {
        tags: ["Assets"],
        summary: "Find attributes/assets by expected value",
        operationId: "findAssetsByValue",
        parameters: [{ $ref: "#/components/parameters/PathQueryOptional" }, { $ref: "#/components/parameters/ValueQueryRequired" }, { $ref: "#/components/parameters/StrictQuery" }],
        responses: { 200: { description: "Finder result", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetFinderResponse" } } } }, 400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      }
    },
    "/api/assets/find": { get: { tags: ["Assets"], summary: "Alias of /api/assets/find-by-value", operationId: "findAssetsByValueAlias", parameters: [{ $ref: "#/components/parameters/PathQueryOptional" }, { $ref: "#/components/parameters/ValueQueryRequired" }, { $ref: "#/components/parameters/StrictQuery" }], responses: { 200: { description: "Finder result", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetFinderResponse" } } } } } } },
    "/api/assets/value/{encodedPath}": {
      get: {
        tags: ["Assets"],
        summary: "Get attribute value(s) by encoded path",
        operationId: "getAssetValuesByPath",
        parameters: [{ $ref: "#/components/parameters/EncodedPathParam" }],
        responses: { 200: { description: "Matches", content: { "application/json": { schema: { $ref: "#/components/schemas/AttributeMatchesResponse" } } } } }
      },
      put: {
        tags: ["Assets"],
        summary: "Set attribute value(s) by encoded path",
        operationId: "setAssetValuesByPath",
        parameters: [{ $ref: "#/components/parameters/EncodedPathParam" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SetAttributeValueRequest" } } } },
        responses: { 200: { description: "Updated matches", content: { "application/json": { schema: { $ref: "#/components/schemas/AttributeMatchesResponse" } } } }, 400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      }
    },
    "/api/assets/values:batch": {
      put: {
        tags: ["Assets"],
        summary: "Batch set attribute values",
        description: "Set multiple attribute values in one request.",
        operationId: "setAssetValuesBatch",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BatchSetRequest" },
              example: {
                items: [
                  { path: "Taiyo1.Line1.M1.Speed", value: 1200 },
                  { path: "Taiyo1.Line1.M2.Speed", value: 1195 }
                ]
              }
            }
          }
        },
        responses: { 200: { description: "Batch result", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchSetResponse" } } } } }
      }
    },
    "/api/assets/historian-tags": {
      get: {
        tags: ["Historian"],
        summary: "Get historian tags resolved from path",
        operationId: "getHistorianTags",
        parameters: [{ $ref: "#/components/parameters/PathQueryOptional" }],
        responses: { 200: { description: "Historian tags", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianTagsResponse" } } } } }
      }
    },

    "/api/events": {
      get: {
        tags: ["Events"],
        summary: "Query events",
        description:
          "Main event listing endpoint with pagination and filters. `context` must be a JSON string (URL-encoded in query string).",
        operationId: "queryEvents",
        parameters: [{ $ref: "#/components/parameters/EventPatternQuery" }, { $ref: "#/components/parameters/EventFromQuery" }, { $ref: "#/components/parameters/EventToQuery" }, { $ref: "#/components/parameters/EventStatusQuery" }, { $ref: "#/components/parameters/EventSeverityQuery" }, { $ref: "#/components/parameters/EventContextQuery" }, { $ref: "#/components/parameters/EventLimitQuery" }, { $ref: "#/components/parameters/EventOffsetQuery" }, { $ref: "#/components/parameters/EventSortByQuery" }, { $ref: "#/components/parameters/EventSortDirQuery" }],
        responses: {
          200: { description: "Event query result", content: { "application/json": { schema: { $ref: "#/components/schemas/EventsQueryResponse" } } } },
          400: { description: "Invalid filter or JSON in context", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } }
        }
      },
      delete: {
        tags: ["Events"],
        summary: "Delete events by filter",
        description: "Deletes matching events permanently. Use specific filters in production.",
        operationId: "deleteEventsByFilter",
        parameters: [{ $ref: "#/components/parameters/EventPatternQuery" }, { $ref: "#/components/parameters/EventStatusQuery" }, { $ref: "#/components/parameters/EventFromQuery" }, { $ref: "#/components/parameters/EventToQuery" }, { $ref: "#/components/parameters/EventSeverityQuery" }],
        responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteEventsResponse" } } } } }
      }
    },
    "/api/events/open": {
      post: {
        tags: ["Events"],
        summary: "Open event",
        description: "Creates a new open event. Use `event_path` (or alias `path`) and optional context/severity.",
        operationId: "openEvent",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OpenEventRequest" },
              example: {
                event_path: "Taiyo1.Events.jobLifecycle",
                start_ts: "2026-02-26T12:00:00Z",
                severity: "medium",
                context: { assetId: "Taiyo1", jobId: "JOB-0001", state: "running" },
                notes_on_open: "Job lifecycle changed to running",
                captured_data_on_open: { oldValue: "unload", newValue: "load", source: "PLC" }
              }
            }
          }
        },
        responses: { 200: { description: "Open result", content: { "application/json": { schema: { $ref: "#/components/schemas/OpenEventResponse" } } } } }
      }
    },
    "/api/events/close": {
      post: {
        tags: ["Events"],
        summary: "Close events by pattern",
        description: "Closes all currently open events matching `pattern` (or alias `event_path`).",
        operationId: "closeEvents",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CloseEventsRequest" },
              example: {
                pattern: "Taiyo1.Events.jobLifecycle",
                end_ts: "2026-02-26T12:10:00Z",
                notes_on_close: "Job completed",
                captured_data_on_close: { finalCount: 12345, reason: "Done" }
              }
            }
          }
        },
        responses: { 200: { description: "Close result", content: { "application/json": { schema: { $ref: "#/components/schemas/CloseEventsResponse" } } } } }
      }
    },
    "/api/events/close-id": {
      post: {
        tags: ["Events"],
        summary: "Close event by id",
        description: "Closes one specific event by id.",
        operationId: "closeEventById",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CloseByIdRequest" },
              example: {
                id: "8f63f54d-5d0f-4fd3-b953-5c36f59070c7",
                notes_on_close: "Acknowledged by operator",
                captured_data_on_close: { acknowledgedBy: "operator-1" }
              }
            }
          }
        },
        responses: { 200: { description: "Close result", content: { "application/json": { schema: { $ref: "#/components/schemas/CloseEventsResponse" } } } } }
      }
    },
    "/api/events/ack-id": {
      post: {
        tags: ["Events"],
        summary: "Acknowledge event by id",
        description: "Sets `is_acknowledge = true` for one event row.",
        operationId: "ackEventById",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AckByIdRequest" },
              example: { id: "8f63f54d-5d0f-4fd3-b953-5c36f59070c7", acknowledged_ts: "2026-02-26T12:11:00Z" }
            }
          }
        },
        responses: { 200: { description: "Ack result", content: { "application/json": { schema: { $ref: "#/components/schemas/AckByIdResponse" } } } } }
      }
    },
    "/api/events/by-id": {
      delete: {
        tags: ["Events"],
        summary: "Delete event by id",
        operationId: "deleteEventById",
        parameters: [{ name: "id", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteByIdResponse" } } } } }
      }
    },

    "/api/historian/raw": { get: { tags: ["Historian"], summary: "Historian raw query", description: "Returns raw historian points in selected window. Requires 'path', 'from', and 'to'.", operationId: "historianRaw", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }, { $ref: "#/components/parameters/HistorianOrderQuery" }, { $ref: "#/components/parameters/HistorianTimeQuery" }, { $ref: "#/components/parameters/HistorianLimitQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/range": { get: { tags: ["Historian"], summary: "Historian range query", description: "Returns aggregated buckets for selected window. Supports agg=min|max|avg|first|last|count|delta|reverseDelta. Requires 'path', 'from', and 'to'.", operationId: "historianRange", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }, { $ref: "#/components/parameters/HistorianOrderQuery" }, { $ref: "#/components/parameters/HistorianTimeQuery" }, { $ref: "#/components/parameters/HistorianBucketMsQuery" }, { $ref: "#/components/parameters/HistorianAggQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/last": { get: { tags: ["Historian"], summary: "Historian last query", description: "Returns latest value for each matched path (current snapshot style, no window required).", operationId: "historianLast", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianTimeQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/first": { get: { tags: ["Historian"], summary: "Historian first query", description: "Returns first value in selected window per matched path. Internally mapped to raw query with order=asc&limit=1. Requires 'path', 'from', and 'to'.", operationId: "historianFirst", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }, { $ref: "#/components/parameters/HistorianTimeQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/targets": { get: { tags: ["Historian"], summary: "Historian targets", operationId: "historianTargets", responses: { 200: { description: "Targets", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianTargetsResponse" } } } } } } },
    "/api/historian/target-metrics": { get: { tags: ["Historian"], summary: "Historian target metrics", operationId: "historianTargetMetrics", parameters: [{ name: "targetId", in: "query", required: false, schema: { type: "string", default: "default" } }], responses: { 200: { description: "Metrics object", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } } },
    "/api/historian/target-logs": { get: { tags: ["Historian"], summary: "Historian target logs", operationId: "historianTargetLogs", parameters: [{ name: "targetId", in: "query", required: false, schema: { type: "string", default: "default" } }, { name: "kind", in: "query", required: false, schema: { type: "string", default: "" } }, { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100 } }], responses: { 200: { description: "Logs object", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } } },
    "/api/historian/delete-attribute": { delete: { tags: ["Historian"], summary: "Delete historian data by attribute path", operationId: "historianDeleteAttribute", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }], responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianDeleteResponse" } } } } } } },
    "/api/historian/delete-template-attribute": { delete: { tags: ["Historian"], summary: "Delete historian data by template attribute", operationId: "historianDeleteTemplateAttribute", parameters: [{ name: "templateId", in: "query", required: true, schema: { type: "string" } }, { name: "attributeName", in: "query", required: true, schema: { type: "string" } }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }], responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianDeleteResponse" } } } } } } },

    "/api/global": {
      get: { tags: ["Global"], summary: "Get all global entries", operationId: "getGlobalEntries", responses: { 200: { description: "Global map", content: { "application/json": { schema: { $ref: "#/components/schemas/GlobalEntriesResponse" } } } } } }
    },
    "/api/global/{key}": {
      get: {
        tags: ["Global"],
        summary: "Get global key",
        description: "Returns value for one global key.",
        operationId: "getGlobalValue",
        parameters: [{ $ref: "#/components/parameters/GlobalKeyParam" }],
        responses: { 200: { description: "Value", content: { "application/json": { schema: { $ref: "#/components/schemas/GlobalValueResponse" } } } }, 404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      },
      put: {
        tags: ["Global"],
        summary: "Set global key",
        description: "Upsert one global key. Body must include `value`.",
        operationId: "setGlobalValue",
        parameters: [{ $ref: "#/components/parameters/GlobalKeyParam" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SetGlobalValueRequest" },
              example: { value: { theme: "light", pinnedAsset: "Taiyo1.Line1.M1" } }
            }
          }
        },
        responses: { 200: { description: "Updated", content: { "application/json": { schema: { $ref: "#/components/schemas/GlobalValueResponse" } } } } }
      },
      delete: {
        tags: ["Global"],
        summary: "Delete global key",
        operationId: "deleteGlobalValue",
        parameters: [{ $ref: "#/components/parameters/GlobalKeyParam" }],
        responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteGlobalResponse" } } } } }
      }
    }
  },
  components: {
    parameters: {
      PathQueryRequired: {
        name: "path",
        in: "query",
        required: true,
        description: "Wildcard path query. Supports '*' per segment. Example: 'Taiyo1.Line1.*.Speed' or comma-separated list for historian path APIs.",
        schema: { type: "string" },
        example: "Taiyo1.Line1.*.Speed"
      },
      PathQueryOptional: {
        name: "path",
        in: "query",
        required: false,
        description: "Wildcard path query. If omitted, defaults to all attributes.",
        schema: { type: "string", default: "*.*.*" },
        example: "*.*.*"
      },
      ValueQueryRequired: {
        name: "value",
        in: "query",
        required: true,
        description: "Expected value for finder. Parsed as JSON if valid JSON string, otherwise treated as plain string.",
        schema: { type: "string" },
        examples: {
          number: { value: "100" },
          string: { value: "\"RUNNING\"" },
          object: { value: "{\"mode\":\"AUTO\"}" }
        }
      },
      StrictQuery: {
        name: "strict",
        in: "query",
        required: false,
        description: "Strict comparison in finder. true = exact/type-sensitive; false = relaxed comparison.",
        schema: { type: "boolean", default: false },
        example: false
      },
      EncodedPathParam: {
        name: "encodedPath",
        in: "path",
        required: true,
        description: "URL-encoded path. Always use encodeURIComponent(path) from frontend.",
        schema: { type: "string" },
        example: "Taiyo1.Line1.Motor-01.Speed"
      },
      EventPatternQuery: {
        name: "pattern",
        in: "query",
        required: false,
        description: "Event path filter with wildcard '*'. '*' means all.",
        schema: { type: "string", default: "*" },
        example: "Taiyo1.Events.*"
      },
      EventFromQuery: {
        name: "from",
        in: "query",
        required: false,
        description: "Start bound for event overlap filter. Accepts ISO datetime or epoch number string.",
        schema: { type: "string", default: "*" },
        examples: { iso: { value: "2026-02-26T00:00:00Z" }, epochMs: { value: "1772064000000" } }
      },
      EventToQuery: {
        name: "to",
        in: "query",
        required: false,
        description: "End bound for event overlap filter. Accepts ISO datetime or epoch number string.",
        schema: { type: "string", default: "*" },
        examples: { iso: { value: "2026-02-26T23:59:59Z" }, epochMs: { value: "1772150399000" } }
      },
      EventStatusQuery: {
        name: "status",
        in: "query",
        required: false,
        description: "Event status filter. Use '*' for all.",
        schema: { type: "string", default: "*" },
        examples: { all: { value: "*" }, open: { value: "open" }, closed: { value: "closed" } }
      },
      EventSeverityQuery: {
        name: "severity",
        in: "query",
        required: false,
        description: "Severity filter. Allowed: other, info, low, medium, high, critical, '*'.",
        schema: { type: "string", default: "*" },
        examples: { all: { value: "*" }, critical: { value: "critical" } }
      },
      EventContextQuery: {
        name: "context",
        in: "query",
        required: false,
        description:
          "JSON string filter for context. Supports simple object equality, or advanced {op,conditions}. Operators: eq, neq, in, not_in, exists, not_exists.",
        schema: { type: "string" },
        examples: {
          simple: { value: "{\"site\":\"A\",\"line\":\"L1\"}" },
          advanced: {
            value:
              "{\"op\":\"OR\",\"conditions\":[{\"path\":\"site\",\"operator\":\"eq\",\"value\":\"A\"},{\"path\":\"shift\",\"operator\":\"in\",\"value\":[1,2]}]}"
          }
        }
      },
      EventLimitQuery: {
        name: "limit",
        in: "query",
        required: false,
        description: "Page size. Runtime clamps to range 1..5000.",
        schema: { type: "integer", default: 1000, minimum: 1, maximum: 5000 },
        example: 200
      },
      EventOffsetQuery: {
        name: "offset",
        in: "query",
        required: false,
        description: "Pagination offset (0-based).",
        schema: { type: "integer", default: 0, minimum: 0 },
        example: 0
      },
      EventSortByQuery: {
        name: "sortBy",
        in: "query",
        required: false,
        description: "Sort column. Unsupported values fallback to 'start_ts'.",
        schema: {
          type: "string",
          enum: ["id", "event_path", "start_ts", "end_ts", "status", "severity", "is_acknowledge", "acknowledged_ts"],
          default: "start_ts"
        },
        example: "start_ts"
      },
      EventSortDirQuery: {
        name: "sortDir",
        in: "query",
        required: false,
        description: "Sort direction.",
        schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
        example: "desc"
      },
      HistorianFromQuery: {
        name: "from",
        in: "query",
        required: false,
        description: "Historian query start time. Pass ISO or epoch based on target system.",
        schema: { type: "string" },
        example: "2026-02-26T00:00:00Z"
      },
      HistorianToQuery: {
        name: "to",
        in: "query",
        required: false,
        description: "Historian query end time. Pass ISO or epoch based on target system.",
        schema: { type: "string" },
        example: "2026-02-26T23:59:59Z"
      },
      HistorianOrderQuery: {
        name: "order",
        in: "query",
        required: false,
        description: "Row order for raw/range query.",
        schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
        example: "desc"
      },
      HistorianTimeQuery: {
        name: "time",
        in: "query",
        required: false,
        description: "Output timestamp format from historian response.",
        schema: { type: "string", enum: ["iso", "epoch"], default: "iso" },
        example: "iso"
      },
      HistorianLimitQuery: {
        name: "limit",
        in: "query",
        required: false,
        description: "Maximum rows to return for raw query.",
        schema: { type: "integer", default: 1000, minimum: 1 },
        example: 1000
      },
      HistorianBucketMsQuery: {
        name: "bucketMs",
        in: "query",
        required: false,
        description: "Bucket size in milliseconds for range aggregation.",
        schema: { type: "integer", default: 1000, minimum: 1 },
        example: 1000
      },
      HistorianAggQuery: {
        name: "agg",
        in: "query",
        required: false,
        description: "Aggregation function for range query. delta=last-first, reverseDelta=first-last (per matched path in selected window).",
        schema: { type: "string", enum: ["min", "max", "avg", "first", "last", "count", "delta", "reverseDelta"], default: "avg" },
        example: "avg"
      },
      GlobalKeyParam: {
        name: "key",
        in: "path",
        required: true,
        description: "Global store key. Use URL-encoding for special characters.",
        schema: { type: "string" },
        example: "ui.lastSelectedAsset"
      }
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        description: "Standard error payload.",
        required: ["error"],
        properties: { error: { type: "string", example: "Invalid timestamp: abc" } }
      },
      JsonValue: {
        nullable: true,
        oneOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "array", items: { $ref: "#/components/schemas/JsonValue" } },
          { type: "object", additionalProperties: { $ref: "#/components/schemas/JsonValue" } }
        ]
      },
      HistorianTarget: {
        type: "object",
        required: ["id", "name", "timestampUnit", "enabled"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          timestampUnit: { type: "string", enum: ["us", "ns"] },
          enabled: { type: "boolean" }
        }
      },
      AssetTemplateAttribute: {
        type: "object",
        required: ["enabled", "name", "valueType", "unit", "historianEnabled", "historianTargetId"],
        properties: {
          enabled: { type: "boolean" },
          name: { type: "string" },
          valueType: { type: "string", enum: ["int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64", "boolean", "string", "array", "object"] },
          default: { $ref: "#/components/schemas/JsonValue" },
          unit: { type: "string" },
          historianEnabled: { type: "boolean" },
          historianTimeSourcePath: { type: "string" },
          historianTargetId: { type: "string" },
          dashboardVisible: { type: "boolean" },
          dashboardEditable: { type: "boolean" }
        }
      },
      AttributeTemplate: { type: "object", required: ["id", "name", "attributes"], properties: { id: { type: "string" }, name: { type: "string" }, attributes: { type: "array", items: { $ref: "#/components/schemas/AssetTemplateAttribute" } } } },
      AssetDefinition: { type: "object", required: ["id", "name", "parentId", "templateIds", "attributes"], properties: { id: { type: "string" }, name: { type: "string" }, parentId: { type: "string", nullable: true }, templateIds: { type: "array", items: { type: "string" } }, attributes: { type: "object", additionalProperties: { $ref: "#/components/schemas/JsonValue" } } } },
      AssetSystemState: { type: "object", required: ["assets", "attributeTemplates", "historians"], properties: { assets: { type: "array", items: { $ref: "#/components/schemas/AssetDefinition" } }, attributeTemplates: { type: "array", items: { $ref: "#/components/schemas/AttributeTemplate" } }, historians: { type: "array", items: { $ref: "#/components/schemas/HistorianTarget" } } } },
      AssetSystemResponse: { type: "object", required: ["data"], properties: { data: { $ref: "#/components/schemas/AssetSystemState" } } },
      AttributeQueryMatch: { type: "object", required: ["kind", "path", "assetId", "attributeName", "tagId"], properties: { kind: { type: "string", enum: ["attribute"] }, path: { type: "string" }, assetId: { type: "string" }, attributeName: { type: "string" }, value: { $ref: "#/components/schemas/JsonValue" }, ts: { type: "string", nullable: true }, type: { type: "string" }, unit: { type: "string" }, historianEnabled: { type: "boolean" }, historianTimeSourcePath: { type: "string" }, historianTargetId: { type: "string" }, tagId: { type: "integer" } } },
      AssetQueryMatch: { type: "object", required: ["kind", "path", "assetId", "value"], properties: { kind: { type: "string", enum: ["asset"] }, path: { type: "string" }, assetId: { type: "string" }, value: { $ref: "#/components/schemas/AssetDefinition" } } },
      AssetHierarchyResponse: { type: "object", required: ["populated", "count", "data"], properties: { populated: { type: "boolean" }, count: { type: "integer" }, data: { type: "array", items: { type: "object", additionalProperties: true } } } },
      AssetQueryResponse: { type: "object", required: ["path", "count", "matches"], properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { oneOf: [{ $ref: "#/components/schemas/AssetQueryMatch" }, { $ref: "#/components/schemas/AttributeQueryMatch" }] } } } },
      AssetFinderResponse: { type: "object", required: ["path", "strict", "count", "assetCount", "matches", "assets"], properties: { path: { type: "string" }, expectedValue: { $ref: "#/components/schemas/JsonValue" }, strict: { type: "boolean" }, count: { type: "integer" }, assetCount: { type: "integer" }, matches: { type: "array", items: { $ref: "#/components/schemas/AttributeQueryMatch" } }, assets: { type: "array", items: { type: "object", required: ["assetId", "path"], properties: { assetId: { type: "string" }, path: { type: "string" } } } } } },
      SetAttributeValueRequest: { type: "object", required: ["value"], properties: { value: { $ref: "#/components/schemas/JsonValue" } } },
      AttributeMatchesResponse: { type: "object", required: ["path", "count", "matches"], properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { $ref: "#/components/schemas/AttributeQueryMatch" } } } },
      BatchSetRequest: { type: "object", required: ["items"], properties: { items: { type: "array", items: { type: "object", required: ["path", "value"], properties: { path: { type: "string" }, value: { $ref: "#/components/schemas/JsonValue" } } } } } },
      BatchSetResponse: { type: "object", required: ["count", "results"], properties: { count: { type: "integer" }, results: { type: "array", items: { type: "object", required: ["path", "count", "matches"], properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { $ref: "#/components/schemas/AttributeQueryMatch" } } } } } } },
      EventRow: {
        type: "object",
        description: "One event record in event table.",
        required: ["id", "event_path", "start_ts", "status", "severity", "context", "is_acknowledge"],
        properties: {
          id: { type: "string", example: "8f63f54d-5d0f-4fd3-b953-5c36f59070c7" },
          event_path: { type: "string", example: "Taiyo1.Events.jobLifecycle" },
          start_ts: { type: "string", format: "date-time" },
          end_ts: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["open", "closed"] },
          severity: { type: "string", enum: ["other", "info", "low", "medium", "high", "critical"] },
          context: {
            type: "object",
            description: "Arbitrary context object (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          is_acknowledge: { type: "boolean" },
          acknowledged_ts: { type: "string", format: "date-time", nullable: true },
          notes_on_open: { type: "string", nullable: true },
          notes_on_close: { type: "string", nullable: true },
          captured_data_on_open: {
            type: "object",
            nullable: true,
            description: "Captured payload at open time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          captured_data_on_close: {
            type: "object",
            nullable: true,
            description: "Captured payload at close time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          }
        }
      },
      OpenEventRequest: {
        type: "object",
        description: "Create one open event. Use `event_path` (preferred) or alias `path`.",
        properties: {
          event_path: { type: "string" },
          path: { type: "string" },
          start_ts: { type: "string", format: "date-time" },
          ts: { type: "string", format: "date-time" },
          context: {
            type: "object",
            description: "Context object (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          notes_on_open: { type: "string" },
          captured_data_on_open: {
            type: "object",
            nullable: true,
            description: "Captured payload at open time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          notes: { type: "string" },
          severity: { type: "string", enum: ["other", "info", "low", "medium", "high", "critical"] }
        },
        example: {
          event_path: "Taiyo1.Events.jobLifecycle",
          start_ts: "2026-02-26T12:00:00Z",
          severity: "medium",
          context: { assetId: "Taiyo1", state: "running" },
          notes_on_open: "Job started",
          captured_data_on_open: { oldValue: "unload", newValue: "load" }
        }
      },
      OpenEventResponse: { type: "object", required: ["ok", "row"], properties: { ok: { type: "boolean" }, row: { $ref: "#/components/schemas/EventRow" } } },
      CloseEventsRequest: {
        type: "object",
        description: "Close open events by wildcard pattern.",
        properties: {
          pattern: { type: "string" },
          event_path: { type: "string" },
          end_ts: { type: "string", format: "date-time" },
          ts: { type: "string", format: "date-time" },
          notes_on_close: { type: "string" },
          captured_data_on_close: {
            type: "object",
            nullable: true,
            description: "Captured payload at close time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          notes: { type: "string" }
        },
        example: {
          pattern: "Taiyo1.Events.jobLifecycle",
          end_ts: "2026-02-26T12:15:00Z",
          notes_on_close: "Job completed",
          captured_data_on_close: { finalState: "completed" }
        }
      },
      CloseByIdRequest: {
        type: "object",
        required: ["id"],
        description: "Close one event by row id.",
        properties: {
          id: { type: "string" },
          end_ts: { type: "string", format: "date-time" },
          ts: { type: "string", format: "date-time" },
          notes_on_close: { type: "string" },
          captured_data_on_close: {
            type: "object",
            nullable: true,
            description: "Captured payload at close time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          },
          notes: { type: "string" }
        },
        example: {
          id: "8f63f54d-5d0f-4fd3-b953-5c36f59070c7",
          notes_on_close: "Closed by operator",
          captured_data_on_close: { closedBy: "operator-1" }
        }
      },
      CloseEventsResponse: {
        type: "object",
        required: ["ok", "closedCount", "ts"],
        properties: {
          ok: { type: "boolean" },
          pattern: { type: "string" },
          id: { type: "string" },
          closedCount: { type: "integer" },
          ts: { type: "string", format: "date-time" },
          notes_on_close: { type: "string", nullable: true },
          captured_data_on_close: {
            type: "object",
            nullable: true,
            description: "Captured payload at close time (stored as JSONB in af_event).",
            additionalProperties: { $ref: "#/components/schemas/JsonValue" }
          }
        }
      },
      AckByIdRequest: {
        type: "object",
        required: ["id"],
        description: "Acknowledge one event by id.",
        properties: { id: { type: "string" }, acknowledged_ts: { type: "string", format: "date-time" }, ts: { type: "string", format: "date-time" } },
        example: { id: "8f63f54d-5d0f-4fd3-b953-5c36f59070c7", acknowledged_ts: "2026-02-26T12:16:00Z" }
      },
      AckByIdResponse: { type: "object", required: ["ok", "id", "acknowledgedCount", "acknowledged_ts"], properties: { ok: { type: "boolean" }, id: { type: "string" }, acknowledgedCount: { type: "integer" }, acknowledged_ts: { type: "string", format: "date-time" } } },
      DeleteByIdResponse: { type: "object", required: ["ok", "id", "deletedCount"], properties: { ok: { type: "boolean" }, id: { type: "string" }, deletedCount: { type: "integer" } } },
      DeleteEventsResponse: { type: "object", required: ["ok", "pattern", "status", "severity", "deletedCount"], properties: { ok: { type: "boolean" }, pattern: { type: "string" }, status: { type: "string" }, severity: { type: "string" }, deletedCount: { type: "integer" } } },
      EventsQueryResponse: {
        type: "object",
        description: "Paginated event query result.",
        required: ["count", "total", "rows"],
        properties: {
          count: { type: "integer" },
          total: { type: "integer" },
          pattern: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          status: { type: "string" },
          severity: { type: "string" },
          sortBy: { type: "string" },
          sortDir: { type: "string" },
          limit: { type: "integer" },
          offset: { type: "integer" },
          rows: { type: "array", items: { $ref: "#/components/schemas/EventRow" } }
        }
      },
      HistorianPathMatch: { type: "object", required: ["path", "assetId", "attributeName", "tagId", "historianTargetId"], properties: { path: { type: "string" }, assetId: { type: "string" }, attributeName: { type: "string" }, tagId: { type: "integer" }, historianTargetId: { type: "string" }, type: { type: "string" }, unit: { type: "string" }, latestValue: { $ref: "#/components/schemas/JsonValue" }, latestTs: { type: "string", nullable: true }, historianEnabled: { type: "boolean" }, historianTimeSourcePath: { type: "string" } } },
      HistorianQueryResponse: { type: "object", required: ["path", "paths", "matches", "rows", "truncated", "historianTargetId"], properties: { path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, matches: { type: "array", items: { $ref: "#/components/schemas/HistorianPathMatch" } }, rows: { type: "array", items: { type: "object", additionalProperties: { $ref: "#/components/schemas/JsonValue" } } }, truncated: { type: "boolean" }, agg: { type: "string", nullable: true }, historianTargetId: { type: "string" } } },
      HistorianTargetsResponse: { type: "object", required: ["count", "targets", "bridgeStats"], properties: { count: { type: "integer" }, targets: { type: "array", items: { $ref: "#/components/schemas/HistorianTarget" } }, bridgeStats: { type: "object", additionalProperties: true } } },
      HistorianTagsResponse: { type: "object", required: ["path", "count", "matches"], properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { $ref: "#/components/schemas/HistorianPathMatch" } } } },
      HistorianDeleteResponse: { type: "object", required: ["ok", "message", "deletedRecords", "touchedSegments", "historianTargetId", "matches"], properties: { ok: { type: "boolean" }, message: { type: "string" }, deletedRecords: { type: "integer" }, touchedSegments: { type: "integer" }, historianTargetId: { type: "string" }, matches: { type: "array", items: { $ref: "#/components/schemas/HistorianPathMatch" } }, path: { type: "string" }, templateId: { type: "string" }, attributeName: { type: "string" } } },
      GlobalEntriesResponse: { type: "object", required: ["data"], properties: { data: { type: "object", additionalProperties: { $ref: "#/components/schemas/JsonValue" } } } },
      GlobalValueResponse: {
        type: "object",
        required: ["key", "value"],
        properties: { key: { type: "string" }, value: { $ref: "#/components/schemas/JsonValue" } },
        example: { key: "ui.lastSelectedAsset", value: "Taiyo1.Line1.M1" }
      },
      SetGlobalValueRequest: {
        type: "object",
        required: ["value"],
        properties: { value: { $ref: "#/components/schemas/JsonValue" } },
        example: { value: { panel: "events", pageSize: 100 } }
      },
      DeleteGlobalResponse: { type: "object", required: ["key", "deleted"], properties: { key: { type: "string" }, deleted: { type: "boolean" } } }
    }
  }
} as const;
