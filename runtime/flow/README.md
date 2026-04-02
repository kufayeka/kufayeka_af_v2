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
