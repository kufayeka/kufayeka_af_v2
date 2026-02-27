import fs from "node:fs";
import path from "node:path";

export interface HistorianRuntimeConfig {
  enabled: boolean;
  udp: {
    host: string;
    port: number;
  };
  timescale: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    adminDatabase: string;
    schema: string;
    table: string;
    ssl: boolean;
    chunkIntervalHours: number;
    maxQueryRows: number;
    ingestBatchSize: number;
  };
}

const DEFAULT_CONFIG: HistorianRuntimeConfig = {
  enabled: true,
  udp: {
    host: "0.0.0.0",
    port: 9900
  },
  timescale: {
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "af",
    adminDatabase: "postgres",
    schema: "public",
    table: "af_historian",
    ssl: false,
    chunkIntervalHours: 12,
    maxQueryRows: 100000,
    ingestBatchSize: 1000
  }
};

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function resolveConfigPath(): string {
  const envPath = process.env.RUNTIME_HISTORIAN_CONFIG;
  if (envPath && envPath.trim()) return path.resolve(envPath);
  return path.resolve(__dirname, "../config/historian.config.json");
}

export function loadHistorianConfig(): HistorianRuntimeConfig {
  const configPath = resolveConfigPath();
  let fileConfig: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      fileConfig = toObject(JSON.parse(raw));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[runtime] historian config parse warning: ${message}`);
    }
  }

  const udpFile = toObject(fileConfig.udp);
  const timescaleFile = toObject(fileConfig.timescale);
  const merged: HistorianRuntimeConfig = {
    enabled: toBoolean(fileConfig.enabled, DEFAULT_CONFIG.enabled),
    udp: {
      host: String(udpFile.host ?? DEFAULT_CONFIG.udp.host),
      port: toPositiveInt(udpFile.port, DEFAULT_CONFIG.udp.port)
    },
    timescale: {
      host: String(timescaleFile.host ?? DEFAULT_CONFIG.timescale.host),
      port: toPositiveInt(timescaleFile.port, DEFAULT_CONFIG.timescale.port),
      user: String(timescaleFile.user ?? DEFAULT_CONFIG.timescale.user),
      password: String(timescaleFile.password ?? DEFAULT_CONFIG.timescale.password),
      database: String(timescaleFile.database ?? DEFAULT_CONFIG.timescale.database),
      adminDatabase: String(timescaleFile.adminDatabase ?? DEFAULT_CONFIG.timescale.adminDatabase),
      schema: String(timescaleFile.schema ?? DEFAULT_CONFIG.timescale.schema),
      table: String(timescaleFile.table ?? DEFAULT_CONFIG.timescale.table),
      ssl: toBoolean(timescaleFile.ssl, DEFAULT_CONFIG.timescale.ssl),
      chunkIntervalHours: toPositiveInt(timescaleFile.chunkIntervalHours, DEFAULT_CONFIG.timescale.chunkIntervalHours),
      maxQueryRows: toPositiveInt(timescaleFile.maxQueryRows, DEFAULT_CONFIG.timescale.maxQueryRows),
      ingestBatchSize: toPositiveInt(timescaleFile.ingestBatchSize, DEFAULT_CONFIG.timescale.ingestBatchSize)
    }
  };

  if (process.env.HISTORIAN_UDP_HOST) merged.udp.host = String(process.env.HISTORIAN_UDP_HOST);
  if (process.env.HISTORIAN_UDP_PORT) merged.udp.port = toPositiveInt(process.env.HISTORIAN_UDP_PORT, merged.udp.port);
  if (process.env.HISTORIAN_DB_HOST) merged.timescale.host = String(process.env.HISTORIAN_DB_HOST);
  if (process.env.HISTORIAN_DB_PORT) merged.timescale.port = toPositiveInt(process.env.HISTORIAN_DB_PORT, merged.timescale.port);
  if (process.env.HISTORIAN_DB_USER) merged.timescale.user = String(process.env.HISTORIAN_DB_USER);
  if (process.env.HISTORIAN_DB_PASSWORD) merged.timescale.password = String(process.env.HISTORIAN_DB_PASSWORD);
  if (process.env.HISTORIAN_DB_NAME) merged.timescale.database = String(process.env.HISTORIAN_DB_NAME);
  if (process.env.HISTORIAN_DB_ADMIN_NAME) merged.timescale.adminDatabase = String(process.env.HISTORIAN_DB_ADMIN_NAME);
  if (process.env.HISTORIAN_DB_SCHEMA) merged.timescale.schema = String(process.env.HISTORIAN_DB_SCHEMA);
  if (process.env.HISTORIAN_DB_TABLE) merged.timescale.table = String(process.env.HISTORIAN_DB_TABLE);
  if (process.env.HISTORIAN_DB_SSL) merged.timescale.ssl = toBoolean(process.env.HISTORIAN_DB_SSL, merged.timescale.ssl);
  if (process.env.HISTORIAN_ENABLED) merged.enabled = toBoolean(process.env.HISTORIAN_ENABLED, merged.enabled);

  return merged;
}
