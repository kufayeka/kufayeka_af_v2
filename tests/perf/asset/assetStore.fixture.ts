import type { AssetSection, AttributeTemplate } from "../../../runtime/core/runtimeTypes";

export interface AssetPerfFixtureOptions {
  machineCount: number;
  attributesPerMachine: number;
  lineCount?: number;
  areaCount?: number;
}

export interface AssetPerfFixture {
  section: AssetSection;
  machinePaths: string[];
  attributePaths: string[];
  hotAttributePaths: string[];
}

function createTemplate(attributesPerMachine: number): AttributeTemplate {
  return {
    id: "template.machine.default",
    name: "Machine Default",
    attributes: Array.from({ length: attributesPerMachine }, (_, index) => ({
      enabled: true,
      name: `Attr${String(index + 1).padStart(3, "0")}`,
      valueType: index % 5 === 0 ? "string" : "float64",
      default: index % 5 === 0 ? "-" : 0,
      unit: index % 5 === 0 ? "" : "unit",
      historianEnabled: false,
      historianTimeSourcePath: "",
      historianTargetId: "default",
      dashboardVisible: true,
      dashboardEditable: true,
      nullable: false,
      inputType: "text",
      options: [],
      optionsScript: "",
      numberMin: null,
      numberMax: null,
      numberAllowNegative: true,
      numberUseThousandSeparator: false,
      numberPrefix: "",
      numberSuffix: "",
      numberAllowDecimal: true,
      numberPrecision: 2
    }))
  };
}

export function createAssetPerfFixture(options: AssetPerfFixtureOptions): AssetPerfFixture {
  const areaCount = Math.max(1, options.areaCount ?? 4);
  const lineCount = Math.max(1, options.lineCount ?? 4);
  const machineCount = Math.max(1, options.machineCount);
  const attributesPerMachine = Math.max(1, options.attributesPerMachine);
  const section: AssetSection = {
    assets: [],
    attributeTemplates: [createTemplate(attributesPerMachine)],
    historians: []
  };
  const machinePaths: string[] = [];
  const attributePaths: string[] = [];

  section.assets.push({
    id: "site.main",
    name: "MainSite",
    parentId: null,
    templateIds: [],
    attributes: {}
  });

  for (let areaIndex = 0; areaIndex < areaCount; areaIndex += 1) {
    const areaId = `area.${areaIndex + 1}`;
    section.assets.push({
      id: areaId,
      name: `Area${areaIndex + 1}`,
      parentId: "site.main",
      templateIds: [],
      attributes: {}
    });
  }

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const areaId = `area.${(lineIndex % areaCount) + 1}`;
    const lineId = `line.${lineIndex + 1}`;
    section.assets.push({
      id: lineId,
      name: `Line${lineIndex + 1}`,
      parentId: areaId,
      templateIds: [],
      attributes: {}
    });
  }

  for (let machineIndex = 0; machineIndex < machineCount; machineIndex += 1) {
    const lineId = `line.${(machineIndex % lineCount) + 1}`;
    const machineId = `machine.${machineIndex + 1}`;
    const machineName = `Machine${String(machineIndex + 1).padStart(4, "0")}`;
    const attributes: Record<string, { value: unknown; ts: string }> = {};
    for (let attributeIndex = 0; attributeIndex < attributesPerMachine; attributeIndex += 1) {
      const name = `Attr${String(attributeIndex + 1).padStart(3, "0")}`;
      attributes[name] = {
        value: attributeIndex % 5 === 0 ? `seed-${machineIndex + 1}-${attributeIndex + 1}` : attributeIndex,
        ts: "2026-01-01T00:00:00.000Z"
      };
    }

    section.assets.push({
      id: machineId,
      name: machineName,
      parentId: lineId,
      templateIds: ["template.machine.default"],
      attributes
    });

    const machinePath = `MainSite.Area${((machineIndex % areaCount) + 1)}.Line${((machineIndex % lineCount) + 1)}.${machineName}`;
    machinePaths.push(machinePath);
    for (let attributeIndex = 0; attributeIndex < attributesPerMachine; attributeIndex += 1) {
      const attributePath = `${machinePath}.Attr${String(attributeIndex + 1).padStart(3, "0")}`;
      attributePaths.push(attributePath);
    }
  }

  return {
    section,
    machinePaths,
    attributePaths,
    hotAttributePaths: attributePaths.slice(0, Math.min(attributePaths.length, 250))
  };
}
