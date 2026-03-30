import { Controller, Delete, Get, Query } from "@nestjs/common";
import { HistorianService } from "./historian.service";

@Controller("historian")
export class HistorianController {
  constructor(private readonly historianService: HistorianService) {}

  @Get("raw")
  raw(
    @Query("path") path?: string,
    @Query("time") time?: string,
    @Query("order") order?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string
  ) {
    return this.historianService.byPath("raw", { path, time, order, from, to, limit });
  }

  @Get("range")
  range(
    @Query("path") path?: string,
    @Query("time") time?: string,
    @Query("order") order?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("bucketMs") bucketMs?: string,
    @Query("agg") agg?: string
  ) {
    return this.historianService.byPath("range", { path, time, order, from, to, limit, bucketMs, agg });
  }

  @Get("last")
  last(@Query("path") path?: string, @Query("time") time?: string) {
    return this.historianService.byPath("last", { path, time });
  }

  @Get("first")
  first(@Query("path") path?: string, @Query("time") time?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.historianService.byPath("first", { path, time, from, to });
  }

  @Get("targets")
  targets() {
    return this.historianService.targets();
  }

  @Get("target-metrics")
  targetMetrics(@Query("targetId") targetId?: string) {
    return this.historianService.targetMetrics(targetId || "default");
  }

  @Get("target-logs")
  targetLogs(@Query("targetId") targetId?: string, @Query("kind") kind?: string, @Query("limit") limit?: string) {
    return this.historianService.targetLogs(targetId || "default", kind || "", Number(limit || 100));
  }

  @Delete("delete-attribute")
  deleteAttribute(@Query("path") path?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return this.historianService.deleteByAttributePath(path || "", from, to);
  }

  @Delete("delete-template-attribute")
  deleteTemplateAttribute(
    @Query("templateId") templateId?: string,
    @Query("attributeName") attributeName?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.historianService.deleteByTemplateAttribute(templateId || "", attributeName || "", from, to);
  }
}
