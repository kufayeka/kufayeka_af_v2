import { Injectable } from "@nestjs/common";
import { RuntimeApiService } from "../runtime-api.service";
import { Observable } from "rxjs";

@Injectable()
export class NodeStatusService {
  constructor(private readonly runtimeApi: RuntimeApiService) {}

  getAll() {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.isNodeStatusMonitoringEnabled(),
      revision: runtime.getNodeStatusRevision(),
      items: runtime.getNodeStatuses()
    };
  }

  getConfig() {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.isNodeStatusMonitoringEnabled()
    };
  }

  setConfig(enabled: unknown) {
    const runtime = this.runtimeApi.getRuntime();
    return {
      enabled: runtime.setNodeStatusMonitoringEnabled(enabled === true)
    };
  }

  stream(): Observable<{
    data: {
      enabled?: boolean;
      revision: number;
      nodeId?: string;
      status?: unknown;
      items?: Record<string, unknown>;
    };
  }> {
    const runtime = this.runtimeApi.getRuntime();
    return new Observable((subscriber) => {
      subscriber.next({
        data: {
          enabled: runtime.isNodeStatusMonitoringEnabled(),
          revision: runtime.getNodeStatusRevision(),
          items: runtime.getNodeStatuses()
        }
      });

      const unsubscribe = runtime.subscribeNodeStatus((event) => {
        subscriber.next({
          data: {
            revision: event.revision,
            nodeId: event.nodeId,
            status: event.status || undefined
          }
        });
      });

      return () => unsubscribe();
    });
  }
}
