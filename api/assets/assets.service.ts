import { HttpException, Injectable } from "@nestjs/common";
import { computeTagID } from "../../runtime/historian/HistorianBridgeFactory";
import type { AttributeQueryMatch } from "../../runtime/core/runtimeTypes";
import { matchAttributeValue, parseFinderExpectedValue } from "../runtime-api.utils";
import { RuntimeApiService } from "../runtime-api.service";

@Injectable()
export class AssetsService {
  constructor(private readonly api: RuntimeApiService) {}

  getSystem() {
    return { data: this.api.assetStore.getState() };
  }

  replaceSystem(body: unknown) {
    try {
      const next = this.api.assetStore.replace((body || {}) as Record<string, unknown>);
      return { data: next };
    } catch (error) {
      throw new HttpException({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  getHierarchy(populated: boolean) {
    const data = this.api.assetStore.getHierarchy({ populateAttributes: populated });
    return { populated, count: data.length, data };
  }

  query(pathQuery: string) {
    if (!pathQuery) throw new HttpException({ error: "Query parameter 'path' is required" }, 400);
    const matches = this.api.assetStore.query(pathQuery).map((item) => {
      if (item.kind !== "attribute") return item;
      return {
        ...item,
        tagId: computeTagID(item.assetId, item.attributeName)
      };
    });
    return { path: pathQuery, count: matches.length, matches };
  }

  findAssetPaths(body: Record<string, unknown>) {
    const scopePath = String(body.scopePath || body.path || "").trim();
    const logic = String(body.logic || "AND").trim().toUpperCase() === "OR" ? "OR" : "AND";
    const filters = Array.isArray(body.filters) ? body.filters : [];
    if (!scopePath) throw new HttpException({ error: "scopePath is required" }, 400);
    if (filters.length === 0) throw new HttpException({ error: "filters is required and must not be empty" }, 400);

    const assets = this.api.assetStore.query(scopePath).filter((item) => item.kind === "asset");
    const matches = assets
      .filter((item) => {
        const assetValue = item.value as unknown as Record<string, unknown>;
        const attributes =
          assetValue && typeof assetValue.attributes === "object" && assetValue.attributes
            ? (assetValue.attributes as Record<string, unknown>)
            : {};
        const filterResults = filters.map((rawFilter) => {
          const filter = rawFilter && typeof rawFilter === "object" ? (rawFilter as Record<string, unknown>) : {};
          const attributeName = String(filter.attributeName || "").trim();
          const operator = String(filter.operator || "eq").trim().toLowerCase();
          if (!attributeName) return false;
          if (!["eq", "neq", "contains", "contains_object"].includes(operator)) return false;
          const attrEntry = attributes[attributeName];
          const actualValue =
            attrEntry && typeof attrEntry === "object" && Object.prototype.hasOwnProperty.call(attrEntry, "value")
              ? (attrEntry as Record<string, unknown>).value
              : undefined;
          return matchAttributeValue(operator, actualValue, filter.value);
        });
        return logic === "OR" ? filterResults.some(Boolean) : filterResults.every(Boolean);
      })
      .map((item) => ({
        path: item.path,
        assetId: item.assetId,
        name:
          item.value && typeof item.value === "object"
            ? String(((item.value as unknown as Record<string, unknown>).name || ""))
            : ""
      }));

    return {
      scopePath,
      logic,
      count: matches.length,
      matches
    };
  }

  findByValue(pathQuery: string, rawValue: string | undefined, strict: boolean) {
    if (rawValue == null) throw new HttpException({ error: "Query parameter 'value' is required" }, 400);
    const expectedValue = parseFinderExpectedValue(rawValue);
    const result =
      typeof this.api.assetStore.findAttributesByValue === "function"
        ? this.api.assetStore.findAttributesByValue(pathQuery, expectedValue, { strict })
        : { path: pathQuery, expectedValue, strict, count: 0, assetCount: 0, matches: [], assets: [] };
    return result;
  }

  historianTags(pathQuery: string) {
    const matches = this.api.resolvePathMatches(pathQuery).map((item) => {
      const origin = this.api.assetStore
        .query(item.path)
        .find(
          (x): x is AttributeQueryMatch =>
            x.kind === "attribute" && x.assetId === item.assetId && x.attributeName === item.attributeName
        );
      return {
        ...item,
        type: origin?.type,
        historianEnabled: origin?.historianEnabled === true,
        historianTimeSourcePath: origin?.historianTimeSourcePath || "",
        historianTargetId: origin?.historianTargetId || "default"
      };
    });
    return { path: pathQuery, count: matches.length, matches };
  }

  getValueByPath(pathQuery: string) {
    const matches = this.api.assetStore
      .query(pathQuery)
      .filter((item) => item.kind === "attribute")
      .map((item) => ({
        ...item,
        tagId: computeTagID(item.assetId, item.attributeName)
      }));
    return { path: pathQuery, count: matches.length, matches };
  }

  putValueByPath(pathQuery: string, body: Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      throw new HttpException({ error: "Body must include a 'value' field" }, 400);
    }
    const existingMatches = this.api.assetStore.query(pathQuery).filter((item) => item.kind === "attribute");
    if (existingMatches.length === 0) {
      throw new HttpException(
        {
          error: "Attribute path not found. Write rejected to prevent creating non-template attribute.",
          path: pathQuery
        },
        404
      );
    }
    const matches = this.api.assetStore.setAttribute(pathQuery, body.value);
    return {
      path: pathQuery,
      count: matches.length,
      matchedCount: matches.length,
      matches: matches.map((item) => ({
        ...item,
        tagId: computeTagID(item.assetId, item.attributeName)
      }))
    };
  }

  batchRead(body: { paths?: string[] }) {
    const rawPaths = Array.isArray(body.paths) ? body.paths : [];
    const paths = rawPaths.map((item) => String(item || ""));
    const invalidPaths = paths.filter((item) => !item);
    if (invalidPaths.length > 0) {
      throw new HttpException(
        {
          error: "Batch read requires non-empty string paths.",
          invalidPaths
        },
        400
      );
    }

    const resultCache = new Map<
      string,
      {
        path: string;
        count: number;
        matches: Array<AttributeQueryMatch & { tagId: number }>;
      }
    >();
    const results = paths.map((path) => {
      const cached = resultCache.get(path);
      if (cached) return cached;
      const matches = this.api.assetStore
        .query(path)
        .filter((item): item is AttributeQueryMatch => item.kind === "attribute")
        .map((item) => ({
          ...item,
          tagId: computeTagID(item.assetId, item.attributeName)
        }));
      const result = { path, count: matches.length, matches };
      resultCache.set(path, result);
      return result;
    });
    return { count: results.length, results };
  }

  batchWrite(body: { items?: Array<{ path: string; value: unknown }> }) {
    const items = Array.isArray(body.items) ? body.items : [];
    const invalidPaths: string[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(item, "path")) continue;
      if (!Object.prototype.hasOwnProperty.call(item, "value")) continue;
      const pathValue = String(item.path || "");
      if (!pathValue) {
        invalidPaths.push(pathValue);
        continue;
      }
      const matches = this.api.assetStore.query(pathValue).filter((x) => x.kind === "attribute");
      if (matches.length === 0) invalidPaths.push(pathValue);
    }
    if (invalidPaths.length > 0) {
      throw new HttpException(
        {
          error: "One or more attribute paths were not found. Batch write rejected; no updates applied.",
          invalidPaths
        },
        404
      );
    }
    const results = this.api.assetStore.setAttributes(items);
    return {
      count: results.length,
      results: results.map((result) => ({
        ...result,
        matchedCount: result.matches.length,
        matches: (result.matches || []).map((item) => ({
          ...item,
          tagId: computeTagID(item.assetId, item.attributeName)
        }))
      }))
    };
  }

  decodePath(encodedPath: string) {
    try {
      return decodeURIComponent(String(encodedPath || ""));
    } catch {
      throw new HttpException({ error: "Invalid encoded path" }, 400);
    }
  }

}
