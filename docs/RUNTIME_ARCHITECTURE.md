# Runtime Architecture

Dokumen ini menjelaskan struktur `runtime/` setelah migrasi ke style composition-based.
Target dokumen ini adalah:

- membantu orang baru memahami alur runtime tanpa harus tracing seluruh codebase
- menjelaskan boundary antar domain
- memberi guideline supaya perubahan berikutnya tetap konsisten

## Tujuan Desain

Runtime ini dibangun sebagai engine eksekusi flow bergaya node/event-loop dengan prinsip:

- `Runtime` adalah engine generik, bukan service locator utama
- service domain dirakit sekali di composition root
- `flow` mengorkestrasi program, node, link, dan trigger
- `asset`, `event`, `historian`, dan `action` adalah domain yang punya tanggung jawab jelas
- global runtime dipertahankan hanya sebagai compatibility mirror atau state umum, bukan sumber dependency utama

## Struktur Folder

Struktur utama saat ini:

```text
runtime/
  Runtime.ts
  action/
  asset/
  composition/
  core/
  db/
  event/
    store/
    template/
  flow/
  historian/
  persistence/
  program/
```

Arti tiap area:

- `Runtime.ts`: engine inti untuk node registration, wiring, queue, inflight handling, context creation, dan shutdown
- `core/`: utility engine-level seperti execution control, message normalization, dan runtime-wide types
- `composition/`: composition root, service registry, runtime context factory, dan object composition program
- `program/`: entry point untuk load/start program
- `flow/`: orchestration flow, graph flattening, node registration, link registration, trigger startup
- `action/`: pembuatan handler action untuk script dan event action
- `asset/`: domain asset state, query, mutation, hierarchy, schema, dan asset store lifecycle
- `event/`: domain event store, query support, persistence backend, dan event template
- `historian/`: historian bridge dan queueing perubahan attribute ke backend historian
- `db/`: DB config dan connection manager
- `persistence/`: persistence untuk global values dan attribute values

## Alur Runtime End-to-End

Alur start program secara ringkas:

1. `ProgramEngine.startProgram()` memanggil `flow/ProgramBootstrap.ts`.
2. `ProgramBootstrap` membuat `RuntimeServiceRegistry`.
3. `RuntimeBootstrap` menginisialisasi domain yang perlu state awal dari program.
4. `ProgramRuntimeCompositionFactory` merakit `ProgramRuntimeComposition`.
5. Composition dipasang ke `Runtime` lewat `runtime.setProgramComposition(...)`.
6. `ProgramNodeRegistration` mendaftarkan node handler ke engine.
7. `registerLinks` mendaftarkan wiring antar node.
8. `ProgramTriggerStarter` mengaktifkan trigger.
9. Saat node dieksekusi, `RuntimeContextFactory` membuat context yang membaca dependency dari composition.

## Runtime Engine

File utama:

- [`Runtime.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/Runtime.ts)

Tanggung jawab `Runtime`:

- menyimpan registry node handler
- menyimpan wire graph
- menerima dan mengantre message per node
- membatasi inflight dan queue size
- membuat node execution context
- mengeksekusi node dengan timeout
- mengelola shutdown drain

Yang sengaja tidak menjadi tanggung jawab `Runtime`:

- membuat service domain
- memutuskan template/event/asset definition program
- membaca dependency domain dari string key global sebagai jalur utama

## Composition Layer

File utama:

- [`RuntimeServiceRegistry.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeServiceRegistry.ts)
- [`RuntimeComposition.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeComposition.ts)
- [`ProgramRuntimeCompositionFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/ProgramRuntimeCompositionFactory.ts)
- [`RuntimeContextFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextFactory.ts)
- [`RuntimeContextSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextSupport.ts)
- [`RuntimeBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeBootstrap.ts)

Prinsip layer ini:

- semua domain controller dibuat sekali di registry
- semua store/template/flow definition dikemas dalam satu object composition
- node context tidak mencari dependency sendiri, tetapi membaca dari composition

`ProgramRuntimeComposition` saat ini memegang:

- `services`
- `dbConnectionManager`
- `assetStore`
- `eventStore`
- `scriptTemplatesById`
- `eventTemplates` dan `eventTemplatesById`
- `flowDefinitionsById`
- `triggerTemplates`
- `flowNodeConfigById`
- `resolveFlowVariables`

Ini adalah sumber kebenaran utama runtime pada level program.

## Program Layer

File utama:

- [`ProgramEngine.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/program/ProgramEngine.ts)
- [`ProgramBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramBootstrap.ts)

`ProgramEngine` bertugas:

- load program dari file
- mengekspor entry point `startProgram`

`ProgramBootstrap` bertugas:

- normalisasi asset awal
- membuat service registry
- inisialisasi bootstrap domain
- build flow definitions
- membangun composition program
- register node dan link
- start trigger
- memasang `resolveFlowVariables`

## Flow Domain

File utama:

- [`ProgramFlowContracts.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramFlowContracts.ts)
- [`ProgramFlowSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramFlowSupport.ts)
- [`ProgramNodeRegistration.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramNodeRegistration.ts)
- [`ProgramTriggerSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerSupport.ts)
- [`ProgramTriggerStarter.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerStarter.ts)

Tanggung jawab `flow`:

- mengubah definisi program menjadi flow runtime yang siap dijalankan
- memvalidasi dan mendaftarkan node
- mendaftarkan link antar node
- membangun trigger watcher/scheduler/event trigger
- menjadi orchestration layer antara program definition dan runtime engine

Boundary yang diinginkan:

- `flow` boleh memanggil service domain melalui composition
- `flow` tidak boleh membuat store/domain controller sendiri
- `flow` tidak boleh menjadikan global runtime sebagai sumber dependency utama

## Action Domain

File utama:

- [`ActionDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ActionDomainController.ts)
- [`ScriptActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionHandlerFactory.ts)
- [`ScriptActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionSupport.ts)
- [`EventActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionHandlerFactory.ts)
- [`EventActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionSupport.ts)

Tanggung jawab:

- mengubah definisi action menjadi `RuntimeNodeHandler`
- menyiapkan execution helper untuk script action
- melakukan binding input dan template resolution untuk event action

Pola internal:

- `*HandlerFactory` membuat handler runtime
- `*Support` berisi helper murni atau helper eksekusi yang mendukung factory
- `ActionDomainController` adalah facade domain

## Asset Domain

File utama:

- [`AssetDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetDomainController.ts)
- [`AssetDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetDomainService.ts)
- [`AssetStateService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStateService.ts)
- [`AssetStoreRepository.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreRepository.ts)
- [`AssetStoreFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreFactory.ts)
- [`AssetReadService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetReadService.ts)
- [`AssetWriteService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetWriteService.ts)
- [`AssetTreeService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetTreeService.ts)
- [`AssetSchemaService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetSchemaService.ts)
- [`AssetNormalizationService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetNormalizationService.ts)

Alur tanggung jawab:

- `AssetDomainController`: facade publik domain
- `AssetDomainService`: orchestration tipis di atas state service
- `AssetStateService`: lifecycle store dan binding runtime
- `AssetStoreRepository`: ownership store, sync runtime mirror, integrasi bridge historian
- `AssetStoreFactory`: membuat store in-memory
- `AssetReadService`: query/read path
- `AssetWriteService`: mutation path
- `AssetTreeService`: hierarchy projection
- `AssetSchemaService`: schema/effective attribute logic
- `AssetNormalizationService`: normalisasi state sebelum dipakai store

Boundary penting:

- store asset adalah in-memory runtime state utama
- write asset perlu aman terhadap concurrency, karena `Runtime` menyerialkan asset write melalui `assetWriteChain`
- domain ini mengirim perubahan attribute ke historian melalui bridge, bukan langsung ke DB historian

## Event Domain

File utama:

- [`EventDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventDomainController.ts)
- [`EventDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventDomainService.ts)
- [`EventQuerySupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventQuerySupport.ts)
- [`EventStoreAccess.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventStoreAccess.ts)

Sub-area `store/`:

- [`EventStoreService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/EventStoreService.ts)
- [`PostgresEventRepository.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/PostgresEventRepository.ts)
- [`OpenEventCache.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/OpenEventCache.ts)
- [`EventSqlSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/EventSqlSupport.ts)
- [`EventRowMapper.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/EventRowMapper.ts)

Sub-area `template/`:

- [`EventTemplateService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/template/EventTemplateService.ts)
- [`EventTemplateExports.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/template/EventTemplateExports.ts)
- [`EventTemplateNormalizer.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/template/EventTemplateNormalizer.ts)
- [`EventTemplateResolver.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/template/EventTemplateResolver.ts)
- [`EventTemplateLifecycle.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/template/EventTemplateLifecycle.ts)

Alur event domain:

- controller menghadap composition layer
- service memegang store dan template map
- `EventStoreService` memberi API domain-level untuk open/close/query/delete
- `PostgresEventRepository` menangani persistence event ke DB
- `OpenEventCache` mengoptimalkan query event open
- event template layer menangani normalisasi template, binding resolution, auto-capture, dan lifecycle open/close berbasis template

Boundary penting:

- event store adalah domain service yang stateful
- backend event store saat ini bergantung pada `DbConnectionManager`
- logic template dan logic repository dipisah tegas

## Historian Domain

File utama:

- [`HistorianDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainController.ts)
- [`HistorianDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainService.ts)
- [`HistorianBridgeFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianBridgeFactory.ts)
- [`HistorianContracts.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianContracts.ts)

Tanggung jawab:

- membuat bridge yang menerima perubahan attribute dari asset domain
- menyaring target historian aktif
- mengelola queue write historian
- meneruskan row historian ke `DbConnectionManager.enqueueHistorian(...)`

Boundary penting:

- historian tidak membaca asset store sendiri
- asset domain yang memicu enqueue ke historian bridge
- `HistorianDomainService` hanya membuat dan mengonfigurasi bridge

## DB Layer

File utama:

- [`dbConnectionManager.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/db/dbConnectionManager.ts)
- [`dbConfig.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/db/dbConfig.ts)

Tanggung jawab:

- menyimpan koneksi/config SQL
- menyediakan query umum
- menyediakan enqueue/write path untuk historian

## Persistence Layer

File utama:

- [`attributeValuePersistence.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/attributeValuePersistence.ts)
- [`globalValuePersistence.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/globalValuePersistence.ts)
- [`globalStoreUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/globalStoreUtils.ts)

Layer ini terpisah dari domain utama karena fungsinya adalah persistence untuk state runtime, bukan domain behavior utama.

## Runtime Context

Node handler menerima context dari `RuntimeContextFactory`.
API yang tersedia sekarang secara ringkas:

- `context.global`
- `context.asset`
- `context.eventSys`
- `context.db`
- `context.flow`

Prinsipnya:

- API ini dibentuk dari composition
- kalau sebuah kemampuan tidak bisa dijelaskan sebagai bagian dari domain yang ada, jangan langsung menambahkannya ke `context.global`

## Global Runtime Policy

`runtime.getGlobal()` masih ada, tetapi penggunaannya dibatasi.

Gunakan global runtime hanya untuk:

- compatibility mirror yang masih dibutuhkan area lama
- runtime stats
- state ringan yang benar-benar generic

Jangan gunakan global runtime untuk:

- menemukan service domain
- menyimpan dependency graph utama
- menggantikan constructor injection atau composition

Kalau sebuah modul butuh `assetStore`, `eventStore`, `dbConnectionManager`, `templateMap`, atau `flowDefinitions`, ambil dari composition.

## Guideline Penamaan

Gunakan pola ini:

- `*DomainController`: facade publik domain
- `*DomainService`: orchestration inti domain
- `*Support`: helper murni atau helper domain-level yang dipakai beberapa file
- `*Factory`: pembuat object atau handler
- `*Contracts`: type/contract area domain
- `*Access`: helper baca dependency domain dari composition

Hindari nama generik seperti:

- `shared`
- `utils`
- `helper`

Kecuali file itu benar-benar sangat kecil dan scope-nya jelas.

## Guideline Boundary

Saat menambah fitur baru:

1. Tentukan dulu ini fitur domain mana.
2. Tambahkan contract/type di domain itu bila perlu.
3. Letakkan orchestration di domain service atau composition layer.
4. Jangan membuat domain baru membaca dependency utama dari global runtime.
5. Kalau butuh kerja lintas domain, lakukan lewat composition atau facade domain controller.

Contoh yang benar:

- flow membutuhkan event template map lalu membacanya dari `ProgramRuntimeComposition`
- action membuat event action handler lewat `ActionDomainController`

Contoh yang tidak dianjurkan:

- flow memanggil `runtime.getGlobal("eventStore")` sebagai jalur utama
- satu domain langsung membuat controller domain lain tanpa lewat composition

## Guideline Menambah File Baru

Sebelum membuat file baru, pilih salah satu kategori ini:

- facade domain
- orchestration domain
- persistence/backend adapter
- support/helper domain
- factory
- contracts

Kalau tidak jelas masuk mana, biasanya berarti boundary fiturnya belum cukup jelas.

## Area Yang Masih Transitional

Beberapa compatibility mirror masih ada. Itu masih diterima selama:

- sumber kebenaran utama tetap composition/domain service
- mirror tidak dipakai sebagai dependency utama di path baru

Contoh area transitional saat ini:

- sebagian `runtime.setGlobal(...)` untuk mirror state
- beberapa service masih fallback membaca `dbConnectionManager` dari global bila belum diinjeksi eksplisit

Target jangka menengah:

- kurangi fallback global yang tersisa
- perluas unit/integration test di composition dan domain
- pertahankan konsistensi naming di seluruh runtime
