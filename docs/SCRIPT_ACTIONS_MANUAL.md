# Script Actions Manual

Panduan ini untuk menulis script di **Action Script Manager**.

## 1) Konteks Script

Di action type `script`, kamu punya parameter:

- `msg`: payload/message yang mengalir di flow
- `send(msg)`: kirim output ke node berikutnya
- `context.global`: akses global store runtime
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

### Opsi A (paling aman): lewat API runtime

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

### Opsi B: baca global store langsung

```javascript
const assetFramework = context.global.get("assetFramework", { assets: [], attributeTemplates: [] });
msg.payload = assetFramework;
send(msg);
```

Catatan: kalau update manual global object, kamu wajib set kembali:

```javascript
const af = context.global.get("assetFramework", { assets: [], attributeTemplates: [] });
// ...ubah af...
context.global.set("assetFramework", af);
send(msg);
```

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

Update ke `http://localhost:4000/api/assets/...` mengubah state runtime (memory/global store).

Editor tree membaca data dari file program (`/api/program` -> `programs/main.af.json`), bukan langsung dari runtime memory.

Jadi perubahan runtime tidak otomatis terlihat di editor kalau file belum disimpan ulang.
