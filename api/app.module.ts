import { DynamicModule, Module } from "@nestjs/common";
import type Runtime from "../runtime/Runtime";
import { AssetsModule } from "./assets/assets.module";
import { DbModule } from "./db/db.module";
import { DocsModule } from "./docs/docs.module";
import { EventsModule } from "./events/events.module";
import { GlobalApiModule } from "./global/global.module";
import { HistorianModule } from "./historian/historian.module";
import { RuntimeApiModule } from "./runtime-api.module";

@Module({})
export class AppModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: AppModule,
      imports: [
        RuntimeApiModule.register(runtime),
        AssetsModule,
        GlobalApiModule,
        HistorianModule,
        EventsModule,
        DbModule,
        DocsModule
      ]
    };
  }
}
