import { normalizeAssetSection } from "../assetFramework";
import type { AssetSection } from "../types";
import type { AssetNormalizationServiceContract } from "./contracts";

export class AssetNormalizationService implements AssetNormalizationServiceContract {
  normalize(input: unknown = {}): AssetSection {
    return normalizeAssetSection(input);
  }
}
