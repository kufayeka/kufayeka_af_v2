import fs from "node:fs";
import path from "node:path";

export interface DbRuntimeConfig {
  enabled: boolean;
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    adminDatabase: string;
    schema: string;
    ssl: boolean;
    maxQueryRows: number;
  };
  tables: {
    historian: string;
    event: string;
  };
  queue: {
    historian: {
      enabled: boolean;
      batchSize: number;
      flushIntervalMs: number;
      maxQueue: number;
    };
    event: {
      enabled: boolean;
      batchSize: number;
      flushIntervalMs: number;
      maxQueue: number;
    };
  };
}

const DEFAULT_CONFIG: DbRuntimeConfig = {
  enabled: true,
  connection: {
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "af",
    adminDatabase: "postgres",
    schema: "public",
    ssl: false,
    maxQueryRows: 100000
  },
  tables: {
    historian: "af_historian",
    event: "af_event"
  },
  queue: {
    historian: {
      enabled: true,
      batchSize: 1000,
      flushIntervalMs: 250,
      maxQueue: 250000
    },
    event: {
      enabled: true,
      batchSize: 500,
      flushIntervalMs: 300,
      maxQueue: 100000
    }
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
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "require";
}

function resolveConfigPath(): string {
  const envPath = process.env.RUNTIME_DB_CONFIG;
  if (envPath && envPath.trim()) return path.resolve(envPath);

  const candidates = [
    path.resolve(process.cwd(), "config/db.config.json"),
    path.resolve(__dirname, "../config/db.config.json"),
    path.resolve(__dirname, "../../config/db.config.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function loadDbConfig(): DbRuntimeConfig {
  const configPath = resolveConfigPath();
  let fileConfig: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      fileConfig = toObject(JSON.parse(raw));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[runtime] db config parse warning: ${message}`);
    }
  }

  const connection = toObject(fileConfig.connection);
  const tables = toObject(fileConfig.tables);
  const queue = toObject(fileConfig.queue);
  const queueHistorian = toObject(queue.historian);
  const queueEvent = toObject(queue.event);

  const cfg: DbRuntimeConfig = {
    enabled: toBoolean(fileConfig.enabled, DEFAULT_CONFIG.enabled),
    connection: {
      host: String(connection.host ?? DEFAULT_CONFIG.connection.host),
      port: toPositiveInt(connection.port, DEFAULT_CONFIG.connection.port),
      user: String(connection.user ?? DEFAULT_CONFIG.connection.user),
      password: String(connection.password ?? DEFAULT_CONFIG.connection.password),
      database: String(connection.database ?? DEFAULT_CONFIG.connection.database),
      adminDatabase: String(connection.adminDatabase ?? DEFAULT_CONFIG.connection.adminDatabase),
      schema: String(connection.schema ?? DEFAULT_CONFIG.connection.schema),
      ssl: toBoolean(connection.ssl, DEFAULT_CONFIG.connection.ssl),
      maxQueryRows: toPositiveInt(connection.maxQueryRows, DEFAULT_CONFIG.connection.maxQueryRows)
    },
    tables: {
      historian: String(tables.historian ?? DEFAULT_CONFIG.tables.historian),
      event: String(tables.event ?? DEFAULT_CONFIG.tables.event)
    },
    queue: {
      historian: {
        enabled: toBoolean(queueHistorian.enabled, DEFAULT_CONFIG.queue.historian.enabled),
        batchSize: toPositiveInt(queueHistorian.batchSize, DEFAULT_CONFIG.queue.historian.batchSize),
        flushIntervalMs: toPositiveInt(queueHistorian.flushIntervalMs, DEFAULT_CONFIG.queue.historian.flushIntervalMs),
        maxQueue: toPositiveInt(queueHistorian.maxQueue, DEFAULT_CONFIG.queue.historian.maxQueue)
      },
      event: {
        enabled: toBoolean(queueEvent.enabled, DEFAULT_CONFIG.queue.event.enabled),
        batchSize: toPositiveInt(queueEvent.batchSize, DEFAULT_CONFIG.queue.event.batchSize),
        flushIntervalMs: toPositiveInt(queueEvent.flushIntervalMs, DEFAULT_CONFIG.queue.event.flushIntervalMs),
        maxQueue: toPositiveInt(queueEvent.maxQueue, DEFAULT_CONFIG.queue.event.maxQueue)
      }
    }
  };

  if (process.env.DB_HOST) cfg.connection.host = String(process.env.DB_HOST);
  if (process.env.DB_PORT) cfg.connection.port = toPositiveInt(process.env.DB_PORT, cfg.connection.port);
  if (process.env.DB_USER) cfg.connection.user = String(process.env.DB_USER);
  if (process.env.DB_PASSWORD) cfg.connection.password = String(process.env.DB_PASSWORD);
  if (process.env.DB_NAME) cfg.connection.database = String(process.env.DB_NAME);
  if (process.env.DB_ADMIN_NAME) cfg.connection.adminDatabase = String(process.env.DB_ADMIN_NAME);
  if (process.env.DB_SCHEMA) cfg.connection.schema = String(process.env.DB_SCHEMA);
  if (process.env.DB_SSL) cfg.connection.ssl = toBoolean(process.env.DB_SSL, cfg.connection.ssl);
  if (process.env.DB_ENABLED) cfg.enabled = toBoolean(process.env.DB_ENABLED, cfg.enabled);

  return cfg;
}

export function getDefaultDbConfig(): DbRuntimeConfig {
  return structuredClone(DEFAULT_CONFIG);
}
