import { Module } from "@nestjs/common";
import { RuntimeApiModule } from "../runtime-api.module";
import { NodeStatusController } from "./node-status.controller";
import { NodeStatusService } from "./node-status.service";

@Module({
  imports: [RuntimeApiModule],
  controllers: [NodeStatusController],
  providers: [NodeStatusService]
})
export class NodeStatusModule {}
