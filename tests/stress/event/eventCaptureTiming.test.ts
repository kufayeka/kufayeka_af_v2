import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type { AssetSection, EventTemplateDefinition } from "../../../runtime/core/runtimeTypes";
import { openEventFromTemplate, closeEventFromTemplate } from "../../../runtime/event/template/EventTemplateLifecycle";
import { SimEventStore } from "../../shared/simEventStore";

// This suite answers a concrete question: when a downtime/activity event is
// opened or closed, does `captured_data_on_open` / `captured_data_on_close`
// actually reflect the asset value AT the moment the real-world condition
// became true, or the value at whatever later moment the action code
// actually got to run? In a queued, single-threaded runtime those two
// moments are not the same thing, and the gap between them is exactly the
// per-node queue-wait latency already measured elsewhere in this repo
// (NodeProfilingMonitor).

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function speedAttr() {
  return {
    enabled: true,
    name: "Speed",
    valueType: "float64" as const,
    default: 0,
    unit: "m/min",
    historianEnabled: false,
    historianTimeSourcePath: "",
    historianTargetId: "default",
    dashboardVisible: true,
    dashboardEditable: true,
    nullable: false,
    inputType: "text",
    options: [],
    optionsScript: "",
    numberMin: null,
    numberMax: null,
    numberAllowNegative: true,
    numberUseThousandSeparator: false,
    numberPrefix: "",
    numberSuffix: "",
    numberAllowDecimal: true,
    numberPrecision: 2
  };
}

function buildSection(): AssetSection {
  return {
    assets: [{ id: "m1", name: "Taiyo1", parentId: null, templateIds: ["tmpl"], attributes: {} }],
    attributeTemplates: [{ id: "tmpl", name: "tmpl", attributes: [speedAttr()] }],
    historians: []
  };
}

function buildTemplate(): EventTemplateDefinition {
  return {
    id: "downtime",
    enabled: true,
    eventPathTemplate: "Plant.{machine}.Downtime",
    closePatternTemplate: "Plant.{machine}.Downtime",
    assetPaths: [{ id: "machine", source: "variable", key: "machine" }],
    capture: { onOpen: true, onClose: true },
    captureFields: [{ key: "speed", source: "asset_path_attribute", assetPathId: "machine", attributeName: "Speed" }]
  };
}

describe("event capture: does it really capture the value at that exact point in time?", () => {
  it("captures the correct value when there is no queue delay between the trigger condition and the actual open() call", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplate()]]);

    store.setAttribute("Taiyo1.Speed", 0); // machine just stopped — this is the real trigger condition
    const row = await openEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      openOptions: { vars: { machine: "Taiyo1" } }
    });

    const captured = row.captured_data_on_open as { speed: number };
    assert.equal(captured.speed, 0, "with no race, the captured value must match the value at trigger time");
  });

  it("DOES NOT pin the captured value to the trigger moment — a later write before open() executes wins (documents current behavior)", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplate()]]);

    // T0: the real-world condition that SHOULD have triggered this event.
    store.setAttribute("Taiyo1.Speed", 0);
    const valueAtRealTriggerMoment = 0;

    // Simulate the queue/processing delay between "trigger detected" and
    // "action node actually gets to run" (a real, measured phenomenon in
    // this runtime: per-node queue + setImmediate hops under load).
    await sleep(25);

    // Another encoder tick landed in that window, before the delayed action
    // finally got to call openTemplate().
    store.setAttribute("Taiyo1.Speed", 87);

    const row = await openEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      openOptions: { vars: { machine: "Taiyo1" } }
    });

    const captured = row.captured_data_on_open as { speed: number };
    assert.equal(captured.speed, 87, "captureFields re-reads the LIVE store at execution time, not the value at the original trigger");
    assert.notEqual(
      captured.speed,
      valueAtRealTriggerMoment,
      "this is the drift: the audit record no longer reflects the value that actually caused the event"
    );
  });

  it("the same drift applies on close() — a race between the closing condition and a later write", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplate()]]);

    store.setAttribute("Taiyo1.Speed", 0);
    const opened = await openEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      openOptions: { vars: { machine: "Taiyo1" } }
    });

    // Machine resumes — this is the real closing condition.
    store.setAttribute("Taiyo1.Speed", 120);
    const valueAtRealCloseMoment = 120;

    await sleep(25);
    // Speed already ticked again before the delayed close() call executes.
    store.setAttribute("Taiyo1.Speed", 145);

    const closed = await closeEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      closeOptions: { id: opened.id, vars: { machine: "Taiyo1" } }
    });

    const capturedClose = closed.rows[0]?.captured_data_on_close as { speed: number };
    assert.equal(capturedClose.speed, 145);
    assert.notEqual(capturedClose.speed, valueAtRealCloseMoment);
  });

  it("start_ts defaults to wall-clock time at the open() call, not the trigger moment, unless timeSource is explicitly configured", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplate()]]); // no timeSource.open configured

    const beforeTriggerTs = Date.now();
    store.setAttribute("Taiyo1.Speed", 0);
    await sleep(30); // the real trigger happened `beforeTriggerTs`, well before this line
    const row = await openEventFromTemplate({
      assetStore: store,
      eventStore,
      templateMap,
      templateId: "downtime",
      openOptions: { vars: { machine: "Taiyo1" } }
    });

    const startTsMs = new Date(row.start_ts).getTime();
    const driftMs = startTsMs - beforeTriggerTs;
    assert.ok(driftMs >= 25, `expected start_ts to trail the real trigger moment by roughly the queue delay, got driftMs=${driftMs}`);
  });
});
