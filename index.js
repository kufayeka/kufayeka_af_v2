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
    host: "127.0.0.1",
    port: 4000,
  });
  apiServer.start();
}

bootstrap();
