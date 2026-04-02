import { HttpException, Injectable } from "@nestjs/common";
import { RuntimeApiService } from "../runtime-api.service";

type RuntimeProgramLifecycle = {
  reloadFromDisk?: () => Promise<{
    ok: boolean;
    programPath: string;
    reloadedAt: string;
    flowCount: number;
  }>;
  getStatus?: () => Record<string, unknown>;
};

@Injectable()
export class ProgramService {
  constructor(private readonly api: RuntimeApiService) {}

  getStatus() {
    const runtime = this.api.getRuntime();
    const lifecycle = runtime.getGlobal<RuntimeProgramLifecycle | null>("__runtime.programLifecycle", null);
    const composition = runtime.getProgramComposition();
    return {
      ok: true,
      lifecycle: lifecycle?.getStatus ? lifecycle.getStatus() : null,
      composition: composition
        ? {
            flowCount: composition.flowDefinitionsById.size,
            eventTemplateCount: composition.eventTemplatesById.size,
            scriptTemplateCount: composition.scriptTemplatesById.size,
            triggerTemplateCount: composition.triggerTemplates.length
          }
        : null
    };
  }

  async reloadFromDisk() {
    const runtime = this.api.getRuntime();
    const lifecycle = runtime.getGlobal<RuntimeProgramLifecycle | null>("__runtime.programLifecycle", null);
    if (!lifecycle?.reloadFromDisk) {
      throw new HttpException({ error: "Runtime program lifecycle reload is not available" }, 503);
    }
    return await lifecycle.reloadFromDisk();
  }
}
