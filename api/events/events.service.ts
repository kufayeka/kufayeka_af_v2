import { HttpException, Injectable } from "@nestjs/common";
import { RuntimeApiService } from "../runtime-api.service";
import { getErrorMessage, parseBoolean, toJsonValueOrNull } from "../runtime-api.utils";

@Injectable()
export class EventsService {
  constructor(private readonly api: RuntimeApiService) {}

  async list(params: {
    pattern?: string;
    from?: string;
    to?: string;
    status?: string;
    severity?: string;
    limit?: string;
    offset?: string;
    sortBy?: string;
    sortDir?: string;
    context?: string;
  }) {
    try {
      const pattern = params.pattern || "*";
      const from = params.from || "*";
      const to = params.to || "*";
      const status = params.status || "*";
      const severity = params.severity || "*";
      const limit = Number(params.limit || 1000);
      const offset = Number(params.offset || 0);
      const sortBy = params.sortBy || "start_ts";
      const sortDir = params.sortDir || "desc";
      const contextFilters = params.context && params.context.trim() ? JSON.parse(params.context) : {};
      const result = await this.api.eventStore.query(pattern, from, to, status, contextFilters, {
        limit,
        offset,
        sortBy,
        sortDir,
        severity
      });
      return {
        count: result.rows.length,
        total: result.total,
        pattern,
        from,
        to,
        status,
        severity,
        sortBy: result.sortBy,
        sortDir: result.sortDir,
        limit: result.limit,
        offset: result.offset,
        rows: result.rows
      };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async range(params: { pattern?: string; from?: string; to?: string; status?: string; context?: string; limit?: string }) {
    try {
      const pattern = params.pattern || "*";
      const from = params.from || "*";
      const to = params.to || "*";
      const status = params.status || "*";
      const contextFilters = params.context && params.context.trim() ? JSON.parse(params.context) : {};
      const limit = Number(params.limit || 5000);
      const range = await this.api.getEventRange(pattern, from, to, status, contextFilters, { limit });
      return { pattern, from, to, status, ...range };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  meta() {
    return { provider: "postgresql", eventStore: this.api.eventStore.getMeta() };
  }

  async open(body: Record<string, unknown>) {
    try {
      const templateId = String(body.template_id || body.templateId || "").trim();
      if (templateId) {
        const row = await this.api.openEventFromTemplate({
          assetStore: this.api.assetStore,
          eventStore: this.api.eventStore,
          templateMap: this.api.eventTemplateMap,
          templateId,
          openOptions: {
            vars: body.vars && typeof body.vars === "object" ? (body.vars as Record<string, unknown>) : {},
            context: body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
            notes: String(body.notes_on_open || body.notes || ""),
            severity: String(body.severity || ""),
            ts: body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
            capturedDataOnOpen: toJsonValueOrNull(body.captured_data_on_open ?? body.capturedDataOnOpen)
          }
        });
        return { ok: true, row };
      }
      const row = await this.api.eventStore.open(
        String(body.event_path || body.path || ""),
        body.start_ts ? String(body.start_ts) : body.ts ? String(body.ts) : undefined,
        body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
        String(body.notes_on_open || body.notes || ""),
        String(body.severity || "other"),
        toJsonValueOrNull(body.captured_data_on_open ?? body.capturedDataOnOpen)
      );
      return { ok: true, row };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async close(body: Record<string, unknown>) {
    try {
      const templateId = String(body.template_id || body.templateId || "").trim();
      if (templateId) {
        const result = await this.api.closeEventFromTemplate({
          assetStore: this.api.assetStore,
          eventStore: this.api.eventStore,
          templateMap: this.api.eventTemplateMap,
          templateId,
          closeOptions: {
            id: body.id ? String(body.id) : undefined,
            vars: body.vars && typeof body.vars === "object" ? (body.vars as Record<string, unknown>) : {},
            pattern: body.pattern ? String(body.pattern) : body.event_path ? String(body.event_path) : undefined,
            context: body.context && typeof body.context === "object" ? (body.context as Record<string, unknown>) : {},
            notes: String(body.notes_on_close || body.notes || ""),
            severity: String(body.severity || ""),
            ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
            capturedDataOnClose: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
          }
        });
        return { ok: true, ...result };
      }

      if (parseBoolean(String(body.capture_auto ?? body.captureAuto ?? "false"), false)) {
        const rows = await this.api.eventStore.get(String(body.pattern || body.event_path || "*"), "*", "*", "open", {}, { limit: 5000 });
        const result = await this.api.closeEventsWithAutoCapture({
          assetStore: this.api.assetStore,
          eventStore: this.api.eventStore,
          templateMap: this.api.eventTemplateMap,
          rows,
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        return { ok: true, ...result };
      }

      const rows = await this.api.eventStore.get(String(body.pattern || body.event_path || "*"), "*", "*", "open", {}, { limit: 5000 });
      const templatedRows = rows.filter((row) => row.event_metadata && Object.keys(row.event_metadata).length > 0);
      if (templatedRows.length > 0) {
        const autoResult = await this.api.closeEventsWithAutoCapture({
          assetStore: this.api.assetStore,
          eventStore: this.api.eventStore,
          templateMap: this.api.eventTemplateMap,
          rows: templatedRows,
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        if (templatedRows.length === rows.length) return { ok: true, ...autoResult };
        const normalResult = await this.api.eventStore.close(
          String(body.pattern || body.event_path || "*"),
          body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          String(body.notes_on_close || body.notes || ""),
          toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        );
        return {
          ok: true,
          ...normalResult,
          closedCount: Number(normalResult.closedCount || 0) + autoResult.closedCount,
          ts: autoResult.ts || normalResult.ts
        };
      }

      const result = await this.api.eventStore.close(
        String(body.pattern || body.event_path || "*"),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || ""),
        toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
      );
      return { ok: true, ...result };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async closeById(body: Record<string, unknown>) {
    try {
      if (parseBoolean(String(body.capture_auto ?? body.captureAuto ?? "false"), false)) {
        const row = await this.api.eventStore.getById(String(body.id || ""));
        const result = row
          ? await this.api.closeEventsWithAutoCapture({
              assetStore: this.api.assetStore,
              eventStore: this.api.eventStore,
              templateMap: this.api.eventTemplateMap,
              rows: row.status === "open" ? [row] : [],
              notes: String(body.notes_on_close || body.notes || ""),
              ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
              explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
            })
          : {
              pattern: String(body.id || ""),
              closedCount: 0,
              ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : new Date().toISOString(),
              notes_on_close: String(body.notes_on_close || body.notes || ""),
              rows: []
            };
        return { ok: true, ...result };
      }

      const row = await this.api.eventStore.getById(String(body.id || ""));
      if (row && row.status === "open" && row.event_metadata && Object.keys(row.event_metadata).length > 0) {
        const result = await this.api.closeEventsWithAutoCapture({
          assetStore: this.api.assetStore,
          eventStore: this.api.eventStore,
          templateMap: this.api.eventTemplateMap,
          rows: [row],
          notes: String(body.notes_on_close || body.notes || ""),
          ts: body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
          explicitCaptured: toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
        });
        return { ok: true, ...result };
      }

      const result = await this.api.eventStore.closeById(
        String(body.id || ""),
        body.end_ts ? String(body.end_ts) : body.ts ? String(body.ts) : undefined,
        String(body.notes_on_close || body.notes || ""),
        toJsonValueOrNull(body.captured_data_on_close ?? body.capturedDataOnClose)
      );
      return { ok: true, ...result };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async acknowledgeById(body: Record<string, unknown>) {
    try {
      const result = await this.api.eventStore.acknowledgeById(
        String(body.id || ""),
        body.acknowledged_ts ? String(body.acknowledged_ts) : body.ts ? String(body.ts) : undefined
      );
      return { ok: true, ...result };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async deleteById(id: string) {
    try {
      const result = await this.api.eventStore.deleteById(id);
      return { ok: true, ...result };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }

  async deleteByPattern(params: { pattern?: string; status?: string; from?: string; to?: string; severity?: string }) {
    try {
      const pattern = params.pattern || "*";
      const status = params.status || "*";
      const from = params.from || "*";
      const to = params.to || "*";
      const severity = params.severity || "*";
      const result = await this.api.eventStore.deleteByPattern(pattern, status, from, to, severity);
      return { ok: true, ...result };
    } catch (error) {
      throw new HttpException({ error: getErrorMessage(error) }, 400);
    }
  }
}
