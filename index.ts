import Runtime from "./runtime/Runtime";
import createApiServer from "./api/createApiServer";
import { loadProgramFromFile, startProgram } from "./runtime/programEngine";
import path from "node:path";

function bootstrap(): void {
  const rt = new Runtime({
    maxInflightPerNode: 50,
    maxQueuePerNode: 2000,
  });

  const programPath = path.resolve(__dirname, "../programs/main.af.json");
  const { absolutePath, program } = loadProgramFromFile(programPath);
  console.log(`Program loaded: ${absolutePath}`);
  startProgram(rt, program);

  const apiServer = createApiServer(rt, {
    host: process.env.RUNTIME_API_HOST || "0.0.0.0",
    port: Number(process.env.RUNTIME_API_PORT || 4000),
  });
  apiServer.start();
}

bootstrap();
