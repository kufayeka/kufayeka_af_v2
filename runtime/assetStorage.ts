import type Runtime from "./Runtime";
import { AssetDomainController } from "./asset/AssetDomainController";
import type { AssetStore } from "./types";

export function ensureAssetStorage(runtime: Runtime, initialSection: unknown = {}): AssetStore {
  const existingController = runtime.getGlobal<AssetDomainController | null>("assetDomainController", null);
  const controller = existingController || new AssetDomainController(runtime);
  runtime.setGlobal("assetDomainController", controller);
  return controller.initialize(initialSection);
}
