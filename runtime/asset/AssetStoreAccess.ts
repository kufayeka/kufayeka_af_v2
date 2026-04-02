import type Runtime from "../Runtime";
import type { AssetStore } from "../core/runtimeTypes";

export function getProgramAssetStore(runtime: Runtime, initialSection: unknown = {}): AssetStore {
  const composition = runtime.getProgramComposition();
  if (!composition) {
    throw new Error("getProgramAssetStore requires an initialized program composition");
  }
  return composition.services.asset.initialize(initialSection);
}
