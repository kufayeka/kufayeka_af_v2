# Asset API (External) - `http://localhost:4000`

Dokumen ini untuk akses asset system dari API runtime (bukan API editor Next.js).

## Base URL

- `http://localhost:4000`

## 1) Get Asset System (raw)

- `GET /api/assets/system`
- Alias lama: `GET /api/assets`

Contoh:

```bash
curl http://localhost:4000/api/assets/system
```

Response:

```json
{
  "data": {
    "assets": [],
    "attributeTemplates": []
  }
}
```

## 2) Set Asset System (replace full config)

- `PUT /api/assets/system`
- Alias lama: `PUT /api/assets`
- Body wajib berisi full object:
  - `assets`
  - `attributeTemplates`

Contoh:

```bash
curl -X PUT http://localhost:4000/api/assets/system \
  -H "content-type: application/json" \
  -d '{
    "assets": [
      {
        "id": "asset_root",
        "name": "Surabaya",
        "parentId": null,
        "templateIds": [],
        "attributes": {}
      }
    ],
    "attributeTemplates": []
  }'
```

## 3) Get Populated Hierarchy

- `GET /api/assets/hierarchy`
- Default: populated (`effectiveAttributes` ikut dikembalikan).
- Optional query:
  - `?populated=true|false`
  - nilai truthy: `1`, `true`, `yes`

Contoh:

```bash
curl "http://localhost:4000/api/assets/hierarchy?populated=true"
```

Response node utama:

```json
{
  "id": "asset_root",
  "name": "Surabaya",
  "path": "Surabaya",
  "parentId": null,
  "templateIds": [],
  "attributes": {},
  "effectiveAttributes": [],
  "children": []
}
```

## 4) Query Asset / Attribute by Path

- `GET /api/assets/query?path=<dot-path>`
- Support wildcard `*`

Contoh:

- `Surabaya.Plant1.MesinX`
- `Surabaya.Plant1.*.Encoder`
- `Surabaya.Plant1.*`

```bash
curl "http://localhost:4000/api/assets/query?path=Surabaya.Plant1.*.Encoder"
```

## 5) Get Attribute Value by Path

- `GET /api/assets/value/<encoded-path>`
- Path harus URL-encoded.

Contoh:

```bash
curl "http://localhost:4000/api/assets/value/Surabaya.Plant1.MesinX.Encoder"
```

## 6) Set Attribute Value by Path

- `PUT /api/assets/value/<encoded-path>`
- Body: `{ "value": <any-json> }`
- Support wildcard path.
- Jika attribute belum ada tapi asset path match, attribute baru akan dibuat.

Contoh:

```bash
curl -X PUT "http://localhost:4000/api/assets/value/Surabaya.Plant1.MesinX.Encoder" \
  -H "content-type: application/json" \
  -d '{ "value": 123.45 }'
```

Wildcard write:

```bash
curl -X PUT "http://localhost:4000/api/assets/value/Surabaya.Plant1.*.Encoder" \
  -H "content-type: application/json" \
  -d '{ "value": 0 }'
```

## 7) Batch Set Attribute Value

- `PUT /api/assets/values:batch`
- Body:

```json
{
  "items": [
    { "path": "Surabaya.Plant1.M1.Speed", "value": 8 },
    { "path": "Surabaya.Plant1.M2.Speed", "value": 9 }
  ]
}
```

## Catatan Penting

- API ini memakai `assetStorage` runtime sebagai single source of truth.
- Snapshot compat tetap tersedia di `runtime.globalStore` key: `assetFramework`.
- Endpoint `PUT /api/assets/system` mengganti seluruh state asset system.
- Jika mau patch sebagian, lakukan:
  1. `GET /api/assets/system`
  2. modifikasi di client
  3. `PUT /api/assets/system`
