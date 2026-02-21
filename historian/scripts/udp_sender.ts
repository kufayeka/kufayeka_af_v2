import dgram from "node:dgram";
import { loadConfig } from "../src/config/loader";
import { encodeUdpBatch } from "../src/storage/codec";
import { Point, ValueTypeCode } from "../src/types/valueTypes";

const THREE_DAYS_SECONDS = 3 * 24 * 60 * 60;

function toEpochUnitFromMs(ms: bigint, unit: "us" | "ns"): bigint {
  return unit === "ns" ? ms * 1_000_000n : ms * 1_000n;
}

function buildThreeTagSecond(baseTs: bigint, seq: number): Point[] {
  const out: Point[] = [];
  out.push({
    tagId: 1,
    tsEpoch: baseTs,
    typeCode: ValueTypeCode.Int32,
    value: (seq % 2000) - 1000
  });
  out.push({
    tagId: 2,
    tsEpoch: baseTs,
    typeCode: ValueTypeCode.Float32,
    value: Math.sin(seq / 25) * 100
  });
  out.push({
    tagId: 3,
    tsEpoch: baseTs,
    typeCode: ValueTypeCode.String,
    value: `state-${seq % 5}`
  });
  return out;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const socket = dgram.createSocket("udp4");
  const secondsPerPacket = Number(process.argv[2] ?? 600);
  const intervalMs = Number(process.argv[3] ?? 0);
  const nowMs = BigInt(Date.now());
  const startMs = nowMs - 3n * 24n * 60n * 60n * 1000n;
  const startTs = toEpochUnitFromMs(startMs, config.storage.timestampUnit);
  const step = config.storage.timestampUnit === "ns" ? 1_000_000_000n : 1_000_000n;
  let sentPoints = 0;
  let packets = 0;

  // eslint-disable-next-line no-console
  console.log(
    `sending 3-day per-second data automatically: start=${new Date(Number(startMs)).toISOString()} end=${new Date(Number(nowMs)).toISOString()}`
  );

  for (let sec = 0; sec < THREE_DAYS_SECONDS; sec += secondsPerPacket) {
    const points: Point[] = [];
    const until = Math.min(THREE_DAYS_SECONDS, sec + secondsPerPacket);
    for (let s = sec; s < until; s++) {
      const ts = startTs + BigInt(s) * step;
      points.push(...buildThreeTagSecond(ts, s));
    }
    const payload = encodeUdpBatch(points);
    await new Promise<void>((resolve, reject) => {
      socket.send(payload, config.udp.port, config.udp.host, (err) => (err ? reject(err) : resolve()));
    });
    sentPoints += points.length;
    packets += 1;
    if (packets % 50 === 0) {
      const progress = ((until / THREE_DAYS_SECONDS) * 100).toFixed(1);
      // eslint-disable-next-line no-console
      console.log(`sent packets=${packets}, points=${sentPoints}, progress=${progress}%`);
    }
    if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
  }

  socket.close();
  // eslint-disable-next-line no-console
  console.log(`finished sending ${sentPoints} points (${THREE_DAYS_SECONDS} seconds x 3 tags)`);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
