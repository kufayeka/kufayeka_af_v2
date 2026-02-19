const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function createScriptActionHandler(action) {
  const script = action.script || "send(msg);";
  const compiled = new AsyncFunction(
    "msg",
    "send",
    "context",
    "helpers",
    "config",
    script
  );

  return async (msg, send, context) => {
    const helpers = {
      log: (...args) => console.log(`[${action.id}]`, ...args),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: (...args) => fetch(...args),
      now: () => new Date().toISOString(),
    };

    await compiled(msg, send, context, helpers, action.config || {});
  };
}

module.exports = createScriptActionHandler;
