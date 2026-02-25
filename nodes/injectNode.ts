import Runtime from "../runtime/Runtime";

export default function createInjectNode(runtime: Runtime): (payload: unknown) => void {
  return function inject(payload: unknown): void {
    const msg = { payload };
    console.log("inject:", msg.payload);

    setInterval(() => {
      runtime.send("inject", msg);
    }, 1000);
  };
}
