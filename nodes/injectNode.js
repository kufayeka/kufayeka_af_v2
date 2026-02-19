function createInjectNode(runtime) {
  return function inject(payload) {
    const msg = { payload };
    console.log("inject:", msg.payload);

    setInterval(() => {
      runtime.send("inject", msg);
    }, 1000);
  };
}

module.exports = createInjectNode;
