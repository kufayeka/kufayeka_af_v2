import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import Runtime from "../Runtime";
import { filterSerializableGlobalEntries, isInternalGlobalKey } from "./globalStoreUtils";

interface PersistedGlobalRow {
  key: string;
  value_json: string;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_global_values (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function loadPersistedGlobalsIntoRuntime(runtime: Runtime, filePathInput: string): number {
  const filePath = path.resolve(filePathInput);
  if (!fs.existsSync(filePath)) return 0;
  let db: Database.Database | null = null;
  try {
    db = new Database(filePath, { fileMustExist: true });
    ensureTable(db);
    const rows = db.prepare("SELECT key, value_json FROM runtime_global_values").all() as PersistedGlobalRow[];
    let loaded = 0;
    for (const row of rows) {
      const key = String(row.key || "").trim();
      if (!key || isInternalGlobalKey(key)) continue;
      try {
        runtime.setGlobal(key, JSON.parse(String(row.value_json || "null")));
        loaded += 1;
      } catch {
        continue;
      }
    }
    return loaded;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runtime] global persistence load error: ${message}`);
    return 0;
  } finally {
    if (db) db.close();
  }
}

export function startGlobalValuePersistence(
  runtime: Runtime,
  options: { filePath: string; intervalMs?: number }
): { stop: () => void; flushNow: () => void } {
  const dbPath = path.resolve(options.filePath);
  const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureTable(db);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const truncateStmt = db.prepare("DELETE FROM runtime_global_values");
  const insertStmt = db.prepare(
    "INSERT INTO runtime_global_values (key, value_json, updated_at) VALUES (@key, @value_json, @updated_at)"
  );
  const replaceAllStmt = db.transaction((rows: Array<{ key: string; value_json: string; updated_at: string }>) => {
    truncateStmt.run();
    for (const row of rows) insertStmt.run(row);
  });

  let lastSavedRevision = -1;

  const flushNow = () => {
    const currentRevision = runtime.getGlobalRevision();
    if (currentRevision === lastSavedRevision) return;
    try {
      const allEntries = runtime.getGlobalEntries();
      const serializable = filterSerializableGlobalEntries(allEntries, { includeInternal: false });
      const nowIso = new Date().toISOString();
      const rows = Object.entries(serializable).map(([key, value]) => ({
        key,
        value_json: JSON.stringify(value),
        updated_at: nowIso
      }));
      replaceAllStmt(rows);
      lastSavedRevision = currentRevision;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runtime] global persistence write error: ${message}`);
    }
  };

  const timer = setInterval(() => {
    flushNow();
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      clearInterval(timer);
      db.close();
    },
    flushNow
  };
}
