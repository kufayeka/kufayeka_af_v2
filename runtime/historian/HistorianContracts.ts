import type Runtime from "../Runtime";
import type { HistorianTarget } from "../core/runtimeTypes";

export interface HistorianBridgeContract {
  updateTargets(nextTargets?: unknown[]): void;
  enqueueChanges(changes: unknown, store: unknown): void;
  stats(): Record<string, unknown>;
  close?(): void;
}

export interface HistorianDomainControllerContract {
  readonly domain: "historian";
  initializeBridge(targets?: unknown[]): HistorianBridgeContract;
  getBridge(): HistorianBridgeContract | null;
  getStats(): Record<string, unknown>;
  bindRuntime(runtime: Runtime): void;
}

export interface HistorianDomainServiceContract {
  bindRuntime(runtime: Runtime): void;
  initializeBridge(targets?: unknown[]): HistorianBridgeContract;
  getBridge(): HistorianBridgeContract | null;
  getStats(): Record<string, unknown>;
  updateTargets(targets?: HistorianTarget[] | unknown[]): void;
}
