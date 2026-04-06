import { Body, Controller, Get, Put, Sse } from "@nestjs/common";
import { NodeStatusService } from "./node-status.service";

@Controller("node-status")
export class NodeStatusController {
  constructor(private readonly nodeStatusService: NodeStatusService) {}

  @Get()
  getAll() {
    return this.nodeStatusService.getAll();
  }

  @Get("config")
  getConfig() {
    return this.nodeStatusService.getConfig();
  }

  @Put("config")
  setConfig(@Body() body: { enabled?: boolean }) {
    return this.nodeStatusService.setConfig(body?.enabled);
  }

  @Sse("stream")
  stream() {
    return this.nodeStatusService.stream();
  }
}
