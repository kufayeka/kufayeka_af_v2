import type { RuntimeMessage } from "./runtimeTypes";
import type { RuntimeDeps } from "./runtimeExecutionUtils";

export function normalizeMessage(
  msg: unknown,
  deps: Pick<Required<RuntimeDeps>, "generateId" | "now">
): RuntimeMessage {
  const source: Record<string, unknown> =
    msg && typeof msg === "object" && !Array.isArray(msg) ? (msg as Record<string, unknown>) : { payload: msg };
  const normalized: Record<string, unknown> = { ...source };
  if (typeof normalized.id !== "string" || !normalized.id.trim()) {
    normalized.id = deps.generateId();
  }
  if (typeof normalized.ts !== "string" || !normalized.ts.trim()) {
    normalized.ts = deps.now();
  }
  return normalized as RuntimeMessage;
}

export function buildWireKey(fromId: string, fromPort = "default"): string {
  return `${fromId}::${String(fromPort || "default")}`;
}

export function resolveOutputLabels(nodeConfig: Record<string, unknown> | undefined): string[] {
  return Array.isArray(nodeConfig?.outputs)
    ? (nodeConfig.outputs as unknown[]).map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

export function resolvePorts(outputLabels: string[], targets: Array<string | number>): string[] {
  const resolved = new Set<string>();
  for (const target of targets) {
    if (typeof target === "number" && Number.isFinite(target)) {
      const index = Math.trunc(target) - 1;
      const port = outputLabels[index];
      if (port) resolved.add(port);
      continue;
    }
    const raw = String(target || "").trim();
    if (!raw) continue;
    if (/^\d+$/.test(raw)) {
      const index = Number(raw) - 1;
      const port = outputLabels[index];
      if (port) resolved.add(port);
      continue;
    }
    resolved.add(raw);
  }
  return Array.from(resolved);
}
