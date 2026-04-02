import { normalizeAssetSection } from "./AssetStoreFactory";
import type { AssetSection } from "../core/runtimeTypes";
import type { AssetNormalizationServiceContract } from "./AssetContracts";

export class AssetNormalizationService implements AssetNormalizationServiceContract {
  normalize(input: unknown = {}): AssetSection {
    return normalizeAssetSection(input);
  }
}
