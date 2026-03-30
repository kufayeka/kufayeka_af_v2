import { HttpException, Injectable } from "@nestjs/common";
import {
  filterSerializableGlobalEntries,
  isInternalGlobalKey,
  toSerializableJsonValue
} from "../../runtime/globalStoreUtils";
import { RuntimeApiService } from "../runtime-api.service";

@Injectable()
export class GlobalService {
  constructor(private readonly api: RuntimeApiService) {}

  list(includeInternal: boolean) {
    const data = filterSerializableGlobalEntries(this.api.getRuntime().getGlobalEntries(), { includeInternal });
    return { data };
  }

  extractKey(keyPath: string): string {
    const key = decodeURIComponent(String(keyPath || "").trim());
    if (!key) throw new HttpException({ error: "Route not found" }, 404);
    if (isInternalGlobalKey(key)) throw new HttpException({ error: `Key "${key}" is reserved` }, 403);
    return key;
  }

  get(key: string) {
    const runtime = this.api.getRuntime();
    if (!runtime.hasGlobal(key)) {
      throw new HttpException({ error: `Key "${key}" not found` }, 404);
    }
    const serializable = toSerializableJsonValue(runtime.getGlobal(key));
    if (!serializable.ok) {
      throw new HttpException({ error: `Key "${key}" is not JSON serializable: ${serializable.error}` }, 409);
    }
    return { key, value: serializable.value };
  }

  put(key: string, body: Record<string, unknown>) {
    if (!Object.prototype.hasOwnProperty.call(body, "value")) {
      throw new HttpException({ error: "Body must include a 'value' field" }, 400);
    }
    const serializable = toSerializableJsonValue(body.value);
    if (!serializable.ok) {
      throw new HttpException({ error: `Value is not JSON serializable: ${serializable.error}` }, 400);
    }
    const value = this.api.getRuntime().setGlobal(key, serializable.value);
    this.api.flushGlobalPersistence();
    return { key, value };
  }

  delete(key: string) {
    const deleted = this.api.getRuntime().deleteGlobal(key);
    this.api.flushGlobalPersistence();
    return { key, deleted };
  }
}
