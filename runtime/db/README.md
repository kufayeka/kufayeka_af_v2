# DB Manual

Folder `db` adalah abstraction untuk koneksi database dan operasi SQL backend runtime.

## Tugas Inti Folder

- menyimpan konfigurasi DB runtime
- menyediakan query umum
- menyediakan jalur enqueue/write untuk historian
- menjadi dependency backend untuk event store dan historian

## Folder Ini Melayani Apa

- event domain
- historian domain
- runtime API yang butuh query SQL

## File Penting

- [`dbConfig.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/db/dbConfig.ts)
- [`dbConnectionManager.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/db/dbConnectionManager.ts)

## Input

- environment/config runtime
- query SQL
- historian rows

## Output

- hasil query
- status koneksi
- enqueue operasi backend

## Rules Kalau Mau Edit

- validasi dan sanitasi input SQL/helper harus tetap ketat
- jangan campurkan logic domain event atau historian ke file DB
- DB layer hanya menyediakan kemampuan teknis, bukan keputusan domain
