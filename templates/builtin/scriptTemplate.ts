import type { RuntimeNodeHandler } from "../../runtime/types";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export default function createScriptTemplate(config: Record<string, unknown> = {}): RuntimeNodeHandler {
  const name = String(config.name || "script-node");
  const script = String(config.script || "send(msg);");
  const runScript = new AsyncFunction("msg", "send", "context", "helpers", script);

  return async function scriptNode(msg, send, context) {
    const helpers = {
      log: (...args: unknown[]) => console.log(`[${name}]`, ...args),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    };
    await runScript(msg, send, context, helpers);
  };
}
