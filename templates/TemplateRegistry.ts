import type { RuntimeNodeContext, RuntimeNodeHandler, RuntimeMessage } from "../runtime/types";

type TemplateFactory = (config?: Record<string, unknown>) => RuntimeNodeHandler;

export default class TemplateRegistry {
  private readonly templates = new Map<string, TemplateFactory>();

  define(templateId: string, factory: TemplateFactory): void {
    if (!templateId || typeof templateId !== "string") throw new Error("templateId must be a string");
    if (typeof factory !== "function") throw new Error(`Template factory "${templateId}" must be a function`);
    this.templates.set(templateId, factory);
  }

  has(templateId: string): boolean {
    return this.templates.has(templateId);
  }

  create(templateId: string, config: Record<string, unknown> = {}): RuntimeNodeHandler {
    const factory = this.templates.get(templateId);
    if (!factory) throw new Error(`Template "${templateId}" is not registered`);
    const handler = factory(config);
    if (typeof handler !== "function") throw new Error(`Template "${templateId}" must return a handler function`);
    return async (msg: RuntimeMessage, send: (nextMsg: RuntimeMessage) => void, context: RuntimeNodeContext) => {
      await handler(msg, send, context);
    };
  }
}
