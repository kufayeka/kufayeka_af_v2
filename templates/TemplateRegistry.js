class TemplateRegistry {
  constructor() {
    this.templates = new Map();
  }

  define(templateId, factory) {
    if (!templateId || typeof templateId !== "string") {
      throw new Error("templateId wajib string");
    }
    if (typeof factory !== "function") {
      throw new Error(`Factory template "${templateId}" wajib function`);
    }
    this.templates.set(templateId, factory);
  }

  has(templateId) {
    return this.templates.has(templateId);
  }

  create(templateId, config = {}) {
    const factory = this.templates.get(templateId);
    if (!factory) {
      throw new Error(`Template "${templateId}" tidak terdaftar`);
    }

    const handler = factory(config);
    if (typeof handler !== "function") {
      throw new Error(`Template "${templateId}" harus menghasilkan handler`);
    }
    return handler;
  }
}

module.exports = TemplateRegistry;
