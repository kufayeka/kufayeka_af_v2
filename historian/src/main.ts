import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config/loader";
import { UdpIngestServer } from "./ingest/udpServer";
import { buildHttpServer } from "./http/server";
import { repairStorageTail } from "./storage/repair";
import { RetentionManager } from "./storage/retention";
import { ensureBaseLayout } from "./storage/layout";
import { LastValueStore } from "./storage/lastValueStore";
import { HistorianWriter } from "./storage/writer";

async function writeMetaConfig(dataDir: string, config: unknown): Promise<void> {
  const metaPath = path.join(dataDir, "meta", "config.json");
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(config, null, 2), "utf8");
}

async function main(): Promise<void> {
  const config = await loadConfig();
  await ensureBaseLayout(config);
  await repairStorageTail(config);
  await writeMetaConfig(config.storage.dataDir, config);

  const lastStore = new LastValueStore(config);
  await lastStore.start();
  const writer = new HistorianWriter(config, lastStore);
  const udp = new UdpIngestServer(config, writer);
  const retention = new RetentionManager(config);

  await udp.start();
  const app = await buildHttpServer(config, lastStore);
  await app.listen({ host: config.http.host, port: config.http.port });
  retention.start();

  // eslint-disable-next-line no-console
  console.log(`Historian started. UDP ${config.udp.host}:${config.udp.port}, HTTP ${config.http.host}:${config.http.port}`);

  const shutdown = async () => {
    retention.stop();
    await Promise.allSettled([app.close(), udp.close(), writer.close(), lastStore.close()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", err);
  process.exit(1);
});
