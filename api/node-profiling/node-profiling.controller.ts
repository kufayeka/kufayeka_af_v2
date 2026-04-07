import { Body, Controller, Get, Put, Sse } from "@nestjs/common";
import { NodeProfilingService } from "./node-profiling.service";

@Controller("node-profiling")
export class NodeProfilingController {
  constructor(private readonly nodeProfilingService: NodeProfilingService) {}

  @Get()
  getAll() {
    return this.nodeProfilingService.getAll();
  }

  @Get("config")
  getConfig() {
    return this.nodeProfilingService.getConfig();
  }

  @Put("config")
  setConfig(@Body() body: { enabled?: boolean }) {
    return this.nodeProfilingService.setConfig(body?.enabled);
  }

  @Sse("stream")
  stream() {
    return this.nodeProfilingService.stream();
  }
}
