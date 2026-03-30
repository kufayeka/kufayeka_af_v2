import { Body, Controller, Delete, Get, Post, Query } from "@nestjs/common";
import { EventsService } from "./events.service";

@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(
    @Query("pattern") pattern?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
    @Query("severity") severity?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortDir") sortDir?: string,
    @Query("context") context?: string
  ) {
    return this.eventsService.list({ pattern, from, to, status, severity, limit, offset, sortBy, sortDir, context });
  }

  @Get("range")
  range(
    @Query("pattern") pattern?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
    @Query("context") context?: string,
    @Query("limit") limit?: string
  ) {
    return this.eventsService.range({ pattern, from, to, status, context, limit });
  }

  @Get("meta")
  meta() {
    return this.eventsService.meta();
  }

  @Post("open")
  open(@Body() body: Record<string, unknown>) {
    return this.eventsService.open(body || {});
  }

  @Post("close")
  close(@Body() body: Record<string, unknown>) {
    return this.eventsService.close(body || {});
  }

  @Post("close-id")
  closeById(@Body() body: Record<string, unknown>) {
    return this.eventsService.closeById(body || {});
  }

  @Post("ack-id")
  acknowledgeById(@Body() body: Record<string, unknown>) {
    return this.eventsService.acknowledgeById(body || {});
  }

  @Delete("by-id")
  deleteById(@Query("id") id?: string) {
    return this.eventsService.deleteById(String(id || ""));
  }

  @Delete()
  deleteByPattern(
    @Query("pattern") pattern?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("severity") severity?: string
  ) {
    return this.eventsService.deleteByPattern({ pattern, status, from, to, severity });
  }
}
