# Flow Manager Manual

Panduan penggunaan tab **Flow Manager**.

## 1) Konsep

- Trigger node: sumber event (`trigger.*`)
- Action node: script eksekusi (`aa.bb.cc.dd` atau id action lain)
- Link/wire: koneksi `from -> to`

## 2) Cara Buat Koneksi

### Via diagram (Node-RED style)

1. Klik port **OUT** (kanan) node sumber.
2. Klik port **IN** (kiri) node tujuan.
3. Wire otomatis ditambahkan.

### Via Connection Manager table

1. Pilih `From`.
2. Pilih `To`.
3. Klik `Add`.

## 3) Drag Node & Layout

- Node bisa dipindah dari handle `move`.
- Posisi snap ke grid.
- Posisi disimpan di `flows.nodePositions`.

## 4) Zoom dan Pan

- `+`, `-`, `Reset` untuk zoom.
- Drag area kosong canvas untuk pan.

## 5) Edit Link

Di tabel link:

- Ubah `From`/`To` inline.
- Toggle `Enabled`.
- `Remove` untuk hapus link.

## 6) Penamaan Node Action Hierarchy

Action id dipakai sebagai node id di flow.

Contoh:

- `ppic.line1.prepare`
- `ppic.line1.validate`
- `maintenance.taiyo1.calibrate`

Rename action id otomatis update referensi link yang sudah ada.
