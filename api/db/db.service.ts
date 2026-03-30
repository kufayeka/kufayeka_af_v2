import { HttpException, Injectable } from "@nestjs/common";
import { RuntimeApiService } from "../runtime-api.service";
import { getErrorMessage } from "../runtime-api.utils";

@Injectable()
export class DbService {
  constructor(private readonly api: RuntimeApiService) {}

  getConfig() {
    if (!this.api.dbConnectionManager) {
      throw new HttpException({ error: "DB connection manager is not initialized" }, 503);
    }
    return {
      config: this.api.dbConnectionManager.getConfig(),
      metrics: this.api.dbConnectionManager.getMetrics()
    };
  }

  async testConnection() {
    if (!this.api.dbConnectionManager) {
      throw new HttpException({ error: "DB connection manager is not initialized" }, 503);
    }
    const result = await this.api.dbConnectionManager.testConnection();
    if (!result.ok) throw new HttpException(result, 502);
    return result;
  }

  async executeSql(body: { sql?: unknown }) {
    if (!this.api.dbConnectionManager) {
      throw new HttpException({ error: "DB connection manager is not initialized" }, 503);
    }
    try {
      const sql = String(body.sql || "");
      const result = await this.api.dbConnectionManager.executeSql(sql);
      return { ok: true, ...result };
    } catch (error: unknown) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }
}
