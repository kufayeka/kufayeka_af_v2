import "reflect-metadata";
import type http from "node:http";
import type { Socket } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { SwaggerModule } from "@nestjs/swagger";
import type Runtime from "../runtime/Runtime";
import { AppModule } from "./app.module";
import { OPENAPI_RUNTIME_SPEC } from "./openapiRuntimeSpec";

export default function createApiServer(runtime: Runtime, options: { port?: number; host?: string } = {}) {
  const port = options.port ?? 4000;
  const host = options.host ?? "0.0.0.0";
  const allowedCorsOrigins = [
    "*",
    "http://192.168.68.99:3333",
    "http://192.168.68.99:3002",
    "http://192.168.68.99:3003",
    "http://192.168.68.99:4000",

    "http://localhost:3333",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:4000",

    "http://192.168.68.9:3000",
    "http://192.168.68.9:4000",
    "http://192.168.68.9:3002",
    "http://192.168.68.9:3003",
  ];

  let nestApp: INestApplication | null = null;
  let server: http.Server | null = null;
  const sockets = new Set<Socket>();

  const buildSwaggerDocument = (): OpenAPIObject => {
    return JSON.parse(JSON.stringify({
      ...structuredClone(OPENAPI_RUNTIME_SPEC),
      servers: [{ url: "/" }]
    })) as OpenAPIObject;
  };

  return {
    async start() {
      if (server) return server;

      const app = await NestFactory.create(AppModule.register(runtime), {
        logger: ["log", "error", "warn", "debug"]
      });

      app.enableCors({
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean | string | string[]) => void
        ) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          if (allowedCorsOrigins.includes(origin)) {
            callback(null, origin);
            return;
          }
          callback(new Error(`CORS origin not allowed: ${origin}`), false);
        },
        methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
        exposedHeaders: ["*"]
      });

      app.enableShutdownHooks();
      app.use((req: { method?: string; originalUrl?: string; url?: string }, _res: unknown, next: () => void) => {
        console.log(`[${req.method || "GET"}] ${req.originalUrl || req.url || ""}`);
        next();
      });

      app.setGlobalPrefix("api", {
        exclude: ["docs", "docs-json"]
      });

      const swaggerDocument = buildSwaggerDocument();
      SwaggerModule.setup("docs", app, swaggerDocument, {
        jsonDocumentUrl: "docs-json"
      });

      await app.listen(port, host);
      nestApp = app;
      server = app.getHttpServer() as http.Server;
      console.log(`Global store API is running at http://${host}:${port}`);
      server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      return server;
    },

    async stop() {
      if (!nestApp) return;
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await nestApp.close();
      nestApp = null;
      server = null;
    }
  };
}
