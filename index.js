const Runtime = require("./runtime/Runtime");
const { registerNodes, registerWires } = require("./flow/flow");
const createInjectNode = require("./nodes/injectNode");
const createApiServer = require("./api/createApiServer");

function bootstrap() {
  const rt = new Runtime({
    maxInflightPerNode: 50,
    maxQueuePerNode: 2000,
  });

  registerNodes(rt);
  registerWires(rt);

  const apiServer = createApiServer(rt, {
    host: "127.0.0.1",
    port: 4000,
  });
  apiServer.start();

  const inject = createInjectNode(rt);
  inject(5);
}

bootstrap();
