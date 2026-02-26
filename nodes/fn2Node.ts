import type { RuntimeNodeHandler } from "../runtime/types";

const ASSET_URL = "http://localhost:3000/api/assets/path?path=Jasuindo.Taiyo1";

async function readAssetValue(): Promise<unknown> {
  const response = await fetch(ASSET_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

const fn2Node: RuntimeNodeHandler = async (msg, send) => {
  const payload = typeof msg.payload === "number" ? msg.payload : Number(msg.payload || 0);
  const calculated = payload * 10;

  try {
    const remoteValue = await readAssetValue();
    msg.payload = { calculated, remoteValue };
    console.log("fn2: async I/O data fetched successfully");
  } catch (error) {
    msg.payload = {
      calculated,
      remoteValue: null,
      error: error instanceof Error ? error.message : String(error),
    };
    console.error("fn2: failed to fetch async I/O data:", error instanceof Error ? error.message : String(error));
  }

  send(msg);
};

export default fn2Node;
