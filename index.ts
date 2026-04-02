import Runtime from "./runtime/Runtime";
import createApiServer from "./api/createApiServer";
import { loadProgramFromFile, startProgram } from "./runtime/program/ProgramEngine";
import {
  loadPersistedValuesIntoAssets,
  startAttributeValuePersistence
} from "./runtime/persistence/attributeValuePersistence";
import {
  loadPersistedGlobalsIntoRuntime,
  startGlobalValuePersistence
} from "./runtime/persistence/globalValuePersistence";
import path from "node:path";
import { computeTagID } from "./runtime/historian/HistorianBridgeFactory";
import { loadDbConfig } from "./runtime/db/dbConfig";
import { createDbConnectionManager } from "./runtime/db/dbConnectionManager";
import type { AssetStore, AssetHierarchyNode } from "./runtime/core/runtimeTypes";
import type { ProgramDefinition } from "./runtime/core/runtimeTypes";

function mergeProgramAssetsPreserveLiveValues(
  incomingAssets: ProgramDefinition["assets"],
  liveAssets: AssetStore["getState"] extends () => infer T ? T : never
): ProgramDefinition["assets"] {
  const incoming =
    incomingAssets && typeof incomingAssets === "object"
      ? (incomingAssets as {
          assets?: Array<{ id?: unknown; attributes?: Record<string, unknown> }>;
          attributeTemplates?: unknown[];
          historians?: unknown[];
        })
      : {};
  const live =
    liveAssets && typeof liveAssets === "object"
      ? (liveAssets as {
          assets?: Array<{ id?: unknown; attributes?: Record<string, unknown> }>;
          attributeTemplates?: unknown[];
          historians?: unknown[];
        })
      : {};

  const liveAttributesByAssetId = new Map<string, Record<string, unknown>>();
  for (const asset of live.assets || []) {
    const assetId = String(asset?.id || "").trim();
    if (!assetId) continue;
    liveAttributesByAssetId.set(assetId, { ...((asset.attributes || {}) as Record<string, unknown>) });
  }

  return {
    ...incoming,
    assets: (incoming.assets || []).map((asset) => {
      const assetId = String(asset?.id || "").trim();
      return {
        ...(asset as Record<string, unknown>),
        attributes: liveAttributesByAssetId.get(assetId) || {}
      };
    }),
    attributeTemplates: Array.isArray(incoming.attributeTemplates) ? incoming.attributeTemplates : [],
    historians: Array.isArray(incoming.historians) ? incoming.historians : []
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bootstrap(): Promise<void> {
  const rt = new Runtime({
    maxInflightPerNode: 1,
    maxQueuePerNode: 2000,
    nodeExecutionTimeoutMs: Number(process.env.RUNTIME_NODE_TIMEOUT_MS || 30000),
  });

  const programPath = path.resolve(__dirname, "../programs/main.af.json");
  const dbConfig = loadDbConfig();
  const dbConnectionManager = dbConfig.enabled
    ? await createDbConnectionManager(dbConfig)
    : null;
  rt.setGlobal("dbConnectionManager", dbConnectionManager);
  rt.setGlobal("dbConfig", dbConfig);
  rt.setGlobal("historianStore", dbConnectionManager);
  const globalValueStorePath = path.resolve(__dirname, "../data/global-values.sqlite");
  const loadedGlobalCount = loadPersistedGlobalsIntoRuntime(
    rt,
    process.env.RUNTIME_GLOBAL_VALUES_PATH || globalValueStorePath
  );
  const { absolutePath, program } = loadProgramFromFile(programPath);
  const attributeValueStorePath = path.resolve(
    __dirname,
    "../data/attribute-values.sqlite"
  );
  const { assets: seededAssets, loadedCount } = loadPersistedValuesIntoAssets(
    program.assets || {},
    process.env.RUNTIME_ATTRIBUTE_VALUES_PATH || attributeValueStorePath
  );
  const programWithPersistedValues = { ...program, assets: seededAssets };
  console.log(`Program loaded: ${absolutePath}`);
  console.log(`[runtime] global persistence seed loaded: ${loadedGlobalCount}`);
  console.log(`[runtime] attribute persistence seed loaded: ${loadedCount}`);
  let currentStopProgram: () => void = () => {};
  let currentAssetStoreUnsubscribe: () => void = () => {};
  const tagToPath = new Map<number, string>();

  const rebuildTagPathMap = (assetStore?: AssetStore): void => {
    tagToPath.clear();
    if (!assetStore) return;
    const nodes = assetStore.getHierarchy({ populateAttributes: true });
    const stack: AssetHierarchyNode[] = [...nodes];
    while (stack.length > 0) {
      const node = stack.pop() as AssetHierarchyNode;
      for (const child of node.children || []) stack.push(child);
      for (const attr of node.effectiveAttributes || []) {
        const fullPath = `${node.path}.${attr.name}`;
        const tagId = computeTagID(node.id, attr.name);
        tagToPath.set(tagId, fullPath);
      }
    }
  };

  const attachProgramAssetObservers = (assetStore?: AssetStore): void => {
    currentAssetStoreUnsubscribe();
    rebuildTagPathMap(assetStore);
    currentAssetStoreUnsubscribe = assetStore ? assetStore.subscribe(() => rebuildTagPathMap(assetStore)) : () => {};
  };

  const startLoadedProgram = (nextProgram: ProgramDefinition): void => {
    currentStopProgram = startProgram(rt, nextProgram);
    const nextComposition = rt.getProgramComposition();
    if (!nextComposition) {
      throw new Error("Program composition failed to initialize");
    }
    attachProgramAssetObservers(nextComposition.assetStore as AssetStore | undefined);
  };

  const stopLoadedProgram = async (): Promise<void> => {
    const previousComposition = rt.getProgramComposition();
    currentAssetStoreUnsubscribe();
    currentAssetStoreUnsubscribe = () => {};
    currentStopProgram();
    currentStopProgram = () => {};

    const historianBridge = previousComposition?.services.historian.getBridge();
    if (historianBridge?.close) {
      try {
        historianBridge.close();
      } catch (error) {
        console.error("[runtime] historianBridge close error:", getErrorMessage(error));
      }
    }

    const eventStore = previousComposition?.eventStore as { shutdown?: () => void | Promise<void> } | undefined;
    if (eventStore?.shutdown) {
      try {
        await Promise.resolve(eventStore.shutdown());
      } catch (error) {
        console.error("[runtime] eventStore shutdown error:", getErrorMessage(error));
      }
    }

    rt.resetProgramState();
  };

  startLoadedProgram(programWithPersistedValues);

  rt.setGlobal("__runtime.programLifecycle", {
    getStatus: () => {
      const composition = rt.getProgramComposition();
      return {
        programPath: absolutePath,
        loadedAt: new Date().toISOString(),
        flowCount: composition?.flowDefinitionsById.size || 0,
        eventTemplateCount: composition?.eventTemplatesById.size || 0,
        scriptTemplateCount: composition?.scriptTemplatesById.size || 0,
        triggerTemplateCount: composition?.triggerTemplates.length || 0
      };
    },
    reloadFromDisk: async () => {
      const { absolutePath: nextProgramPath, program: nextProgramRaw } = loadProgramFromFile(programPath);
      const liveAssetState = rt.getProgramComposition()?.assetStore.getState();
      const mergedProgram = liveAssetState
        ? { ...nextProgramRaw, assets: mergeProgramAssetsPreserveLiveValues(nextProgramRaw.assets, liveAssetState) }
        : nextProgramRaw;
      await stopLoadedProgram();
      startLoadedProgram(mergedProgram);
      return {
        ok: true,
        programPath: nextProgramPath,
        reloadedAt: new Date().toISOString(),
        flowCount: rt.getProgramComposition()?.flowDefinitionsById.size || 0
      };
    }
  });

  if (dbConnectionManager) {
    rt.setGlobal("historianIngestStats", {
      mode: "direct-queue-batch-flush"
    });
  }

  const attributeValuePersistence = startAttributeValuePersistence(rt, {
    filePath: process.env.RUNTIME_ATTRIBUTE_VALUES_PATH || attributeValueStorePath,
    intervalMs: Number(process.env.RUNTIME_ATTRIBUTE_VALUES_SAVE_INTERVAL_MS || 5000)
  });
  const globalValuePersistence = startGlobalValuePersistence(rt, {
    filePath: process.env.RUNTIME_GLOBAL_VALUES_PATH || globalValueStorePath,
    intervalMs: Number(process.env.RUNTIME_GLOBAL_VALUES_SAVE_INTERVAL_MS || 5000)
  });
  rt.setGlobal("__runtime.globalValuePersistence", globalValuePersistence);

  const apiServer = createApiServer(rt, {
    host: process.env.RUNTIME_API_HOST || "0.0.0.0",
    port: Number(process.env.RUNTIME_API_PORT || 4000),
  });
  await apiServer.start();

  let isShuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[runtime] shutdown signal: ${signal}`);
    const hardExitTimer = setTimeout(() => {
      console.error("[runtime] forced shutdown timeout reached (8000ms)");
      process.exit(1);
    }, 8000);
    hardExitTimer.unref?.();

    try {
      await stopLoadedProgram();
    } catch (error) {
      console.error("[runtime] stop program error:", getErrorMessage(error));
    }

    try {
      attributeValuePersistence.flushNow();
      attributeValuePersistence.stop();
    } catch (error) {
      console.error(
        "[runtime] attribute persistence shutdown error:",
        getErrorMessage(error)
      );
    }

    try {
      globalValuePersistence.flushNow();
      globalValuePersistence.stop();
    } catch (error) {
      console.error(
        "[runtime] global persistence shutdown error:",
        getErrorMessage(error)
      );
    }

    try {
      await rt.shutdown();
    } catch (error) {
      console.error("[runtime] runtime shutdown error:", getErrorMessage(error));
    }

    try {
      await apiServer.stop();
    } catch (error) {
      console.error("[runtime] api stop error:", getErrorMessage(error));
    }

    if (dbConnectionManager) {
      try {
        await dbConnectionManager.shutdown();
      } catch (error) {
        console.error("[runtime] dbConnectionManager shutdown error:", getErrorMessage(error));
      }
    }

    clearTimeout(hardExitTimer);
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("uncaughtException", (error) => {
    console.error("[runtime] uncaughtException:", getErrorMessage(error));
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[runtime] unhandledRejection:", getErrorMessage(reason));
    void shutdown("unhandledRejection", 1);
  });
}

void bootstrap().catch((error) => {
  console.error("[runtime] bootstrap failed:", getErrorMessage(error));
  process.exit(1);
});
