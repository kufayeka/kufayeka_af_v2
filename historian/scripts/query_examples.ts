import { loadConfig } from "../src/config/loader";

function nowEpoch(unit: "us" | "ns"): bigint {
  const ms = BigInt(Date.now());
  return unit === "ns" ? ms * 1_000_000n : ms * 1_000n;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const tagIds = "1,2,3"; // fixed test tags: 1=int32, 2=float32, 3=string
  const to = nowEpoch(config.storage.timestampUnit);
  const from = to - (config.storage.timestampUnit === "ns" ? 60n * 1_000_000_000n : 60n * 1_000_000n);
  const base = `http://${config.http.host === "0.0.0.0" ? "127.0.0.1" : config.http.host}:${config.http.port}`;

  const urls = [
    `${base}/hist/last?tagIds=${tagIds}&time=iso`,
    `${base}/hist/raw?tagIds=${tagIds}&from=${from.toString()}&to=${to.toString()}&limit=100&order=desc&time=iso`,
    `${base}/hist/range?tagIds=${tagIds}&from=${from.toString()}&to=${to.toString()}&bucketMs=1000&agg=avg&order=desc&time=iso`
  ];

  // eslint-disable-next-line no-console
  console.log("Querying fixed tags: 1(int32), 2(float32), 3(string)");
  for (const u of urls) {
    try {
      // eslint-disable-next-line no-console
      console.log(`\nGET ${u}`);
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(u, { signal: ctrl.signal }).finally(() => clearTimeout(timeout));
      // eslint-disable-next-line no-console
      console.log(`HTTP ${res.status}`);
      // eslint-disable-next-line no-console
      console.log(await res.text());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`request failed: ${u}`);
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
