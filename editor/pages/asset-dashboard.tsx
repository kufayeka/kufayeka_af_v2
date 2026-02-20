import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import Tree from "rc-tree";
import type { DataNode, Key } from "rc-tree/lib/interface";
import { ArrowRight, Building2 } from "lucide-react";
import { normalizeProgram } from "../lib/programUtils";
import type { AssetDefinition, Program } from "../types/program";

const EMPTY_PROGRAM: Program = {
  meta: { name: "Kufayeka AF Program", version: 1 },
  triggers: [],
  actions: [],
  scriptTemplates: [],
  flows: { links: [] },
  assets: { assets: [], attributeTemplates: [] }
};

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function buildChildrenMap(assets: AssetDefinition[]): Map<string | null, AssetDefinition[]> {
  const map = new Map<string | null, AssetDefinition[]>();
  for (const asset of assets) {
    const key = asset.parentId ?? null;
    const list = map.get(key) || [];
    list.push(asset);
    map.set(key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

function getEffectiveDashboardAttributes(
  asset: AssetDefinition,
  templateById: Map<string, Program["assets"]["attributeTemplates"][number]>
) {
  const rows = new Map<string, { name: string; value: unknown; unit: string; dashboardVisible: boolean }>();

  for (const templateId of asset.templateIds) {
    const template = templateById.get(templateId);
    if (!template) continue;
    for (const attr of template.attributes) {
      const prev = rows.get(attr.name);
      if (!prev) {
        rows.set(attr.name, {
          name: attr.name,
          value: attr.defaultValue,
          unit: attr.unit ?? "",
          dashboardVisible: attr.dashboardVisible === true
        });
      } else if (attr.dashboardVisible === true) {
        rows.set(attr.name, { ...prev, dashboardVisible: true });
      }
    }
  }

  for (const [name, val] of Object.entries(asset.attributes || {})) {
    const prev = rows.get(name);
    if (prev) {
      rows.set(name, { ...prev, value: val.value });
    }
  }

  return Array.from(rows.values())
    .filter((item) => item.dashboardVisible)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function AssetDashboardPage() {
  const [program, setProgram] = useState<Program>(EMPTY_PROGRAM);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [status, setStatus] = useState("Loading...");

  useEffect(() => {
    fetch("/api/program")
      .then((res) => res.json())
      .then((data: { program?: Program }) => {
        const next = normalizeProgram(data.program ?? EMPTY_PROGRAM);
        setProgram(next);
        setSelectedAssetId(next.assets.assets[0]?.id ?? "");
        setExpandedKeys(next.assets.assets.map((asset) => `asset:${asset.id}`));
        setStatus("Program loaded");
      })
      .catch((error: Error) => setStatus(`Load error: ${error.message}`));
  }, []);

  const assetById = useMemo(
    () => new Map(program.assets.assets.map((asset) => [asset.id, asset])),
    [program.assets.assets]
  );
  const templateById = useMemo(
    () => new Map(program.assets.attributeTemplates.map((template) => [template.id, template])),
    [program.assets.attributeTemplates]
  );
  const selectedAsset = selectedAssetId ? assetById.get(selectedAssetId) : undefined;

  const treeData = useMemo(() => {
    const childrenMap = buildChildrenMap(program.assets.assets);
    const buildNode = (asset: AssetDefinition): DataNode => {
      const attrs = getEffectiveDashboardAttributes(asset, templateById);
      return {
        key: `asset:${asset.id}`,
        title: (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Building2 size={15} />
            <Typography variant="body2">{asset.name}</Typography>
          </Box>
        ),
        children: [
          ...(childrenMap.get(asset.id) || []).map(buildNode),
          ...attrs.map((attr) => ({
            key: `attr:${asset.id}:${attr.name}`,
            title: (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <ArrowRight size={14} />
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {attr.name}: {serializeValue(attr.value)} {attr.unit || ""}
                </Typography>
              </Box>
            ),
            isLeaf: true
          }))
        ]
      };
    };

    return (childrenMap.get(null) || []).map(buildNode);
  }, [program.assets.assets, templateById]);

  const dashboardAttributes = useMemo(() => {
    if (!selectedAsset) return [];
    return getEffectiveDashboardAttributes(selectedAsset, templateById);
  }, [selectedAsset, templateById]);

  const updateAttributeValue = (attributeName: string, rawValue: string) => {
    if (!selectedAsset) return;
    setProgram((prev) => ({
      ...prev,
      assets: {
        ...prev.assets,
        assets: prev.assets.assets.map((asset) =>
          asset.id !== selectedAsset.id
            ? asset
            : {
                ...asset,
                attributes: {
                  ...asset.attributes,
                  [attributeName]: { value: parseMaybeJson(rawValue) }
                }
              }
        )
      }
    }));
  };

  const saveProgram = async () => {
    try {
      const res = await fetch("/api/program", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ program })
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setStatus(`Save error: ${data.error ?? "unknown error"}`);
        return;
      }
      setStatus("Saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Save error: ${message}`);
    }
  };

  return (
    <Box sx={{ p: 1.25, minHeight: "100vh", background: "#f8fafc", display: "grid", gridTemplateRows: "auto 1fr", gap: 1.25 }}>
      <Paper variant="outlined" sx={{ p: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Asset Dashboard Setting
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {status}
          </Typography>
          <Button variant="contained" onClick={saveProgram}>
            Save
          </Button>
        </Box>
      </Paper>

      <Box sx={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 1.25 }}>
        <Paper variant="outlined" sx={{ p: 1, display: "grid", gridTemplateRows: "auto 1fr", gap: 0.75 }}>
          <Typography variant="subtitle2">Asset Explorer</Typography>
          <Box sx={{ overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 0.5, p: 0.5 }}>
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              selectedKeys={selectedAssetId ? [`asset:${selectedAssetId}`] : []}
              onExpand={(keys) => setExpandedKeys(keys)}
              onSelect={(keys) => {
                const key = String(keys[0] || "");
                if (!key) return;
                if (key.startsWith("asset:")) {
                  setSelectedAssetId(key.slice("asset:".length));
                  return;
                }
                if (key.startsWith("attr:")) {
                  const segments = key.split(":");
                  if (segments.length >= 2) setSelectedAssetId(segments[1]);
                }
              }}
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25 }}>
          {!selectedAsset && (
            <Typography variant="body2" color="text.secondary">
              Pilih asset di tree explorer.
            </Typography>
          )}
          {selectedAsset && (
            <Box sx={{ display: "grid", gap: 0.75 }}>
              <Typography variant="h6">Asset Attribute Editor</Typography>
              <Typography variant="caption" color="text.secondary">
                Hanya attribute yang di-expose dari template dashboard yang bisa diubah.
              </Typography>
              <Table size="small" sx={{ border: "1px solid #e2e8f0" }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Unit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dashboardAttributes.map((attribute) => (
                    <TableRow key={`dashboard-${attribute.name}`}>
                      <TableCell>{attribute.name}</TableCell>
                      <TableCell sx={{ minWidth: 220 }}>
                        <TextField
                          size="small"
                          fullWidth
                          value={serializeValue(attribute.value)}
                          onChange={(e) => updateAttributeValue(attribute.name, e.target.value)}
                        />
                      </TableCell>
                      <TableCell>{attribute.unit || "-"}</TableCell>
                    </TableRow>
                  ))}
                  {dashboardAttributes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <Typography variant="caption" color="text.secondary">
                          Tidak ada attribute yang di-expose untuk dashboard pada asset ini.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
