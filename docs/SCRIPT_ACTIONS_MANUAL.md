# Script Actions Manual

Panduan ini menjelaskan runtime script action secara detail: context yang tersedia, source binding, tipe value yang didapat, dan cara akses yang aman.

## 1) Runtime Context di Script

Di action type `script`, function kamu dieksekusi dengan parameter:

- `msg`: message flow saat ini
- `send(msg)`: kirim output ke node berikutnya
- `context`: akses runtime store (`global`, `asset`, `eventSys`)
- `helpers`: util bawaan

Contoh paling sederhana:

```javascript
msg.payload = "HALO " + JSON.stringify(msg.payload);
send(msg);
```

### 1.1 `msg`

Runtime menormalkan `msg`:

- `msg.id` selalu ada (UUID) jika sebelumnya tidak ada
- `msg.ts` selalu ada (ISO timestamp) jika sebelumnya tidak ada

Jadi biasanya aman mengakses:

```javascript
const ts = msg.ts; // selalu ada setelah masuk runtime
```

### 1.2 `context.global`

API:

- `context.global.get(key, defaultValue?)`
- `context.global.set(key, value)`
- `context.global.has(key)`
- `context.global.delete(key)`

Contoh:

```javascript
const counter = context.global.get("counter", 0);
context.global.set("counter", counter + 1);
send(msg);
```

### 1.3 `context.asset`

API:

- `context.asset.query(path)` -> semua match (`asset` + `attribute`)
- `context.asset.get(path, defaultValue?)` -> value attribute (single/array/default)
- `context.asset.getAll(path)` -> list match attribute
- `context.asset.set(path, value)` -> set attribute by path
- `context.asset.setMany([{ path, value }])` -> bulk set
- `context.asset.hierarchy(options?)` -> tree hierarchy

Contoh:

```javascript
const speed = context.asset.get("Jasuindo.Taiyo1.MachineSpeed", 0);
context.asset.set("Jasuindo.Taiyo1.MachineSpeed", speed + 1);
send(msg);
```

### 1.4 `eventSys`

API:

- `eventSys.open(path, ts, context, notes, severity?)`
- `eventSys.close(patternWildcard, ts, notesOnClose)`
- `eventSys.get(patternWildcard, from, to, status, contextFilters, options?)`

Contoh:

```javascript
eventSys.open(
  "Jasuindo.OffsetPrinter.Taiyo1/WO/WO123/Event/Activity/Setup",
  msg.ts,
  { operator: "OP-01", shift: "A" },
  "Start setup",
  "low"
);
send(msg);
```

### 1.5 `helpers`

Util:

- `helpers.log(...args)`
- `helpers.sleep(ms)`
- `helpers.fetch(url, options?)`
- `helpers.now()`

Contoh:

```javascript
await helpers.sleep(200);
helpers.log("Current time:", helpers.now());
send(msg);
```

## 2) Variable Binding (Script Template)

Binding dipakai di `Script Template > Variable Bindings`. Saat template dipakai action:

1. Runtime resolve semua binding dulu.
2. Hasil resolve di-inject sebagai variabel langsung ke script (via `with(__bindings)`).
3. Jadi kamu bisa langsung pakai nama binding, misalnya `MachineAsset`, `Speed`, `Threshold`.

## 3) Source Binding dan Tipe Value

Source yang tersedia:

- `asset`
- `attribute`
- `static_string`
- `static_number`
- `static_boolean`
- `static_array`
- `static_object`

### 3.1 Kontrak tipe hasil resolve

Secara praktis, bentuk data hasil binding:

```ts
type BindingValue =
  | null
  | AssetMatch
  | AssetMatch[]
  | AttributeMatch
  | AttributeMatch[]
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

interface AssetMatch {
  kind: "asset";
  path: string;      // contoh: "Jasuindo.Taiyo1"
  assetId: string;
  value: {
    id: string;
    name: string;
    parentId: string | null;
    templateIds: string[];
    attributes: Record<string, { value: unknown; ts?: string; quality?: string }>;
  };
}

interface AttributeMatch {
  kind: "attribute";
  path: string;      // contoh: "Jasuindo.Taiyo1.MachineSpeed"
  assetId: string;
  attributeName: string;
  value: unknown;    // nilai attribute efektif (template default + override)
  ts?: string;
  type: string;      // valueType template, fallback "custom"
  unit: string;
  historianEnabled: boolean;
  historianTimeSourcePath: string;
  historianTargetId: string;
}
```

### 3.2 Source `asset`

Input path:

- pakai path asset, contoh: `Jasuindo.Taiyo1`
- bisa wildcard, contoh: `Jasuindo.*`

Output:

- 0 match -> `null`
- 1 match -> `AssetMatch`
- >1 match -> `AssetMatch[]`

Contoh akses:

```javascript
// Misal binding: MachineAsset (source=asset, path=Jasuindo.Taiyo1)
const assetName = MachineAsset?.value?.name;
const attrs = MachineAsset?.value?.attributes || {};
msg.payload = { assetName, attrs };
send(msg);
```

### 3.3 Source `attribute`

Input path:

- path attribute, contoh: `Jasuindo.Taiyo1.MachineSpeed`
- bisa wildcard, contoh: `Jasuindo.*.MachineSpeed`

Output:

- 0 match -> `null`
- 1 match -> `AttributeMatch`
- >1 match -> `AttributeMatch[]`

Contoh akses:

```javascript
// Misal binding: SpeedPV (source=attribute, path=Jasuindo.Taiyo1.MachineSpeed)
const speed = Number(SpeedPV?.value ?? 0);
const unit = SpeedPV?.unit || "";
msg.payload = { speed, unit };
send(msg);
```

### 3.4 Source `static_*`

Runtime melakukan coercion:

- `static_string` -> string (default `""`)
- `static_number` -> number (default `0`)
- `static_boolean` -> boolean
- `static_array` -> array (default `[]`)
- `static_object` -> object (default `{}`)

Catatan coercion:

- `static_boolean`: string `"true"` (case-insensitive) -> `true`, selain itu `false`
- `static_number`: pakai `Number(value || 0)`
- `static_array`: non-array -> dibungkus jadi array (`[value]`)
- `static_object`: non-object -> `{}`

## 4) Cara Aman Akses Binding (Single/Wildcard)

Karena `asset` dan `attribute` bisa return object tunggal atau array, pakai helper kecil:

```javascript
function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

const speedRows = toArray(SpeedPV); // aman untuk single/null/multi
const speeds = speedRows.map((row) => Number(row.value ?? 0));
```

Pattern umum:

- Jika butuh satu item: pakai `const row = Array.isArray(x) ? x[0] : x;`
- Jika butuh semua item: pakai `toArray(...)` lalu `map/filter/reduce`

## 5) Contoh Lengkap per Binding

### 5.1 Binding `asset` + `attribute` + `static_*`

Contoh konfigurasi:

- `Machine`: `asset` -> `Jasuindo.Taiyo1`
- `SpeedPV`: `attribute` -> `Jasuindo.Taiyo1.MachineSpeed`
- `Threshold`: `static_number` -> `8`
- `AlarmText`: `static_string` -> `"Machine speed high"`

Contoh script:

```javascript
const machineName = Machine?.value?.name ?? "-";
const speed = Number(SpeedPV?.value ?? 0);
const threshold = Number(Threshold ?? 0);

msg.payload = {
  machineName,
  speed,
  threshold,
  isHigh: speed > threshold,
  alarmText: String(AlarmText ?? "")
};

send(msg);
```

### 5.2 Binding wildcard multi-match

Contoh:

- `Speeds`: `attribute` -> `Jasuindo.*.MachineSpeed`

Script:

```javascript
const rows = Array.isArray(Speeds) ? Speeds : Speeds ? [Speeds] : [];
const payload = rows.map((row) => ({
  path: row.path,
  value: row.value,
  type: row.type,
  unit: row.unit
}));
msg.payload = payload;
send(msg);
```

## 6) Error Handling Pattern

```javascript
try {
  const res = await helpers.fetch("http://127.0.0.1:4000/api/assets/query?path=Jasuindo.*");
  if (!res.ok) throw new Error("API error " + res.status);
  const data = await res.json();
  msg.payload = data;
} catch (err) {
  helpers.log("Script error:", err.message);
  msg.payload = { error: err.message };
}
send(msg);
```

## 7) Persistensi yang Perlu Dipahami

- Runtime `assetStorage` adalah source of truth nilai attribute.
- Snapshot compat tetap tersedia di `context.global.get("assetFramework", ...)`.
- Saat save program, backend mengambil snapshot latest dari runtime lalu menulis ke file program.

Jadi file program merepresentasikan snapshot runtime terbaru saat save.

Optional env:

- `KUFAYEKA_RUNTIME_ASSET_API`
  - override URL runtime API yang dipakai editor saat load/save assets.

## 8) FAQ Praktis

### Q: Jika aku punya binding `X`, value yang kudapat apa?

Tergantung `source`:

- `asset` -> `null | AssetMatch | AssetMatch[]`
- `attribute` -> `null | AttributeMatch | AttributeMatch[]`
- `static_*` -> value statis hasil coercion

### Q: Ambil nilai actual-nya dari mana?

- Untuk `attribute`: `X.value`
- Untuk `asset`: object asset ada di `X.value`, attribute override mentah di `X.value.attributes`

### Q: Bisa langsung update asset lewat binding?

Tidak. Binding adalah data resolve saat eksekusi script. Untuk update pakai:

- `context.asset.set(path, value)`
- `context.asset.setMany(items)`

