const OPENAPI_RUNTIME_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Kufayeka Runtime API",
    version: "1.1.0",
    description:
      "Runtime API for asset system, attribute values, hierarchy, finder, event system, historian, and global store."
  },
  servers: [{ url: "http://localhost:4000" }],
  tags: [
    { name: "OpenAPI" },
    { name: "Assets" },
    { name: "Events" },
    { name: "Historian" },
    { name: "Global" }
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
    "/docs/openapi.json": {
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
    "/api/openapi.json": { get: { tags: ["OpenAPI"], summary: "Alias of /docs/openapi.json", operationId: "getOpenApiJsonAlias", responses: { 200: { description: "OpenAPI spec JSON" } } } },

    "/api/assets/system": {
      get: {
        tags: ["Assets"],
        summary: "Get full asset system snapshot",
        operationId: "getAssetSystem",
        responses: { 200: { description: "Asset system snapshot", content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemResponse" } } } } }
      },
      put: {
        tags: ["Assets"],
        summary: "Replace full asset system snapshot",
        operationId: "replaceAssetSystem",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AssetSystemState" } } } },
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
        operationId: "setAssetValuesBatch",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BatchSetRequest" } } } },
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
        operationId: "queryEvents",
        parameters: [{ $ref: "#/components/parameters/EventPatternQuery" }, { $ref: "#/components/parameters/EventFromQuery" }, { $ref: "#/components/parameters/EventToQuery" }, { $ref: "#/components/parameters/EventStatusQuery" }, { $ref: "#/components/parameters/EventSeverityQuery" }, { $ref: "#/components/parameters/EventContextQuery" }, { $ref: "#/components/parameters/EventLimitQuery" }, { $ref: "#/components/parameters/EventOffsetQuery" }, { $ref: "#/components/parameters/EventSortByQuery" }, { $ref: "#/components/parameters/EventSortDirQuery" }],
        responses: { 200: { description: "Event query result", content: { "application/json": { schema: { $ref: "#/components/schemas/EventsQueryResponse" } } } } }
      },
      delete: {
        tags: ["Events"],
        summary: "Delete events by filter",
        operationId: "deleteEventsByFilter",
        parameters: [{ $ref: "#/components/parameters/EventPatternQuery" }, { $ref: "#/components/parameters/EventStatusQuery" }, { $ref: "#/components/parameters/EventFromQuery" }, { $ref: "#/components/parameters/EventToQuery" }, { $ref: "#/components/parameters/EventSeverityQuery" }],
        responses: { 200: { description: "Delete result", content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteEventsResponse" } } } } }
      }
    },
    "/api/events/open": {
      post: {
        tags: ["Events"],
        summary: "Open event",
        operationId: "openEvent",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OpenEventRequest" } } } },
        responses: { 200: { description: "Open result", content: { "application/json": { schema: { $ref: "#/components/schemas/OpenEventResponse" } } } } }
      }
    },
    "/api/events/close": {
      post: {
        tags: ["Events"],
        summary: "Close events by pattern",
        operationId: "closeEvents",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CloseEventsRequest" } } } },
        responses: { 200: { description: "Close result", content: { "application/json": { schema: { $ref: "#/components/schemas/CloseEventsResponse" } } } } }
      }
    },
    "/api/events/close-id": {
      post: {
        tags: ["Events"],
        summary: "Close event by id",
        operationId: "closeEventById",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CloseByIdRequest" } } } },
        responses: { 200: { description: "Close result", content: { "application/json": { schema: { $ref: "#/components/schemas/CloseEventsResponse" } } } } }
      }
    },
    "/api/events/ack-id": {
      post: {
        tags: ["Events"],
        summary: "Acknowledge event by id",
        operationId: "ackEventById",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AckByIdRequest" } } } },
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

    "/api/historian/raw": { get: { tags: ["Historian"], summary: "Historian raw query", operationId: "historianRaw", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }, { $ref: "#/components/parameters/HistorianOrderQuery" }, { $ref: "#/components/parameters/HistorianTimeQuery" }, { $ref: "#/components/parameters/HistorianLimitQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/range": { get: { tags: ["Historian"], summary: "Historian range query", operationId: "historianRange", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianFromQuery" }, { $ref: "#/components/parameters/HistorianToQuery" }, { $ref: "#/components/parameters/HistorianOrderQuery" }, { $ref: "#/components/parameters/HistorianTimeQuery" }, { $ref: "#/components/parameters/HistorianBucketMsQuery" }, { $ref: "#/components/parameters/HistorianAggQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
    "/api/historian/last": { get: { tags: ["Historian"], summary: "Historian last query", operationId: "historianLast", parameters: [{ $ref: "#/components/parameters/PathQueryRequired" }, { $ref: "#/components/parameters/HistorianTimeQuery" }], responses: { 200: { description: "Historian response", content: { "application/json": { schema: { $ref: "#/components/schemas/HistorianQueryResponse" } } } } } } },
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
        operationId: "getGlobalValue",
        parameters: [{ $ref: "#/components/parameters/GlobalKeyParam" }],
        responses: { 200: { description: "Value", content: { "application/json": { schema: { $ref: "#/components/schemas/GlobalValueResponse" } } } }, 404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } } }
      },
      put: {
        tags: ["Global"],
        summary: "Set global key",
        operationId: "setGlobalValue",
        parameters: [{ $ref: "#/components/parameters/GlobalKeyParam" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SetGlobalValueRequest" } } } },
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
      PathQueryRequired: { name: "path", in: "query", required: true, schema: { type: "string" } },
      PathQueryOptional: { name: "path", in: "query", required: false, schema: { type: "string", default: "*.*.*" } },
      ValueQueryRequired: { name: "value", in: "query", required: true, schema: { type: "string" } },
      StrictQuery: { name: "strict", in: "query", required: false, schema: { type: "boolean", default: false } },
      EncodedPathParam: { name: "encodedPath", in: "path", required: true, schema: { type: "string" } },
      EventPatternQuery: { name: "pattern", in: "query", required: false, schema: { type: "string", default: "*" } },
      EventFromQuery: { name: "from", in: "query", required: false, schema: { type: "string", default: "*" } },
      EventToQuery: { name: "to", in: "query", required: false, schema: { type: "string", default: "*" } },
      EventStatusQuery: { name: "status", in: "query", required: false, schema: { type: "string", default: "*" } },
      EventSeverityQuery: { name: "severity", in: "query", required: false, schema: { type: "string", default: "*" } },
      EventContextQuery: { name: "context", in: "query", required: false, schema: { type: "string" }, description: "JSON string filter." },
      EventLimitQuery: { name: "limit", in: "query", required: false, schema: { type: "integer", default: 1000 } },
      EventOffsetQuery: { name: "offset", in: "query", required: false, schema: { type: "integer", default: 0 } },
      EventSortByQuery: { name: "sortBy", in: "query", required: false, schema: { type: "string", default: "start_ts" } },
      EventSortDirQuery: { name: "sortDir", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
      HistorianFromQuery: { name: "from", in: "query", required: false, schema: { type: "string" } },
      HistorianToQuery: { name: "to", in: "query", required: false, schema: { type: "string" } },
      HistorianOrderQuery: { name: "order", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
      HistorianTimeQuery: { name: "time", in: "query", required: false, schema: { type: "string", enum: ["iso", "epoch"], default: "iso" } },
      HistorianLimitQuery: { name: "limit", in: "query", required: false, schema: { type: "integer", default: 1000 } },
      HistorianBucketMsQuery: { name: "bucketMs", in: "query", required: false, schema: { type: "integer", default: 1000 } },
      HistorianAggQuery: { name: "agg", in: "query", required: false, schema: { type: "string", enum: ["min", "max", "avg", "first", "last", "count"], default: "avg" } },
      GlobalKeyParam: { name: "key", in: "path", required: true, schema: { type: "string" } }
    },
    schemas: {
      ErrorResponse: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      AssetSystemState: { type: "object", properties: { assets: { type: "array", items: { type: "object", additionalProperties: true } }, attributeTemplates: { type: "array", items: { type: "object", additionalProperties: true } }, historians: { type: "array", items: { type: "object", additionalProperties: true } } } },
      AssetSystemResponse: { type: "object", properties: { data: { $ref: "#/components/schemas/AssetSystemState" } } },
      AssetHierarchyResponse: { type: "object", properties: { populated: { type: "boolean" }, count: { type: "integer" }, data: { type: "array", items: { type: "object", additionalProperties: true } } } },
      AssetQueryResponse: { type: "object", properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { type: "object", additionalProperties: true } } } },
      AssetFinderResponse: { type: "object", properties: { path: { type: "string" }, expectedValue: {}, strict: { type: "boolean" }, count: { type: "integer" }, assetCount: { type: "integer" }, matches: { type: "array", items: { type: "object", additionalProperties: true } }, assets: { type: "array", items: { type: "object", properties: { assetId: { type: "string" }, path: { type: "string" } } } } } },
      SetAttributeValueRequest: { type: "object", required: ["value"], properties: { value: {} } },
      AttributeMatchesResponse: { type: "object", properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { type: "object", additionalProperties: true } } } },
      BatchSetRequest: { type: "object", properties: { items: { type: "array", items: { type: "object", required: ["path", "value"], properties: { path: { type: "string" }, value: {} } } } } },
      BatchSetResponse: { type: "object", properties: { count: { type: "integer" }, results: { type: "array", items: { type: "object", additionalProperties: true } } } },
      OpenEventRequest: { type: "object", properties: { event_path: { type: "string" }, path: { type: "string" }, start_ts: { type: "string", format: "date-time" }, ts: { type: "string", format: "date-time" }, context: { type: "object", additionalProperties: true }, notes_on_open: { type: "string" }, notes: { type: "string" }, severity: { type: "string" } } },
      OpenEventResponse: { type: "object", properties: { ok: { type: "boolean" }, row: { type: "object", additionalProperties: true } } },
      CloseEventsRequest: { type: "object", properties: { pattern: { type: "string" }, event_path: { type: "string" }, end_ts: { type: "string", format: "date-time" }, ts: { type: "string", format: "date-time" }, notes_on_close: { type: "string" }, notes: { type: "string" } } },
      CloseByIdRequest: { type: "object", required: ["id"], properties: { id: { type: "string" }, end_ts: { type: "string", format: "date-time" }, ts: { type: "string", format: "date-time" }, notes_on_close: { type: "string" }, notes: { type: "string" } } },
      CloseEventsResponse: { type: "object", properties: { ok: { type: "boolean" }, pattern: { type: "string" }, id: { type: "string" }, closedCount: { type: "integer" }, ts: { type: "string", format: "date-time" }, notes_on_close: { type: "string", nullable: true } } },
      AckByIdRequest: { type: "object", required: ["id"], properties: { id: { type: "string" }, acknowledged_ts: { type: "string", format: "date-time" }, ts: { type: "string", format: "date-time" } } },
      AckByIdResponse: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "string" }, acknowledgedCount: { type: "integer" }, acknowledged_ts: { type: "string", format: "date-time" } } },
      DeleteByIdResponse: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "string" }, deletedCount: { type: "integer" } } },
      DeleteEventsResponse: { type: "object", properties: { ok: { type: "boolean" }, pattern: { type: "string" }, status: { type: "string" }, severity: { type: "string" }, deletedCount: { type: "integer" } } },
      EventsQueryResponse: { type: "object", properties: { count: { type: "integer" }, total: { type: "integer" }, pattern: { type: "string" }, from: { type: "string" }, to: { type: "string" }, status: { type: "string" }, severity: { type: "string" }, sortBy: { type: "string" }, sortDir: { type: "string" }, limit: { type: "integer" }, offset: { type: "integer" }, rows: { type: "array", items: { type: "object", additionalProperties: true } } } },
      HistorianQueryResponse: { type: "object", properties: { path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, matches: { type: "array", items: { type: "object", additionalProperties: true } }, rows: { type: "array", items: { type: "object", additionalProperties: true } }, truncated: { type: "boolean" }, agg: { type: "string", nullable: true }, historianTargetId: { type: "string" } } },
      HistorianTargetsResponse: { type: "object", properties: { count: { type: "integer" }, targets: { type: "array", items: { type: "object", additionalProperties: true } }, bridgeStats: { type: "object", additionalProperties: true } } },
      HistorianTagsResponse: { type: "object", properties: { path: { type: "string" }, count: { type: "integer" }, matches: { type: "array", items: { type: "object", additionalProperties: true } } } },
      HistorianDeleteResponse: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" }, deletedRecords: { type: "integer" }, touchedSegments: { type: "integer" }, historianTargetId: { type: "string" }, matches: { type: "array", items: { type: "object", additionalProperties: true } } } },
      GlobalEntriesResponse: { type: "object", properties: { data: { type: "object", additionalProperties: true } } },
      GlobalValueResponse: { type: "object", properties: { key: { type: "string" }, value: {} } },
      SetGlobalValueRequest: { type: "object", required: ["value"], properties: { value: {} } },
      DeleteGlobalResponse: { type: "object", properties: { key: { type: "string" }, deleted: { type: "boolean" } } }
    }
  }
};

module.exports = { OPENAPI_RUNTIME_SPEC };

