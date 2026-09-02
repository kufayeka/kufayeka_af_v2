import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildProgramFlows,
  resolveFlowVariableValue
} from "../../../runtime/flow/ProgramFlowSupport";
import { registerFlowNodes, registerLinks } from "../../../runtime/flow/ProgramNodeRegistration";
import {
  computeAttributeSignature,
  createTriggerMessage,
  mapClosedEventRow,
  mapOpenedEventRow,
  matchWildcardPath,
  matchWildcardText,
  shouldEmitAttributeChange
} from "../../../runtime/flow/ProgramTriggerSupport";
import { startTriggers } from "../../../runtime/flow/ProgramTriggerStarter";
import type { ProgramRuntimeComposition } from "../../../runtime/composition/RuntimeComposition";
import { FakeFlowRuntime, FakeSubscribable, createTestNodeContext } from "../../shared/runtimeTestUtils";

function createComposition(overrides: Partial<ProgramRuntimeComposition> = {}): ProgramRuntimeComposition {
  const assetSub = new FakeSubscribable<unknown>();
  const eventSub = new FakeSubscribable<any>();
  return {
    services: {
      action: {
        createScriptHandler: () => async (_msg: unknown, _send: unknown) => {},
        createEventHandler: () => async (_msg: unknown, _send: unknown) => {}
      }
    } as unknown as ProgramRuntimeComposition["services"],
    dbConnectionManager: null,
    assetStore: { subscribe: (cb: (state: unknown, meta: unknown) => void) => assetSub.subscribe((payload) => cb({}, payload)) } as any,
    eventStore: { subscribe: (cb: (meta: any) => void) => eventSub.subscribe(cb) } as any,
    scriptTemplatesById: new Map(),
    eventTemplates: [],
    eventTemplatesById: new Map(),
    flowDefinitionsById: new Map(),
    triggerTemplates: [],
    flowNodeConfigById: {},
    ...overrides
  };
}

describe("Flow quality and stress", () => {
  it("resolves flow variables and builds fallback flows correctly", () => {
    const context = createTestNodeContext({
      assetQueryMatches: {
        "Plant.Line1": [
          { kind: "asset", path: "Plant.Line1", assetId: "line-1", value: { id: "line-1" } } as any
        ],
        "Plant.Line1.Machine.Speed": [
          {
            kind: "attribute",
            path: "Plant.Line1.Machine.Speed",
            assetId: "machine-1",
            attributeName: "Speed",
            value: 12,
            type: "float64",
            unit: "m",
            historianEnabled: false,
            historianTimeSourcePath: "",
            historianTargetId: "default"
          } as any
        ]
      }
    });

    assert.equal((resolveFlowVariableValue({ source: "static_number", staticValue: 10 }, context) as number), 10);
    assert.equal((resolveFlowVariableValue({ source: "static_boolean", staticValue: "true" }, context) as boolean), true);
    assert.equal((resolveFlowVariableValue({ source: "asset", attributePath: "Plant.Line1" }, context) as any).assetId, "line-1");
    assert.equal((resolveFlowVariableValue({ source: "attribute", attributePath: "Plant.Line1.Machine.Speed" }, context) as any).value, 12);

    const flows = buildProgramFlows({
      flows: {
        id: "flow-main",
        name: "Main",
        nodes: [],
        links: []
      }
    });
    assert.equal(flows.length, 1);
    assert.equal(flows[0]?.id, "flow-main");
  });

  it("registers nodes and links and rejects duplicate node ids", () => {
    const runtime = new FakeFlowRuntime();
    const composition = createComposition();
    registerFlowNodes(
      runtime as any,
      [
        { id: "trg-1", kind: "trigger", enabled: true },
        { id: "act-1", kind: "action", enabled: false }
      ],
      composition
    );
    assert.equal(runtime.nodes.size, 2);
    assert.ok(runtime.globals.has("flowNodeConfigById"));

    registerLinks(runtime as any, [
      { from: "trg-1", to: "act-1", fromPort: "default", enabled: true }
    ]);
    assert.deepEqual(runtime.wires[0], { from: "trg-1", to: "act-1", fromPort: "default" });

    assert.throws(
      () =>
        registerFlowNodes(
          new FakeFlowRuntime() as any,
          [
            { id: "dup-1", kind: "trigger", enabled: true },
            { id: "dup-1", kind: "action", enabled: true, config: { __flowId: "flow-x" } }
          ],
          composition
        ),
      /Duplicate flow node id/
    );
  });

  it("starts watcher triggers and event triggers with correct filtering", () => {
    const assetStore = new FakeSubscribable<unknown>();
    const eventStore = new FakeSubscribable<any>();
    const runtime = new FakeFlowRuntime();
    const composition = createComposition({
      assetStore: {
        subscribe: (cb: (meta: unknown) => void) => assetStore.subscribe(cb)
      } as any,
      eventStore: {
        subscribe: (cb: (meta: any) => void) => eventStore.subscribe(cb)
      } as any
    });

    const stops = startTriggers(
      runtime as any,
      [
        { id: "watch-set", kind: "trigger", enabled: true, config: { type: "watcher_set", watchPath: "Plant.Line1.*.Speed" } },
        { id: "watch-change", kind: "trigger", enabled: true, config: { type: "watcher_valuechange", watchPath: "Plant.Line1.*.Speed" } },
        { id: "event-open", kind: "trigger", enabled: true, config: { type: "watcher_event_open", watchPath: "Plant/Line1/*" } },
        { id: "event-close", kind: "trigger", enabled: true, config: { type: "watcher_event_falling", watchPath: "Plant/Line1/*" } }
      ] as any,
      composition
    );

    assetStore.emit({
      change: {
        changes: [
          { kind: "attribute", path: "Plant.Line1.Machine1.Speed", assetId: "m1", attributeName: "Speed", value: 10, ts: "t1" },
          { kind: "attribute", path: "Plant.Line2.Machine1.Speed", assetId: "m2", attributeName: "Speed", value: 11, ts: "t1" }
        ]
      }
    });
    assetStore.emit({
      change: {
        changes: [{ kind: "attribute", path: "Plant.Line1.Machine1.Speed", assetId: "m1", attributeName: "Speed", value: 10, ts: "t1" }]
      }
    });
    assetStore.emit({
      change: {
        changes: [{ kind: "attribute", path: "Plant.Line1.Machine1.Speed", assetId: "m1", attributeName: "Speed", value: 12, ts: "t2" }]
      }
    });

    eventStore.emit({
      type: "open",
      row: {
        id: "evt-1",
        event_path: "Plant/Line1/Machine1",
        start_ts: "2026-01-01T00:00:00.000Z",
        end_ts: null,
        status: "open"
      }
    });
    eventStore.emit({
      type: "close",
      row: {
        id: "evt-2",
        event_path: "Plant/Line1/Machine1",
        start_ts: "2026-01-01T00:00:00.000Z",
        end_ts: "2026-01-01T00:01:00.000Z",
        status: "closed"
      }
    });

    assert.ok(runtime.sent.some((item) => item.nodeId === "watch-set"));
    assert.equal(runtime.sent.filter((item) => item.nodeId === "watch-change").length, 2);
    assert.ok(runtime.sent.some((item) => item.nodeId === "event-open"));
    assert.ok(runtime.sent.some((item) => item.nodeId === "event-close"));

    for (const stop of stops) stop();
  });

  it("keeps hot-path trigger helpers deterministic under stress", () => {
    const lastSeen = new Map<string, string>();
    let emitted = 0;
    for (let index = 0; index < 5000; index += 1) {
      const change = {
        kind: "attribute",
        path: `Plant.Line1.Machine${(index % 5) + 1}.Speed`,
        assetId: `m${(index % 5) + 1}`,
        attributeName: "Speed",
        value: index % 3,
        ts: `t${Math.floor(index / 2)}`
      };
      if (shouldEmitAttributeChange("valuechange", change, "Plant.Line1.*.Speed", lastSeen)) emitted += 1;
      assert.match(computeAttributeSignature(change), /::/);
    }
    assert.ok(emitted > 0);
    assert.equal(matchWildcardPath("Plant.Line1.*.Speed", "Plant.Line1.Machine3.Speed"), true);
    assert.equal(matchWildcardText("Plant/Line1/*", "Plant/Line1/Machine1"), true);
    assert.equal(matchWildcardText("Plant/Line1/*", "Plant/Line2/Machine1"), false);
    assert.equal(mapOpenedEventRow({ type: "open", ts: "x" } as any, { status: "open", id: "1", event_path: "a", start_ts: "s", end_ts: null } as any)?.status_after, "open");
    assert.equal(mapClosedEventRow({ type: "close", ts: "x" } as any, { status: "closed", id: "1", event_path: "a", start_ts: "s", end_ts: "e" } as any)?.status_after, "closed");

    const msg = createTriggerMessage(
      { id: "trg-1", type: "interval", message: { payload: 0 } },
      { path: "x" },
      { type: "interval" },
      { now: () => "2026-01-01T00:00:00.000Z", cloneMessage: <T>(value: T) => structuredClone(value) }
    );
    assert.equal((msg as any)._trigger.id, "trg-1");
  });
});
