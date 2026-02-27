import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import Runtime from "./Runtime";
import { filterSerializableGlobalEntries, isInternalGlobalKey } from "./globalStoreUtils";

interface PersistedGlobalRow {
  key: string;
  value: unknown;
}

function readPersistedRows(dbPath: string): PersistedGlobalRow[] {
  if (!fs.existsSync(dbPath)) return [];
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_values (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const rows = db
      .prepare(`SELECT key, value_json FROM global_values`)
      .all() as Array<{ key: string; value_json: string }>;
    const out: PersistedGlobalRow[] = [];
    for (const row of rows) {
      const key = String(row.key || "");
      if (!key || isInternalGlobalKey(key)) continue;
      try {
        out.push({ key, value: JSON.parse(row.value_json) });
      } catch {
        // Skip invalid JSON rows.
      }
    }
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runtime] global persistence load error: ${message}`);
    return [];
  } finally {
    db?.close();
  }
}

export function loadPersistedGlobalsIntoRuntime(runtime: Runtime, dbPathInput: string): number {
  const dbPath = path.resolve(dbPathInput);
  const rows = readPersistedRows(dbPath);
  for (const row of rows) {
    runtime.setGlobal(row.key, row.value);
  }
  return rows.length;
}

export function startGlobalValuePersistence(
  runtime: Runtime,
  options: { filePath: string; intervalMs?: number }
): { stop: () => void; flushNow: () => void } {
  const dbPath = path.resolve(options.filePath);
  const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_values (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const truncateStmt = db.prepare(`DELETE FROM global_values`);
  const insertStmt = db.prepare(`
    INSERT INTO global_values (key, value_json, updated_at)
    VALUES (?, ?, ?)
  `);

  let lastSavedRevision = -1;
  let isWriting = false;
  let hasPending = false;

  const flushNow = (): void => {
    if (isWriting) {
      hasPending = true;
      return;
    }
    const revision = runtime.getGlobalRevision();
    if (revision === lastSavedRevision) return;

    isWriting = true;
    try {
      const now = new Date().toISOString();
      const allEntries = runtime.getGlobalEntries();
      const rows = Object.entries(
        filterSerializableGlobalEntries(allEntries, { includeInternal: false })
      );
      const writeTx = db.transaction(() => {
        truncateStmt.run();
        for (const [key, value] of rows) {
          insertStmt.run(key, JSON.stringify(value), now);
        }
      });
      writeTx();
      lastSavedRevision = revision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runtime] global persistence write error: ${message}`);
    } finally {
      isWriting = false;
      if (hasPending) {
        hasPending = false;
        flushNow();
      }
    }
  };

  const timer = setInterval(flushNow, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      clearInterval(timer);
      db.close();
    },
    flushNow,
  };
}

