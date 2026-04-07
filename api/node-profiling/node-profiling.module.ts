import { Module } from "@nestjs/common";
import { RuntimeApiModule } from "../runtime-api.module";
import { NodeProfilingController } from "./node-profiling.controller";
import { NodeProfilingService } from "./node-profiling.service";

@Module({
  imports: [RuntimeApiModule],
  controllers: [NodeProfilingController],
  providers: [NodeProfilingService]
})
export class NodeProfilingModule {}
