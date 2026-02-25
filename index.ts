import Runtime from "./runtime/Runtime";
import createApiServer from "./api/createApiServer";
import { loadProgramFromFile, startProgram } from "./runtime/programEngine";
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
  console.log(`Program loaded: ${absolutePath}`);
  const stopProgram = startProgram(rt, program);

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

    try {
      rt.shutdown();
    } catch (error) {
      console.error("[runtime] runtime shutdown error:", getErrorMessage(error));
    }

    try {
      stopProgram();
    } catch (error) {
      console.error("[runtime] stop program error:", getErrorMessage(error));
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
