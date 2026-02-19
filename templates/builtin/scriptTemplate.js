const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function createScriptTemplate(config = {}) {
  const name = config.name || "script-node";
  const script = config.script || "send(msg);";

  const runScript = new AsyncFunction(
    "msg",
    "send",
    "context",
    "helpers",
    script
  );

  return async function scriptNode(msg, send, context) {
    const helpers = {
      log: (...args) => console.log(`[${name}]`, ...args),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fetch: (...args) => fetch(...args),
    };

    await runScript(msg, send, context, helpers);
  };
}

module.exports = createScriptTemplate;
