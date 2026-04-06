import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventTemplateDefinition, RuntimeMessage } from "../../../runtime/core/runtimeTypes";
import { createEventActionHandler } from "../../../runtime/action/EventActionHandlerFactory";
import {
  buildResolvedBindings,
  buildScriptSource,
  createScriptActionRuntimeDeps,
  prepareScriptSource
} from "../../../runtime/action/ScriptActionSupport";
import { createScriptActionHandler } from "../../../runtime/action/ScriptActionHandlerFactory";
import { renderTextTemplate, resolveBindings, validateResolvedBindings } from "../../../runtime/action/EventActionSupport";
import { createSendCapture, createTestNodeContext } from "../../shared/runtimeTestUtils";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("Action quality and stress", () => {
  it("prepares script source with implicit await and executes compiled handler correctly", async () => {
    const templateById = new Map([
      [
        "tmpl-script",
        {
          id: "tmpl-script",
          script: `
            const current = asset.getValue("Machine.Speed", 0);
            await asset.set("Machine.Speed", current + 1);
            msg.output = {
              product: bindings.product,
              workOrder: flowVars.workOrder,
              speed: asset.getValue("Machine.Speed", 0)
            };
            send(msg, "out");
          `,
          variableBindings: [
            { name: "product", source: "static_string", staticValue: "A" }
          ]
        }
      ]
    ]);
    const flowById = new Map([
      [
        "flow-main",
        {
          id: "flow-main",
          variables: [{ name: "workOrder", source: "static_string", staticValue: "WO-1" }]
        }
      ]
    ]);
    const handler = createScriptActionHandler(
      {
        id: "act-script",
        templateId: "tmpl-script",
        config: { __flowId: "flow-main" }
      },
      { templateById, flowById }
    );
    const context = createTestNodeContext({ assetValues: { "Machine.Speed": 4 } });
    const capture = createSendCapture();
    await handler({ id: "m1", ts: "2026-01-01T00:00:00.000Z" }, capture.send, context);

    assert.equal(context.asset.getValue("Machine.Speed"), 5);
    assert.equal(capture.items.length, 1);
    assert.equal(capture.items[0]?.port, "out");
    assert.deepEqual(capture.items[0]?.msg.output, { product: "A", workOrder: "WO-1", speed: 5 });
  });

  it("times out long-running script actions", async () => {
    const handler = createScriptActionHandler(
      {
        id: "act-timeout",
        script: `await helpers.sleep(20); send(msg);`,
        config: { timeoutMs: 1 }
      },
      {
        runtimeDeps: createScriptActionRuntimeDeps()
      }
    );
    const context = createTestNodeContext();
    const capture = createSendCapture();
    await assert.rejects(
      async () => await Promise.resolve(handler({ id: "m2", ts: "2026-01-01T00:00:00.000Z" }, capture.send, context)),
      /timeout/
    );
    assert.equal(capture.items.length, 0);
  });

  it("opens and closes event actions with success and fail routing", async () => {
    const template: EventTemplateDefinition = {
      id: "evt.template",
      eventPathTemplate: "Plant/{asset}",
      bindings: [{ name: "asset", source: "static_string", defaultValue: "M1" }]
    };
    const eventTemplateById = new Map([[template.id, template]]);

    const openContext = createTestNodeContext({
      eventSys: {
        openTemplate: async (templateId, options) => ({
          id: "row-open-1",
          event_path: `Plant.${String(options?.vars?.asset || "")}`,
          start_ts: "2026-01-01T00:00:00.000Z",
          end_ts: null,
          status: "open",
          severity: "info",
          context: {},
          is_acknowledge: false,
          acknowledged_ts: null,
          notes_on_open: String(options?.notes || ""),
          notes_on_close: null,
          event_metadata: { templateId },
          captured_data_on_open: null,
          captured_data_on_close: null
        })
      }
    });
    const openHandler = createEventActionHandler(
      {
        id: "evt-open",
        templateId: template.id,
        bindings: {
          asset: { source: "static_string", staticValue: "MachineA" }
        },
        openNotes: "Opening {asset}"
      },
      "open",
      { eventTemplateById }
    );
    const openCapture = createSendCapture();
    await openHandler({ id: "m3", ts: "2026-01-01T00:00:00.000Z" }, openCapture.send, openContext);
    assert.equal(openCapture.items.length, 1);
    assert.equal(openCapture.items[0]?.port, "onSuccess");

    const closeContext = createTestNodeContext({
      eventSys: {
        closeTemplate: async () => ({
          pattern: "*",
          closedCount: 0,
          ts: "2026-01-01T00:01:00.000Z",
          notes_on_close: null,
          rows: []
        })
      }
    });
    const closeHandler = createEventActionHandler(
      {
        id: "evt-close",
        templateId: template.id,
        bindings: {
          asset: { source: "static_string", staticValue: "MachineA" }
        }
      },
      "close",
      { eventTemplateById }
    );
    const closeCapture = createSendCapture();
    await closeHandler({ id: "m4", ts: "2026-01-01T00:00:00.000Z" }, closeCapture.send, closeContext);
    assert.equal(closeCapture.items.length, 1);
    assert.equal(closeCapture.items[0]?.port, "onFail");
  });

  it("validates missing event binding values", async () => {
    const template: EventTemplateDefinition = {
      id: "evt.required",
      eventPathTemplate: "Plant/{asset}",
      bindings: [{ name: "asset", source: "attribute" }]
    };
    const resolved = { asset: null };
    assert.throws(() => validateResolvedBindings("act-required", template, resolved), /missing required binding/i);
  });

  it("survives 2k randomized script invocations without dropping outputs", async () => {
    const templateById = new Map([
      [
        "tmpl-random",
        {
          id: "tmpl-random",
          script: `
            msg.result = Number(bindings.base || 0) + Number(flowVars.offset || 0) + Number(msg.delta || 0);
            send(msg);
          `,
          variableBindings: [
            { name: "base", source: "static_number", staticValue: 0, allowOverride: true }
          ]
        }
      ]
    ]);
    const flowById = new Map([
      [
        "flow-random",
        {
          id: "flow-random",
          variables: [{ name: "offset", source: "static_number", staticValue: 0 }]
        }
      ]
    ]);
    const handler = createScriptActionHandler(
      {
        id: "act-random",
        templateId: "tmpl-random",
        config: { __flowId: "flow-random" },
        templateBindingOverrides: {
          base: { source: "static_number", staticValue: 0 }
        }
      },
      { templateById, flowById }
    );
    const rng = createSeededRng(4242);

    for (let index = 0; index < 2000; index += 1) {
      const base = Math.floor(rng() * 100);
      const offset = Math.floor(rng() * 20);
      const delta = Math.floor(rng() * 50);
      const capture = createSendCapture();
      const context = createTestNodeContext({ flowVariables: { offset } });
      const msg: RuntimeMessage = { id: `msg-${index}`, ts: "2026-01-01T00:00:00.000Z", delta };
      const actionHandler = createScriptActionHandler(
        {
          id: "act-random",
          templateId: "tmpl-random",
          config: { __flowId: "flow-random" },
          templateBindingOverrides: {
            base: { source: "static_number", staticValue: base }
          }
        },
        {
          templateById,
          flowById: new Map([
            [
              "flow-random",
              {
                id: "flow-random",
                variables: [{ name: "offset", source: "static_number", staticValue: offset }]
              }
            ]
          ])
        }
      );
      await actionHandler(msg, capture.send, context);
      assert.equal(capture.items.length, 1);
      assert.equal(capture.items[0]?.msg.result, base + offset + delta);
      void handler;
    }
  });

  it("keeps support helpers deterministic", async () => {
    const context = createTestNodeContext({
      flowVariables: { temp: 9 },
      assetValues: { "Machine.Temp": 7 },
      assetQueryMatches: {
        "Machine.Temp": [
          {
            kind: "attribute",
            path: "Machine.Temp",
            assetId: "machine-1",
            attributeName: "Temp",
            value: 7,
            type: "float64",
            unit: "C",
            historianEnabled: false,
            historianTimeSourcePath: "",
            historianTargetId: "default"
          } as any
        ]
      }
    });
    const resolved = await buildResolvedBindings(
      {
        id: "act-support",
        templateId: "tmpl-support",
        config: { __flowId: "flow-x" },
        templateBindingOverrides: {}
      },
      context,
      {
        templateById: new Map([
          [
            "tmpl-support",
            {
              id: "tmpl-support",
              variableBindings: [
                { name: "value", source: "attribute", attributePath: "Machine.Temp" },
                { name: "raw", source: "static_number", staticValue: 3 }
              ]
            }
          ]
        ]),
        flowById: new Map([["flow-x", { id: "flow-x", variables: [{ name: "temp", source: "static_number", staticValue: 9 }] }]])
      }
    );
    assert.equal((resolved as any).value?.value ?? (resolved as any).value, 7);
    assert.equal(resolved.raw, 3);
    assert.match(prepareScriptSource("asset.set('a',1); helpers.http({url:'x'});"), /await asset\.set/);
    assert.match(buildScriptSource("send(msg);"), /const asset = context && context\.asset \? context\.asset : null;/);

    const eventTemplate: EventTemplateDefinition = {
      id: "evt-bind",
      eventPathTemplate: "Plant/{asset}",
      bindings: [{ name: "asset", source: "static_string", defaultValue: "M-1" }]
    };
    const eventResolved = await resolveBindings(eventTemplate, {}, context, { id: "m5", ts: "2026-01-01T00:00:00.000Z" });
    assert.equal(renderTextTemplate("Hello {asset}", eventResolved), "Hello M-1");
  });
});
