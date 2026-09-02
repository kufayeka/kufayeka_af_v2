# Flow Manual

Folder `flow` adalah orchestration layer yang mengubah program definition menjadi node runtime, link runtime, dan trigger aktif.

## Tugas Inti Folder

- build flow definitions dari program
- meratakan node dan link per flow
- mendaftarkan node handler ke `Runtime`
- mendaftarkan wire antar node
- menjalankan trigger runtime

## Folder Ini Melayani Apa

- `ProgramBootstrap`
- `Runtime`
- action domain
- event domain
- asset/event triggers

## Input Folder

- program definition
- composition runtime
- template map
- flow variable definition

## Output Folder

- node handler terdaftar di runtime
- wire graph
- stop function trigger
- config node flow untuk context runtime

## File Penting

- [`ProgramBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramBootstrap.ts)
- [`ProgramFlowContracts.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramFlowContracts.ts)
- [`ProgramFlowSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramFlowSupport.ts)
- [`ProgramNodeRegistration.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramNodeRegistration.ts)
- [`ProgramTriggerSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerSupport.ts)
- [`ProgramTriggerStarter.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerStarter.ts)

## Jalur Aktif Saat Ini

Jalur utama ketika program mulai dijalankan:

1. [`ProgramBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramBootstrap.ts) menerima `Runtime` dan `ProgramDefinition`
2. `RuntimeServiceRegistry` dan `RuntimeBootstrap` menyiapkan domain service, asset store, dan event store
3. `ProgramBootstrap` mengambil flow yang enabled, lalu meratakan node dan link per flow
4. [`ProgramNodeRegistration.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramNodeRegistration.ts) mengubah node declarative menjadi handler runtime
5. [`ProgramNodeRegistration.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramNodeRegistration.ts) juga mendaftarkan link menjadi wire runtime
6. [`ProgramTriggerStarter.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerStarter.ts) menyalakan trigger interval, asset watcher, dan event watcher
7. `startProgram()` mengembalikan stop function untuk mematikan trigger aktif

Kalau sedang tracing "program ini jalan dari mana?", mulai dari `startProgram()` dulu. Kalau sedang tracing "node ini jadi handler apa?", masuk ke `ProgramNodeRegistration`.

## Pembagian Tanggung Jawab

- `ProgramBootstrap` adalah orchestration entrypoint
- `ProgramNodeRegistration` hanya mendaftarkan handler dan wire
- `ProgramTriggerStarter` hanya menyalakan trigger dan subscription
- `ProgramTriggerSupport` berisi helper pure untuk match path, resolve trigger config, dan bentuk message trigger
- `ProgramFlowSupport` berisi helper untuk membangun flow dan resolve flow variable

## Rules Internal

- `flow` tidak boleh menjadi service locator
- node registration harus memakai dependency dari composition
- validasi node dan link harus dilakukan sedekat mungkin ke registration
- trigger startup harus mengembalikan stop function yang jelas

## Rules Kalau Mau Edit

- kalau menambah node kind baru, pusat pertama yang harus dicek adalah `ProgramNodeRegistration`
- kalau menambah trigger type baru, pusat pertama yang harus dicek adalah `ProgramTriggerStarter` dan `ProgramTriggerSupport`
- kalau menambah flow variable rule baru, pusat pertama yang harus dicek adalah `ProgramFlowSupport`
- jangan membuat handler node langsung di `flow` kalau handler itu sebenarnya milik domain lain

## Kalau Mau Nambah Fitur

Pola yang disarankan:

1. tambah contract flow bila perlu
2. tambah support/helper resolusi
3. daftarkan behavior di `ProgramNodeRegistration`
4. gunakan controller domain dari composition
