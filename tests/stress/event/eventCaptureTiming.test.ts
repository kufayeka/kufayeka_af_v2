import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAssetStore } from "../../../runtime/asset/AssetStoreFactory";
import type {
  AssetStore,
  AssetSection,
  EventActionDefinition,
  EventTemplateDefinition,
  RuntimeMessage,
  RuntimeNodeContext
} from "../../../runtime/core/runtimeTypes";
import { openEventFromTemplate, closeEventFromTemplate } from "../../../runtime/event/template/EventTemplateLifecycle";
import { createEventActionHandler } from "../../../runtime/action/EventActionHandlerFactory";
import { SimEventStore } from "../../shared/simEventStore";
import { createSendCapture } from "../../shared/runtimeTestUtils";

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

// The fix: EventActionHandlerFactory resolves captureFields eagerly, right
// after its own bindings are known, BEFORE calling context.eventSys.openTemplate()/
// closeTemplate(). These tests exercise the real createEventActionHandler()
// end to end (not the lower-level lifecycle functions directly), with the
// SAME kind of latency the earlier tests used to expose the drift -- but
// this time the latency is simulated where it actually happens in production
// (downstream of the handler's own bindings resolution, inside the
// openTemplate/closeTemplate call itself), to prove the eager snapshot
// survives it.
function buildTemplateWithBinding(): EventTemplateDefinition {
  return {
    ...buildTemplate(),
    bindings: [{ name: "machine", source: "static_string", defaultValue: "Taiyo1" }]
  };
}

function createLiveContext(
  store: AssetStore,
  eventStore: SimEventStore,
  templateMap: Map<string, EventTemplateDefinition>,
  simulateDownstreamDelayMs: number
): RuntimeNodeContext {
  return {
    nodeId: "test-node",
    global: {
      get: <T = unknown>(_key: string, defaultValue?: T) => defaultValue as T,
      set: <T = unknown>(_key: string, value: T) => value,
      has: () => false,
      delete: () => false
    },
    asset: {
      query: (path) => store.query(path),
      get: <T = unknown>(path: string, defaultValue?: T) => store.getAttribute(path, defaultValue) as T,
      getValue: <T = unknown>(path: string, defaultValue?: T) => store.getValue(path, defaultValue) as T,
      getAll: (path) => store.getAttributes(path),
      set: async (path, value) => store.setAttribute(path, value),
      setMany: async (items) => store.setAttributes(items),
      findByValue: (path, expectedValue, options) => store.findAttributesByValue(path, expectedValue, options),
      find: (path, expectedValue, options) => store.findAttributesByValue(path, expectedValue, options),
      hierarchy: (options) => store.getHierarchy(options)
    },
    eventSys: {
      open: async () => {
        throw new Error("not used in this test");
      },
      close: async () => {
        throw new Error("not used in this test");
      },
      get: async () => [],
      getEarliestTs: async () => null,
      getLatestTs: async () => null,
      getRange: async () => ({ start_ts: null, end_ts: null, count: 0 }),
      openTemplate: async (templateId, options) => {
        // Simulates the queue/dispatch latency that happens AFTER the
        // handler has already resolved its own bindings/eager capture --
        // i.e. the real gap this whole fix targets.
        await sleep(simulateDownstreamDelayMs);
        return openEventFromTemplate({ assetStore: store, eventStore, templateMap, templateId, openOptions: options });
      },
      closeTemplate: async (templateId, options) => {
        await sleep(simulateDownstreamDelayMs);
        return closeEventFromTemplate({ assetStore: store, eventStore, templateMap, templateId, closeOptions: options });
      }
    },
    db: {
      query: async () => ({ rows: [], rowCount: 0 }),
      executeSafe: async () => ({ rows: [], rowCount: 0 }),
      testConnection: async () => ({ ok: true, message: "ok", latencyMs: 0 })
    },
    action: {
      status: (status) => (Array.isArray(status) ? status : [status])
    },
    flow: { id: "flow-test", name: "Flow Test", variables: {} }
  };
}

describe("event capture FIX: EventActionHandlerFactory pins capture to trigger time", () => {
  it("open() no longer drifts, even with downstream latency and a write landing during it", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplateWithBinding()]]);
    const context = createLiveContext(store, eventStore, templateMap, 25);
    const sendCapture = createSendCapture();
    const action: EventActionDefinition = { id: "open-downtime", templateId: "downtime" };
    const handler = createEventActionHandler(action, "open", { eventTemplateById: templateMap });

    store.setAttribute("Taiyo1.Speed", 0); // T0: real trigger condition
    const msg: RuntimeMessage = { id: "m1", ts: new Date().toISOString() };
    const handlerPromise = handler(msg, sendCapture.send, context);

    // While the simulated downstream latency is in flight, another encoder
    // tick lands -- the same race that broke the raw openEventFromTemplate()
    // call in the tests above.
    await sleep(5);
    store.setAttribute("Taiyo1.Speed", 87);
    await handlerPromise;

    const sent = sendCapture.items.find((item) => item.port === "onSuccess");
    assert.ok(sent, "expected the open action to succeed");
    const row = (sent!.msg as unknown as { eventAction: { row: { captured_data_on_open: { speed: number } } } }).eventAction.row;
    assert.equal(row.captured_data_on_open.speed, 0, "capture must reflect the trigger-time value, not the value written during downstream latency");
  });

  it("close() no longer drifts either, under the same conditions", async () => {
    const store = createAssetStore(buildSection());
    const eventStore = new SimEventStore();
    const templateMap = new Map([["downtime", buildTemplateWithBinding()]]);
    const context = createLiveContext(store, eventStore, templateMap, 0);
    const openHandler = createEventActionHandler({ id: "open-downtime", templateId: "downtime" }, "open", {
      eventTemplateById: templateMap
    });
    const openSend = createSendCapture();
    store.setAttribute("Taiyo1.Speed", 0);
    await openHandler({ id: "m0", ts: new Date().toISOString() }, openSend.send, context);

    store.setAttribute("Taiyo1.Speed", 120); // real closing condition
    const closingContext = createLiveContext(store, eventStore, templateMap, 25);
    const closeSend = createSendCapture();
    const closeHandler = createEventActionHandler({ id: "close-downtime", templateId: "downtime" }, "close", {
      eventTemplateById: templateMap
    });
    const closePromise = closeHandler({ id: "m1", ts: new Date().toISOString() }, closeSend.send, closingContext);

    await sleep(5);
    store.setAttribute("Taiyo1.Speed", 145); // another tick lands during the simulated latency
    await closePromise;

    const sent = closeSend.items.find((item) => item.port === "onSuccess");
    assert.ok(sent, "expected the close action to succeed");
    const eventAction = (sent!.msg as unknown as { eventAction: { result: { rows: Array<{ captured_data_on_close: { speed: number } }> } } })
      .eventAction;
    assert.equal(eventAction.result.rows[0]?.captured_data_on_close.speed, 120, "close capture must reflect the value at the real closing condition, not the later race value");
  });
});
