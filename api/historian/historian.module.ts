import { Module } from "@nestjs/common";
import { HistorianController } from "./historian.controller";
import { HistorianService } from "./historian.service";

@Module({
  controllers: [HistorianController],
  providers: [HistorianService]
})
export class HistorianModule {}
