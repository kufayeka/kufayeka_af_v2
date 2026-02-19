import type {
  ActionDefinition,
  AssetFrameworkDefinition,
  FlowLink,
  Program,
  TriggerDefinition
} from "../types/program";

export function upsertById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>
): T[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function renameNodeInLinks(links: FlowLink[], oldId: string, newId: string): FlowLink[] {
  return links.map((link) => ({
    ...link,
    from: link.from === oldId ? newId : link.from,
    to: link.to === oldId ? newId : link.to
  }));
}

export function removeNodeFromLinks(links: FlowLink[], nodeId: string): FlowLink[] {
  return links.filter((link) => link.from !== nodeId && link.to !== nodeId);
}

export function parseMaybeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function normalizeProgram(program: Program): Program {
  const normalizedAssets: AssetFrameworkDefinition = {
    assets: (program.assets?.assets || []).map((asset) => ({
      ...asset,
      parentId: asset.parentId ?? null,
      templateIds: Array.isArray(asset.templateIds) ? asset.templateIds : [],
      attributes: asset.attributes || {}
    })),
    attributeTemplates: (program.assets?.attributeTemplates || []).map((template) => ({
      ...template,
      attributes: (template.attributes || []).map((attribute) => ({
        ...attribute,
        unit: attribute.unit ?? ""
      }))
    }))
  };

  return {
    ...program,
    triggers: (program.triggers || []).map(
      (trigger): TriggerDefinition => ({
        ...trigger,
        enabled: trigger.enabled !== false
      })
    ),
    actions: (program.actions || []).map(
      (action): ActionDefinition => ({
        ...action,
        enabled: action.enabled !== false,
        description: action.description ?? ""
      })
    ),
    flows: {
      ...program.flows,
      links: ((program.flows && program.flows.links) || []).map((link) => ({
        ...link,
        enabled: link.enabled !== false
      }))
    },
    assets: normalizedAssets
  };
}
