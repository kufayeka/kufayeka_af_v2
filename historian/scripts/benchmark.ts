import { spawn } from "node:child_process";
import { loadConfig } from "../src/config/loader";

function nowEpoch(unit: "us" | "ns"): bigint {
  const ms = BigInt(Date.now());
  return unit === "ns" ? ms * 1_000_000n : ms * 1_000n;
}

async function runQueries(base: string, unit: "us" | "ns", loops: number): Promise<void> {
  const started = Date.now();
  for (let i = 0; i < loops; i++) {
    const to = nowEpoch(unit);
    const from = to - (unit === "ns" ? 30n * 1_000_000_000n : 30n * 1_000_000n);
    const url = `${base}/hist/range?tagIds=1,2,3,4,5,6,7,8&from=${from}&to=${to}&bucketMs=500&agg=min,max,avg,count`;
    await fetch(url);
  }
  // eslint-disable-next-line no-console
  console.log(`query loop ${loops} requests in ${Date.now() - started}ms`);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const base = `http://${config.http.host === "0.0.0.0" ? "127.0.0.1" : config.http.host}:${config.http.port}`;
  const sender = spawn("npm", ["run", "send:udp", "--", "512", "1500", "800", "1"], {
    stdio: "inherit",
    shell: true
  });

  await runQueries(base, config.storage.timestampUnit, 50);
  await new Promise<void>((resolve) => sender.on("exit", () => resolve()));
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
