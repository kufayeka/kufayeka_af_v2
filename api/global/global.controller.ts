import { Body, Controller, Delete, Get, Param, Put, Query } from "@nestjs/common";
import { parseBoolean } from "../runtime-api.utils";
import { GlobalService } from "./global.service";

@Controller("global")
export class GlobalController {
  constructor(private readonly globalService: GlobalService) {}

  @Get()
  list(@Query("includeInternal") includeInternalRaw?: string) {
    return this.globalService.list(parseBoolean(includeInternalRaw, false));
  }

  @Get("*keyPath")
  get(@Param("keyPath") keyPath: string) {
    return this.globalService.get(this.globalService.extractKey(keyPath));
  }

  @Put("*keyPath")
  put(@Param("keyPath") keyPath: string, @Body() body: Record<string, unknown>) {
    return this.globalService.put(this.globalService.extractKey(keyPath), body || {});
  }

  @Delete("*keyPath")
  delete(@Param("keyPath") keyPath: string) {
    return this.globalService.delete(this.globalService.extractKey(keyPath));
  }
}
