# Attribute Template README

Panduan ini menjelaskan cara operasional **Attribute Template** pada editor, termasuk fitur dashboard (`show`, `editable`, `nullable`, input type, options script).

## Lokasi UI

1. Buka editor utama (`/`).
2. Masuk tab `Asset Manager`.
3. Masuk sub-tab `Attribute Template`.

## Konsep Data

Satu `Attribute Template` berisi daftar attribute yang dapat dipakai oleh banyak asset.

Setiap attribute punya properti utama:

- `name`
- `valueType` (`number`, `boolean`, `string`, `array`, `object`)
- `default`
- `unit`

Tambahan properti dashboard:

- `dashboardVisible`: tampil di dashboard operator
- `dashboardEditable`: bisa diedit operator atau read-only
- `nullable`: boleh diset `null`
- `inputType`: jenis komponen input di dashboard
- `optionsScript`: script async untuk menghasilkan opsi `label/value` (khusus select/radio/multiselect)
- `options`: fallback legacy (opsional)
- Number rules (khusus `inputType=number`):
  - `numberMin`, `numberMax`
  - `numberAllowNegative`
  - `numberUseThousandSeparator`
  - `numberPrefix`, `numberSuffix`
  - `numberAllowDecimal`
  - `numberPrecision`

## Cara Buat Template

1. Klik `Add Template`.
2. Isi `Template Name`.
3. Klik `Add Attribute`.
4. Isi field attribute:
   - Name
   - Type
   - Default Value
   - Unit
5. Set flag dashboard sesuai kebutuhan.
6. Klik `Save JSON` di header editor.

## Penjelasan Flag Dashboard

### 1) Show in Dashboard

- `ON`: attribute muncul di `/asset-dashboard`.
- `OFF`: attribute disembunyikan dari dashboard operator.

### 2) Editable

- `ON`: operator bisa ubah nilai attribute.
- `OFF`: operator hanya lihat nilai (read-only).

### 3) Nullable

- `ON`: dashboard menampilkan aksi `Set Null`.
- Saat disimpan dengan `null`, override asset dihapus, lalu value kembali ke `default` template.
- `OFF`: tidak boleh null melalui aksi dashboard.

## Input Mode

`inputType` menentukan komponen UI di `/asset-dashboard`:

- `text`: text field
- `number`: numeric input
- `boolean`: checkbox
- `json`: JSON editor (Monaco mini)
- `select`: dropdown single-value
- `radio`: radio button single-value
- `multiselect`: checklist multi-value (hasil array)
- `textarea`: text area multi-line

## Options Script (Select/Radio/Multiselect)

Source opsi sekarang selalu dari `optionsScript` (dinamis).

Script boleh `await fetch(...)` lalu `return` data. Sistem akan normalisasi hasil ke format:

```json
[{ "label": "...", "value": "..." }]
```

Contoh:

```javascript
const res = await fetch("https://example.com/api/operators");
const rows = await res.json();
return rows.map((row) => ({
  label: String(row.full_name),
  value: row.id
}));
```

Normalisasi yang didukung:

- Array object `{ label, value }`
- Array object lain (`name/id` akan dipetakan otomatis)
- Array primitive (`string/number/boolean`)
- Object berbentuk `{ data: [...] }`

Jika script gagal / return kosong, UI akan fallback ke data `options` legacy (jika ada). Default value attribute tetap memakai `default` template.

## Number Rules (Dashboard)

Untuk field `number`, dashboard akan:

- rata kiri pada input
- validasi min/max
- validasi boleh/tidaknya nilai negatif
- validasi decimal/float dan batas `precision`
- format ribuan jika `numberUseThousandSeparator=true`
- tampilkan `prefix/suffix`

## Cara Terapkan Template ke Asset

1. Masuk sub-tab `Asset Explorer`.
2. Pilih asset.
3. Pada field `Attribute Templates`, pilih template yang mau diterapkan.
4. Nilai default attribute otomatis ikut sesuai template.
5. Simpan dengan `Save JSON`.

## Operasional Dashboard (`/asset-dashboard`)

Halaman ini berisi:

- Card kiri: tree explorer asset.
- Card kanan: form attribute yang sudah `showInDashboard=true`.

Aturan:

- `show=true`, `editable=true`: tampil + editable.
- `show=true`, `editable=false`: tampil + read-only.
- `show=false`: tidak tampil.

Refresh:

- Tombol icon refresh untuk load data terbaru dari program JSON.

Save:

- Tombol `Save` menyimpan perubahan nilai ke program JSON.
- Untuk field nullable yang diset `null`, override dihapus (revert ke default).

## Catatan Praktik Baik

- Jangan expose attribute internal PLC/debug ke dashboard operator.
  - Contoh: `currentMachineEventUUID`, `plcEncoderValue`.
- Untuk dropdown ERP/live data, lebih aman pakai API internal/proxy daripada direct dari browser.
- Gunakan `multiselect` untuk kebutuhan checklist capability.
