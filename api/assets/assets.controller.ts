import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query
} from "@nestjs/common";
import { AssetsService } from "./assets.service";
import { parseBoolean } from "../runtime-api.utils";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get(["", "system"])
  getSystem() {
    return this.assetsService.getSystem();
  }

  @Put(["", "system"])
  putSystem(@Body() body: unknown) {
    return this.assetsService.replaceSystem(body);
  }

  @Get("hierarchy")
  getHierarchy(@Query("populated") populatedRaw?: string) {
    const populated =
      populatedRaw === undefined
        ? true
        : populatedRaw === "1" || populatedRaw.toLowerCase() === "true" || populatedRaw.toLowerCase() === "yes";
    return this.assetsService.getHierarchy(populated);
  }

  @Get("query")
  query(@Query("path") pathQuery = "") {
    return this.assetsService.query(pathQuery);
  }

  @Post("find-asset-paths")
  findAssetPaths(@Body() body: Record<string, unknown>) {
    return this.assetsService.findAssetPaths(body || {});
  }

  @Get(["find", "find-by-value"])
  findByValue(
    @Query("path") pathQuery = "*.*.*",
    @Query("value") rawValue?: string,
    @Query("strict") strictRaw?: string
  ) {
    return this.assetsService.findByValue(pathQuery, rawValue, parseBoolean(strictRaw, false));
  }

  @Get("historian-tags")
  historianTags(@Query("path") pathQuery = "*.*.*") {
    return this.assetsService.historianTags(pathQuery);
  }

  @Get("value/*encodedPath")
  getValueByPath(@Param("encodedPath") encodedPath: string) {
    const pathQuery = this.assetsService.decodePath(encodedPath);
    return this.assetsService.getValueByPath(pathQuery);
  }

  @Put("value/*encodedPath")
  putValueByPath(@Param("encodedPath") encodedPath: string, @Body() body: Record<string, unknown>) {
    const pathQuery = this.assetsService.decodePath(encodedPath);
    return this.assetsService.putValueByPath(pathQuery, body || {});
  }

  @Post("values\\:batch")
  batchRead(@Body() body: { paths?: string[] }) {
    return this.assetsService.batchRead(body || {});
  }

  @Put("values\\:batch")
  batchWrite(@Body() body: { items?: Array<{ path: string; value: unknown }> }) {
    return this.assetsService.batchWrite(body || {});
  }
}
