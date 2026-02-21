import dgram from "node:dgram";
import { HistorianConfig } from "../config/types";
import { decodeUdpBatch } from "../storage/codec";
import { HistorianWriter } from "../storage/writer";

export class UdpIngestServer {
  private readonly socket = dgram.createSocket("udp4");

  constructor(
    private readonly config: HistorianConfig,
    private readonly writer: HistorianWriter
  ) {}

  async start(): Promise<void> {
    this.socket.on("message", (msg) => {
      try {
        const points = decodeUdpBatch(msg);
        this.writer.ingestBatch(points);
      } catch {
        this.writer.markDecodeError();
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", reject);
      this.socket.bind(this.config.udp.port, this.config.udp.host, () => resolve());
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.close(() => resolve()));
  }
}
