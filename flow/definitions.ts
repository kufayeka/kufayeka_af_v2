import type { RuntimeNodeHandler } from "../runtime/types";
import fn1Node from "../nodes/fn1Node";
import fn2Node from "../nodes/fn2Node";
import fn3Node from "../nodes/fn3Node";

export const nodeDefinitions: Array<
  | { id: string; handler: RuntimeNodeHandler }
  | { id: string; template: string; config?: Record<string, unknown> }
> = [
  { id: "fn1", handler: fn1Node },
  { id: "fn2", handler: fn2Node },
  { id: "fn3", handler: fn3Node },
  {
    id: "script1",
    template: "script",
    config: {
      name: "script1",
      script: `
        const total = context.global.get("script1.total", 0) + 1;
        context.global.set("script1.total", total);
        msg.script = { total };
        helpers.log("script jalan. total:", total);
        send(msg);
      `,
    },
  },
];

export const wires: Array<[string, string]> = [
  ["inject", "fn1"],
  ["fn1", "fn3"],
  ["fn1", "fn2"],
  ["fn3", "script1"],
];
