# Script Actions Manual

Panduan ini untuk menulis script di **Action Script Manager**.

## 1) Konteks Script

Di action type `script`, kamu punya parameter:

- `msg`: payload/message yang mengalir di flow
- `send(msg)`: kirim output ke node berikutnya
- `context.global`: akses global store runtime
- `context.asset`: akses asset storage engine (single source of truth)
- `helpers`: util bawaan
  - `helpers.log(...)`
  - `helpers.sleep(ms)`
  - `helpers.fetch(url, options?)`
  - `helpers.now()`

Contoh paling sederhana:

```javascript
msg.payload = "HALOOOO-" + JSON.stringify(msg.payload);
send(msg);
```

## 2) Akses Asset Attribute dari Script

### Opsi A (recommended): `context.asset`

Get satu nilai attribute:

```javascript
const speed = context.asset.get("Jasuindo.Taiyo1.MachineSpeed", 0);
msg.payload = { speed };
send(msg);
```

Set satu nilai attribute:

```javascript
context.asset.set("Jasuindo.Taiyo1.MachineSpeed", 8);
send(msg);
```

Query wildcard:

```javascript
const matches = context.asset.query("Jasuindo.*.MachineSpeed");
msg.payload = matches;
send(msg);
```

Bulk set:

```javascript
context.asset.setMany([
  { path: "Jasuindo.Taiyo1.MachineSpeed", value: 8 },
  { path: "Jasuindo.Taiyo2.MachineSpeed", value: 10 }
]);
send(msg);
```

### Opsi B: lewat API runtime

Get 1 attribute:

```javascript
const res = await helpers.fetch(
  "http://127.0.0.1:4000/api/assets/value/Jasuindo.Taiyo1.MachineSpeed"
);
const data = await res.json();
const speed = data.matches?.[0]?.value;
msg.payload = { speed };
send(msg);
```

Set attribute:

```javascript
await helpers.fetch(
  "http://127.0.0.1:4000/api/assets/value/Jasuindo.Taiyo1.MachineSpeed",
  {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: 8 })
  }
);
send(msg);
```

Get wildcard:

```javascript
const res = await helpers.fetch(
  "http://127.0.0.1:4000/api/assets/value/Jasuindo.*.MachineSpeed"
);
const data = await res.json();
msg.payload = data.matches;
send(msg);
```

### Opsi C: baca global snapshot (compat)

```javascript
const assetFramework = context.global.get("assetFramework", { assets: [], attributeTemplates: [] });
msg.payload = assetFramework;
send(msg);
```

Catatan: untuk update value attribute, jangan mutate `assetFramework` snapshot manual. Pakai `context.asset.set(...)`.

## 3) Pattern Error Handling

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

## 4) Persistensi yang Perlu Dipahami

- Runtime `assetStorage` adalah source of truth nilai attribute.
- UI editor (tree/dashboard) membaca assets dari runtime saat runtime aktif.
- Saat Save program, backend akan:
1. Push assets config ke runtime.
2. Ambil snapshot latest assets dari runtime.
3. Tulis snapshot itu ke `programs/main.af.json`.

Jadi file program menjadi snapshot terakhir runtime saat save.

Optional env:

- `KUFAYEKA_RUNTIME_ASSET_API`
  - untuk override URL runtime API yang dipakai editor saat load/save assets.
