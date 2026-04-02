# Runtime Manual

Folder `runtime/` adalah engine backend untuk menjalankan program flow, asset state, event lifecycle, action execution, historian pipeline, dan integrasi persistence.

## Tujuan Utama Runtime

Runtime melayani kebutuhan berikut:

- menjalankan node flow seperti engine event-loop
- menyimpan state asset aktif di memori
- membuka, menutup, dan meng-query event
- menjalankan script action dan event action
- meneruskan perubahan attribute ke historian
- menyediakan context runtime untuk node handler

## Prinsip Arsitektur

- `Runtime.ts` adalah engine besar utama
- dependency domain dirakit di composition layer
- tiap domain punya controller/service/folder sendiri
- `globalStore` hanya untuk compatibility mirror atau state ringan, bukan dependency injection utama

## Peta Folder

- [`Runtime.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/Runtime.ts): engine inti
- [`action/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action): action handler runtime
- [`asset/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset): asset state dan asset store
- [`composition/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition): composition root dan runtime context
- [`core/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core): utility engine-level dan shared types
- [`db/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/db): DB config dan connection manager
- [`event/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event): event domain
- [`flow/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow): flow orchestration
- [`historian/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian): historian bridge
- [`persistence/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence): persistence runtime state
- [`program/`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/program): start/load program

## Aturan Besar Kalau Mau Edit Runtime

- jangan tambahkan dependency utama baru lewat `runtime.getGlobal(...)` jika bisa dimasukkan ke composition
- jangan menaruh orchestration domain di `Runtime.ts`
- perubahan lintas domain sebaiknya melewati controller atau composition, bukan saling instantiate langsung
- nama file harus deskriptif, hindari `shared`, `utils`, `helper` kalau scope file sebenarnya spesifik
- kalau menambah fitur runtime baru, tentukan dulu dia milik domain mana

## Kalau Mau Nambah Fitur

Urutan yang disarankan:

1. tentukan domain pemilik fitur
2. tambah types/contracts bila perlu
3. tambah service/support/factory di domain itu
4. daftarkan dependency di composition bila dibutuhkan lintas domain
5. expose ke flow/context hanya kalau memang perlu dipakai node runtime
