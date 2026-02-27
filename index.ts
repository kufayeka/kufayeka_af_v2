import Runtime from "./runtime/Runtime";
import createApiServer from "./api/createApiServer";
import { loadProgramFromFile, startProgram } from "./runtime/programEngine";
import {
  loadPersistedValuesIntoAssets,
  startAttributeValuePersistence
} from "./runtime/attributeValuePersistence";
import path from "node:path";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bootstrap(): Promise<void> {
  const rt = new Runtime({
    maxInflightPerNode: 50,
    maxQueuePerNode: 2000,
    nodeExecutionTimeoutMs: Number(process.env.RUNTIME_NODE_TIMEOUT_MS || 30000),
  });

  const programPath = path.resolve(__dirname, "../programs/main.af.json");
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
  console.log(`[runtime] attribute persistence seed loaded: ${loadedCount}`);
  const stopProgram = startProgram(rt, programWithPersistedValues);
  const attributeValuePersistence = startAttributeValuePersistence(rt, {
    filePath: process.env.RUNTIME_ATTRIBUTE_VALUES_PATH || attributeValueStorePath,
    intervalMs: Number(process.env.RUNTIME_ATTRIBUTE_VALUES_SAVE_INTERVAL_MS || 5000)
  });

  const apiServer = createApiServer(rt, {
    host: process.env.RUNTIME_API_HOST || "0.0.0.0",
    port: Number(process.env.RUNTIME_API_PORT || 4000),
  });
  apiServer.start();

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
      stopProgram();
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
      await rt.shutdown();
    } catch (error) {
      console.error("[runtime] runtime shutdown error:", getErrorMessage(error));
    }

    try {
      await apiServer.stop();
    } catch (error) {
      console.error("[runtime] api stop error:", getErrorMessage(error));
    }

    const historianBridge = rt.getGlobal<{ close?: () => void } | undefined>("historianBridge");
    if (historianBridge?.close) {
      try {
        historianBridge.close();
      } catch (error) {
        console.error("[runtime] historianBridge close error:", getErrorMessage(error));
      }
    }

    const eventStore = rt.getGlobal<{ shutdown?: () => void } | undefined>("eventStore");
    if (eventStore?.shutdown) {
      try {
        eventStore.shutdown();
      } catch (error) {
        console.error("[runtime] eventStore shutdown error:", getErrorMessage(error));
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
