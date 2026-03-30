import { DynamicModule, Global, Module } from "@nestjs/common";
import type Runtime from "../runtime/Runtime";
import { RUNTIME_INSTANCE } from "./runtime-api.constants";
import { RuntimeApiService } from "./runtime-api.service";

@Global()
@Module({})
export class RuntimeApiModule {
  static register(runtime: Runtime): DynamicModule {
    return {
      module: RuntimeApiModule,
      providers: [
        { provide: RUNTIME_INSTANCE, useValue: runtime },
        RuntimeApiService
      ],
      exports: [RUNTIME_INSTANCE, RuntimeApiService]
    };
  }
}
