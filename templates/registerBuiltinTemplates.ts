import TemplateRegistry from "./TemplateRegistry";
import createScriptTemplate from "./builtin/scriptTemplate";

export default function registerBuiltinTemplates(registry: TemplateRegistry): void {
  registry.define("script", createScriptTemplate);
}
