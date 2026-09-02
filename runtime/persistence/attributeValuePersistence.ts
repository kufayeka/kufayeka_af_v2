import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { normalizeAssetSection } from "../asset/AssetStoreFactory";
import type { AssetDefinition, AssetStore } from "../core/runtimeTypes";
import type Runtime from "../Runtime";

const PERSISTED_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS attribute_values (
    asset_id TEXT NOT NULL,
    attribute_name TEXT NOT NULL,
    value_json TEXT NOT NULL,
    ts TEXT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (asset_id, attribute_name)
  );
`;

interface PersistedAttributeItem {
  assetId: string;
  attributeName: string;
  value: unknown;
  ts?: string;
}

export interface PersistenceStatement {
  run(...params: unknown[]): unknown;
}

export interface PersistenceDb {
  pragma(source: string): unknown;
  exec(source: string): unknown;
  prepare(source: string): PersistenceStatement;
  transaction(fn: () => void): () => void;
  close(): unknown;
}

export interface AttributeValuePersistenceDeps {
  db?: PersistenceDb;
}

function getTemplateAttributeNamesByAssetId(state: ReturnType<AssetStore["getState"]>): Map<string, Set<string>> {
  const templateById = new Map((state.attributeTemplates || []).map((template) => [template.id, template]));
  const out = new Map<string, Set<string>>();
  for (const asset of state.assets || []) {
    const names = new Set<string>(Object.keys(asset.attributes || {}));
    for (const templateId of asset.templateIds || []) {
      const template = templateById.get(templateId);
      if (!template) continue;
      for (const attr of template.attributes || []) {
        if (attr.enabled === false) continue;
        names.add(attr.name);
      }
    }
    out.set(asset.id, names);
  }
  return out;
}

export function loadPersistedValuesIntoAssets(
  assetsInput: unknown,
  dbPathInput: string
): { assets: ReturnType<typeof normalizeAssetSection>; loadedCount: number } {
  const assets = normalizeAssetSection(assetsInput);
  const dbPath = path.resolve(dbPathInput);
  if (!fs.existsSync(dbPath)) return { assets, loadedCount: 0 };

  const itemsByAssetId = new Map<string, PersistedAttributeItem[]>();
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    const rows = db
      .prepare(
        `SELECT asset_id, attribute_name, value_json, ts
         FROM attribute_values`
      )
      .all() as Array<{ asset_id: string; attribute_name: string; value_json: string; ts: string | null }>;
    for (const row of rows) {
      const assetId = String(row.asset_id || "");
      const attributeName = String(row.attribute_name || "");
      if (!assetId || !attributeName) continue;
      if (!itemsByAssetId.has(assetId)) itemsByAssetId.set(assetId, []);
      let value: unknown = null;
      try {
        value = JSON.parse(row.value_json);
      } catch {
        value = null;
      }
      itemsByAssetId.get(assetId)?.push({
        assetId,
        attributeName,
        value,
        ts: row.ts || undefined
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runtime] attribute persistence load error: ${message}`);
    return { assets, loadedCount: 0 };
  } finally {
    db?.close();
  }

  const allowedAttributeNamesByAssetId = getTemplateAttributeNamesByAssetId(assets);
  let loadedCount = 0;
  const nextAssets: AssetDefinition[] = assets.assets.map((asset) => {
    const persistedItems = itemsByAssetId.get(asset.id) || [];
    if (persistedItems.length === 0) return asset;
    const allowedNames = allowedAttributeNamesByAssetId.get(asset.id) || new Set<string>();
    const nextAttributes = { ...(asset.attributes || {}) };
    for (const item of persistedItems) {
      if (!allowedNames.has(item.attributeName)) continue;
      nextAttributes[item.attributeName] = {
        value: item.value,
        ts: item.ts || new Date().toISOString()
      };
      loadedCount += 1;
    }
    return { ...asset, attributes: nextAttributes };
  });

  return { assets: { ...assets, assets: nextAssets }, loadedCount };
}

export function startAttributeValuePersistence(
  runtime: Runtime,
  options: { filePath: string; intervalMs?: number },
  deps: AttributeValuePersistenceDeps = {}
): { stop: () => void; flushNow: () => void } {
  const dbPath = path.resolve(options.filePath);
  const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
  const store = runtime.getProgramComposition()?.assetStore;
  if (!store) {
    return { stop: () => {}, flushNow: () => {} };
  }
  let db: PersistenceDb;
  if (deps.db) {
    db = deps.db;
  } else {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
  }
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(PERSISTED_TABLE_SQL);
  const upsertStmt = db.prepare(`
    INSERT INTO attribute_values (asset_id, attribute_name, value_json, ts, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, attribute_name) DO UPDATE SET
      value_json = excluded.value_json,
      ts = excluded.ts,
      updated_at = excluded.updated_at
  `);

  // AOF-style: accumulate only the attributes that actually changed since the
  // last flush, streamed in as writes happen, instead of polling the whole
  // asset store and re-dumping every tag on every cycle.
  const dirty = new Map<string, PersistedAttributeItem>();
  const unsubscribe = store.subscribe((meta) => {
    if (meta?.change?.type !== "attribute.set") return;
    for (const change of meta.change.changes || []) {
      if (change.kind !== "attribute" || !change.assetId || !change.attributeName) continue;
      dirty.set(`${change.assetId}:${change.attributeName}`, {
        assetId: change.assetId,
        attributeName: change.attributeName,
        value: change.value,
        ts: change.ts
      });
    }
  });

  let isWriting = false;
  let hasPending = false;

  const flushNow = (): void => {
    if (dirty.size === 0) return;
    if (isWriting) {
      hasPending = true;
      return;
    }
    isWriting = true;
    const rows = Array.from(dirty.values());
    dirty.clear();
    try {
      const now = new Date().toISOString();
      const writeTx = db.transaction(() => {
        for (const row of rows) {
          upsertStmt.run(row.assetId, row.attributeName, JSON.stringify(row.value ?? null), row.ts || null, now);
        }
      });
      writeTx();
    } catch (error) {
      // Merge the failed rows back in (unless a newer value for the same key
      // has arrived meanwhile, which should win) so the next tick retries
      // instead of silently losing them.
      for (const row of rows) {
        const key = `${row.assetId}:${row.attributeName}`;
        if (!dirty.has(key)) dirty.set(key, row);
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runtime] attribute persistence write error: ${message}`);
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
      unsubscribe();
      clearInterval(timer);
      flushNow();
      db.close();
    },
    flushNow
  };
}
