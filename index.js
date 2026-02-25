const Runtime = require("./runtime/Runtime");
const createApiServer = require("./api/createApiServer");
const { loadProgramFromFile, startProgram } = require("./runtime/programEngine");

function bootstrap() {
  const rt = new Runtime({
    maxInflightPerNode: 50,
    maxQueuePerNode: 2000,
  });

  const { absolutePath, program } = loadProgramFromFile("./programs/main.af.json");
  console.log(`Program loaded: ${absolutePath}`);
  startProgram(rt, program);

  const apiServer = createApiServer(rt, {
    host: process.env.RUNTIME_API_HOST || "0.0.0.0",
    port: Number(process.env.RUNTIME_API_PORT || 4000),
  });
  apiServer.start();
}

bootstrap();
