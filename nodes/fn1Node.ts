import type { RuntimeNodeHandler } from "../runtime/types";

const fn1Node: RuntimeNodeHandler = (msg, send, context) => {
  const payload = typeof msg.payload === "number" ? msg.payload : Number(msg.payload || 0);
  msg.payload = payload + 1;

  const attributeData = context.global.get<Record<string, unknown>>("attributeData", {});
  console.log("fn1:", attributeData);

  send(msg);
};

export default fn1Node;
