import type { RuntimeNodeHandler } from "../runtime/types";

const fn3Node: RuntimeNodeHandler = (msg, send, context) => {
  const countKey = "fn3.seenCount";
  const nextCount = context.global.get<number>(countKey, 0) + 1;
  context.global.set(countKey, nextCount);

  console.log("fn3 ini payload:", msg.payload, "| total seen:", nextCount);
  send(msg);
};

export default fn3Node;
