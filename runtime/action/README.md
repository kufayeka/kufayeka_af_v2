# Action Domain Manual

Domain `action` bertugas mengubah definisi action di program menjadi `RuntimeNodeHandler` yang siap dijalankan oleh engine.

## Tugas Inti Domain

- membuat handler untuk script action
- membuat handler untuk event action
- melakukan binding input action
- menyiapkan helper runtime yang dipakai action saat eksekusi

## Domain Ini Melayani Apa

Domain ini melayani:

- `flow` saat node action didaftarkan
- runtime saat node action dieksekusi
- event template path untuk event action open/close

## Input Domain

Input utama:

- definisi script action
- definisi event action
- template map script
- template map event
- flow definition map
- runtime context (`asset`, `eventSys`, `db`, `flow`, `global`)

## Output Domain

Output utama:

- `RuntimeNodeHandler`
- message yang diteruskan ke node berikutnya lewat `send`
- efek samping runtime seperti write asset, open/close event, atau HTTP call dari script

## Dependency Utama

- [`ActionDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ActionDomainController.ts)
- [`ScriptActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionHandlerFactory.ts)
- [`ScriptActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionSupport.ts)
- [`EventActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionHandlerFactory.ts)
- [`EventActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionSupport.ts)

Dependency luar domain yang dipakai saat runtime:

- `context.asset`
- `context.eventSys`
- `context.db`
- flow variables
- template map dari composition

## Rules Internal

- `ActionDomainController` adalah facade domain
- file `*HandlerFactory` membuat handler
- file `*Support` berisi helper detail yang dipakai factory
- handler harus tetap kecil dan delegasikan logic ke support bila mulai membengkak

## Rules Kalau Mau Edit

- kalau ubah perilaku binding, cek impact ke script dan event action sekaligus
- kalau menambah helper script, tempatkan di `ScriptActionSupport`
- jangan tanam dependency baru langsung di handler kalau bisa disuntikkan lewat options
- error handling harus jelas karena action adalah titik yang paling sering gagal saat runtime

## Kalau Mau Nambah Fitur

Gunakan pola ini:

1. tambah contract/type action bila perlu
2. tambah resolver/support
3. tambah atau ubah handler factory
4. expose lewat `ActionDomainController`
5. pastikan `flow` tetap hanya memanggil controller, bukan detail helper
