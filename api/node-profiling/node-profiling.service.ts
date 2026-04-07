import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import { RuntimeApiService } from "../runtime-api.service";

@Injectable()
export class NodeProfilingService {
  constructor(private readonly runtimeApi: RuntimeApiService) {}

  getAll() {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.isNodeProfilingEnabled(),
      revision: runtime.getNodeProfilingRevision(),
      items: runtime.getNodeProfilings()
    };
  }

  getConfig() {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.isNodeProfilingEnabled()
    };
  }

  setConfig(enabled: unknown) {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.setNodeProfilingEnabled(enabled === true)
    };
  }

  stream(): Observable<{
    data: {
      enabled?: boolean;
      revision: number;
      nodeId?: string;
      profiling?: unknown;
      items?: Record<string, unknown>;
    };
  }> {
    const runtime = this.runtimeApi.getRuntime();
    return new Observable((subscriber) => {
      subscriber.next({
        data: {
          enabled: runtime.isNodeProfilingEnabled(),
          revision: runtime.getNodeProfilingRevision(),
          items: runtime.getNodeProfilings()
        }
      });

      const unsubscribe = runtime.subscribeNodeProfiling((event) => {
        subscriber.next({
          data: {
            revision: event.revision,
            nodeId: event.nodeId,
            profiling: event.profiling || undefined
          }
        });
      });

      return () => unsubscribe();
    });
  }
}
