import { HttpException, Injectable } from "@nestjs/common";
import { RuntimeApiService } from "../runtime-api.service";

@Injectable()
export class HistorianService {
  constructor(private readonly api: RuntimeApiService) {}

  private throwResultError(result: { status: number; body: unknown }) {
    throw new HttpException((result.body || { error: "Unknown error" }) as Record<string, unknown>, result.status);
  }

  async byPath(
    kind: "raw" | "range" | "last" | "first",
    params: {
      path?: string;
      time?: string;
      order?: string;
      from?: string;
      to?: string;
      limit?: string;
      bucketMs?: string;
      agg?: string;
    }
  ) {
    const result = await this.api.historianByPath(kind, {
      pathQueryRaw: params.path || "",
      time: params.time,
      order: params.order,
      from: params.from,
      to: params.to,
      limit: Number(params.limit || 1000),
      bucketMs: Number(params.bucketMs || 0),
      agg: params.agg
    });
    if (result.status >= 400) this.throwResultError(result);
    return result.body;
  }

  targets() {
    const state = this.api.assetStore.getState();
    const list = Array.isArray(state.historians) ? state.historians : [];
    return {
      count: list.length,
      targets: list,
      bridgeStats: this.api.getRuntime().getGlobal("historianBridgeStats", {})
    };
  }

  targetMetrics(targetId = "default") {
    if (!this.api.historianStore) {
      throw new HttpException({ error: "Historian backend is not initialized" }, 503);
    }
    const target = this.api.resolveHistorianTargetById(targetId);
    return {
      targetId: target.id || "default",
      targetName: target.name,
      timestampUnit: target.timestampUnit,
      enabled: target.enabled,
      metrics: this.api.historianStore.getMetrics(),
      ingestStats: this.api.getRuntime().getGlobal("historianIngestStats", {})
    };
  }

  targetLogs(targetId = "default", kind = "", limit = 100) {
    if (!this.api.historianStore) {
      throw new HttpException({ error: "Historian backend is not initialized" }, 503);
    }
    const items = this.api.historianStore.getLogs(kind, Number(limit));
    return {
      targetId,
      kind,
      count: items.length,
      items
    };
  }

  async deleteByAttributePath(pathQuery: string, from?: string, to?: string) {
    if (!pathQuery) throw new HttpException({ error: "Query parameter 'path' is required" }, 400);
    const matches = this.api.resolvePathMatches(pathQuery);
    const result = await this.api.historianDeleteByMatches(matches, { from, to });
    if (result.status >= 400) this.throwResultError(result);
    return {
      ...(result.body as Record<string, unknown>),
      path: pathQuery
    };
  }

  async deleteByTemplateAttribute(templateId: string, attributeName: string, from?: string, to?: string) {
    if (!templateId || !attributeName) {
      throw new HttpException({ error: "templateId and attributeName are required" }, 400);
    }
    const state = this.api.assetStore.getState();
    const byId = new Map((state.assets || []).map((asset) => [asset.id, asset]));
    const getPath = (assetId: string): string => {
      const asset = byId.get(assetId);
      if (!asset) return "";
      const parts = [asset.name];
      let parentId = asset.parentId;
      while (parentId) {
        const parent = byId.get(parentId);
        if (!parent) break;
        parts.unshift(parent.name);
        parentId = parent.parentId;
      }
      return parts.join(".");
    };
    const pathMatches = [];
    for (const asset of state.assets || []) {
      if (!Array.isArray(asset.templateIds) || !asset.templateIds.includes(templateId)) continue;
      const path = `${getPath(asset.id)}.${attributeName}`;
      for (const item of this.api.resolvePathMatches(path)) pathMatches.push(item);
    }
    const dedup = [];
    const seen = new Set<string>();
    for (const m of pathMatches) {
      const key = `${m.assetId}:${m.attributeName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(m);
    }
    const result = await this.api.historianDeleteByMatches(dedup, { from, to });
    if (result.status >= 400) this.throwResultError(result);
    return {
      ...(result.body as Record<string, unknown>),
      templateId,
      attributeName
    };
  }
}
