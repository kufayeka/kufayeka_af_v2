# Core Manual

Folder `core` berisi utilitas engine-level yang netral terhadap domain bisnis.

## Tugas Inti Folder

- mendefinisikan type runtime utama
- mengelola utilitas execution dan queue
- mengelola utilitas message normalization dan routing

## Folder Ini Melayani Apa

Folder ini melayani:

- `Runtime.ts`
- composition layer
- semua domain yang butuh shared type runtime

## File Penting

- [`runtimeTypes.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core/runtimeTypes.ts)
- [`runtimeExecutionUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core/runtimeExecutionUtils.ts)
- [`runtimeMessageUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core/runtimeMessageUtils.ts)

## Yang Boleh Masuk ke Core

- type umum runtime
- utility queue/inflight/timeout yang tidak tahu domain bisnis
- utility message normalization dan output-port resolution

## Yang Tidak Boleh Masuk ke Core

- logic asset
- logic event template
- query historian
- behavior flow/program yang spesifik

## Rules Kalau Mau Edit

- kalau utility mulai tahu detail domain, itu bukan lagi milik `core`
- jangan menaruh helper convenience yang sebenarnya hanya dipakai satu domain
- perubahan di `runtimeTypes.ts` harus dianggap high-impact karena hampir semua folder bergantung padanya
