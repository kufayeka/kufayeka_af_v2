const createScriptTemplate = require("./builtin/scriptTemplate");

function registerBuiltinTemplates(registry) {
  registry.define("script", createScriptTemplate);
}

module.exports = registerBuiltinTemplates;
