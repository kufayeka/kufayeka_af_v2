import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { normalizeAssetSection } from "./assetFramework";
import type { AssetDefinition, AssetStore } from "./types";
import type Runtime from "./Runtime";

interface PersistedAttributeItem {
  assetId: string;
  attributeName: string;
  value: unknown;
  ts?: string;
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

function toAttributeValue(value: unknown): { value: unknown; ts?: string } {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) {
    const typed = value as { value: unknown; ts?: unknown };
    return {
      value: typed.value,
      ts: typeof typed.ts === "string" ? typed.ts : undefined
    };
  }
  return { value, ts: undefined };
}

function collectPersistedItems(state: ReturnType<AssetStore["getState"]>): PersistedAttributeItem[] {
  const items: PersistedAttributeItem[] = [];
  for (const asset of state.assets || []) {
    for (const [attributeName, raw] of Object.entries(asset.attributes || {})) {
      const typed = toAttributeValue(raw);
      items.push({
        assetId: asset.id,
        attributeName,
        value: typed.value,
        ts: typed.ts
      });
    }
  }
  return items;
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
  options: { filePath: string; intervalMs?: number }
): { stop: () => void; flushNow: () => void } {
  const dbPath = path.resolve(options.filePath);
  const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
  const store = runtime.getGlobal<AssetStore | undefined>("assetStorage");
  if (!store) {
    return { stop: () => {}, flushNow: () => {} };
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS attribute_values (
      asset_id TEXT NOT NULL,
      attribute_name TEXT NOT NULL,
      value_json TEXT NOT NULL,
      ts TEXT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (asset_id, attribute_name)
    );
  `);
  const truncateStmt = db.prepare(`DELETE FROM attribute_values`);
  const insertStmt = db.prepare(`
    INSERT INTO attribute_values (asset_id, attribute_name, value_json, ts, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let lastSavedRevision = -1;
  let isWriting = false;
  let hasPending = false;

  const flushNow = (): void => {
    if (isWriting) {
      hasPending = true;
      return;
    }
    const revision = store.getRevision();
    if (revision === lastSavedRevision) return;

    isWriting = true;
    try {
      const state = store.getState();
      const now = new Date().toISOString();
      const rows = collectPersistedItems(state);
      const writeTx = db.transaction(() => {
        truncateStmt.run();
        for (const row of rows) {
          insertStmt.run(
            row.assetId,
            row.attributeName,
            JSON.stringify(row.value ?? null),
            row.ts || null,
            now
          );
        }
      });
      writeTx();
      lastSavedRevision = revision;
    } catch (error) {
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
      clearInterval(timer);
      db.close();
    },
    flushNow
  };
}
