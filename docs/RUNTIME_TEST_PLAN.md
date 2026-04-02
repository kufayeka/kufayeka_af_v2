# Runtime Test Plan

Dokumen ini menjelaskan strategi testing untuk seluruh `runtime/` dengan fokus:

- `asset`
- `flow`
- `action`
- `event`
- `historian`

Kondisi repo saat ini:

- belum ada test runner runtime yang aktif di `package.json`
- baru ada `typecheck`
- runtime cukup modular untuk mulai diuji per domain

## Rekomendasi Pendekatan

Pendekatan paling cocok untuk codebase ini:

1. mulai dari unit test pada helper murni dan service yang mudah diisolasi
2. tambah integration test per domain dengan fake dependency
3. tambah runtime composition test untuk alur antar domain
4. tambah smoke test end-to-end untuk satu program contoh

Kalau kamu ingin mulai implementasi test runner, opsi paling nyaman adalah menambah `vitest`.
Alasannya:

- TypeScript-friendly
- mocking dan spy nyaman
- cocok untuk unit dan integration test ringan
- tidak memaksa setup browser

Kalau ingin minimum dependency, opsi kedua adalah `node:test` dengan build step terpisah. Tapi untuk codebase ini, `vitest` akan jauh lebih ergonomis.

## Pyramid Testing Yang Disarankan

Komposisi test yang sehat:

- 60% unit test
- 30% integration test
- 10% end-to-end smoke test

Kenapa begitu:

- banyak logic runtime ada di pure helper dan service orchestration
- bug paling mahal biasanya muncul di integration antar domain
- e2e cukup sedikit tapi harus mewakili alur penting

## Struktur Folder Test Yang Disarankan

Contoh struktur:

```text
tests/
  runtime/
    asset/
    action/
    event/
    flow/
    historian/
    composition/
    e2e/
  fixtures/
    programs/
    assets/
    events/
```

Kalau ingin lebih dekat ke source, alternatif lain:

```text
runtime/
  asset/__tests__/
  action/__tests__/
  event/__tests__/
  flow/__tests__/
  historian/__tests__/
```

Saya lebih menyarankan `tests/runtime/*` supaya source folder tetap bersih.

## Prioritas Implementasi

Urutan paling masuk akal:

1. `asset`
2. `event`
3. `action`
4. `flow`
5. `historian`
6. cross-domain composition tests
7. e2e smoke program tests

Alasannya:

- `asset` dan `event` adalah fondasi state utama runtime
- `action` dan `flow` bergantung pada kualitas contract domain-domain itu
- `historian` banyak bergantung pada target dan queueing
- e2e baru efektif setelah test level bawah stabil

## Asset Test Plan

Target file:

- [`AssetStoreFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreFactory.ts)
- [`AssetReadService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetReadService.ts)
- [`AssetWriteService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetWriteService.ts)
- [`AssetTreeService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetTreeService.ts)
- [`AssetSchemaService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetSchemaService.ts)
- [`AssetNormalizationService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetNormalizationService.ts)
- [`AssetStoreRepository.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreRepository.ts)

### Unit test yang wajib

- normalisasi state asset dari input mentah
- query path asset ke attribute match dan asset match
- `getValue`, `getAttributes`, dan `findAttributesByValue`
- set single attribute dan set many attributes
- update revision dan timestamp store setelah write
- hierarchy tree generation
- schema/effective attribute resolution

### Integration test yang wajib

- `AssetDomainController.initialize()` membuat store yang bisa dipakai
- `replaceState()` mengganti state dengan normalisasi yang benar
- `AssetStoreRepository` menyinkronkan mirror runtime
- asset write memicu enqueue historian ketika `attribute.set`

### Edge case penting

- path tidak ada
- write ke nested attribute baru
- strict vs non-strict search
- asset name dengan separator atau karakter spesial
- replace state saat store sudah ada

## Event Test Plan

Target file:

- [`EventDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventDomainService.ts)
- [`EventStoreService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/EventStoreService.ts)
- [`OpenEventCache.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/OpenEventCache.ts)
- [`PostgresEventRepository.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/store/PostgresEventRepository.ts)
- [`EventQuerySupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/event/EventQuerySupport.ts)
- seluruh `event/template/*`

### Unit test yang wajib

- wildcard path filtering
- status/severity normalization
- sort normalization
- SQL where builder untuk kombinasi filter
- row mapping dari DB row ke `EventRow`
- open event cache attach, detach, replaceAll, query
- template normalization
- template variable resolution
- template context field resolution
- capture field resolution
- close/open lifecycle berbasis template

### Integration test yang wajib

- `EventStoreService.open()` menambah row open dan cache ikut terisi
- `close()` menutup semua row sesuai pattern
- `closeById()` hanya menutup row target
- `acknowledgeById()` memperbarui cache open row
- query status `open` lewat cache dan status lain lewat repository
- `EventDomainService.initializeStore()` gagal bila DB manager tidak ada
- `EventDomainService.setTemplates()` memperbarui template map dan mirror runtime

### Mocking yang dibutuhkan

- fake `EventStoreRepository`
- fake `DbConnectionManager`
- fake `AssetStore` untuk event template tests

### Edge case penting

- duplicate open event pada mode concurrency tertentu
- close template tanpa match
- template dengan missing vars
- required parent event tidak tersedia
- auto-capture open/close menghasilkan payload yang benar

## Action Test Plan

Target file:

- [`ScriptActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionHandlerFactory.ts)
- [`ScriptActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/ScriptActionSupport.ts)
- [`EventActionHandlerFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionHandlerFactory.ts)
- [`EventActionSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/action/EventActionSupport.ts)

### Unit test yang wajib

- script source preparation
- binding resolution untuk script action
- flow variable resolution
- timeout wrapper untuk script action
- event action binding resolution
- event action validation untuk template/binding
- text template rendering

### Integration test yang wajib

- script action handler memanggil `send(msg)` dengan output benar
- script action handler bisa memakai `context.asset`, `context.eventSys`, `context.db`
- script action timeout menghasilkan error yang sesuai
- event action open memanggil `context.eventSys.openTemplate`
- event action close memanggil `context.eventSys.closeTemplate`
- event action route `onSuccess` dan `onFail` bekerja benar

### Edge case penting

- templateId tidak ada
- binding kosong
- request override dari `msg.eventRequest`
- error thrown dari script compiled function
- error dari event template open/close

## Flow Test Plan

Target file:

- [`ProgramFlowSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramFlowSupport.ts)
- [`ProgramNodeRegistration.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramNodeRegistration.ts)
- [`ProgramTriggerSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerSupport.ts)
- [`ProgramTriggerStarter.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramTriggerStarter.ts)
- [`ProgramBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/flow/ProgramBootstrap.ts)

### Unit test yang wajib

- build flow definitions dari program
- resolve flow variable value
- duplicate node id validation
- trigger path matching / segment matching
- trigger template resolution

### Integration test yang wajib

- `ProgramNodeRegistration` mendaftarkan handler yang benar per kind node
- link registration membangun graph wire yang benar
- trigger starter mengaktifkan watcher/scheduler lalu mengembalikan stop function
- `ProgramBootstrap` memasang composition ke runtime
- `ProgramBootstrap` mengisi `flowNodeConfigById` dan `resolveFlowVariables`

### Edge case penting

- node disabled
- flow disabled
- duplicate action/event node id
- watcher trigger saat `assetStore` atau `eventStore` tidak tersedia
- variable resolution dengan config kosong

## Historian Test Plan

Target file:

- [`HistorianBridgeFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianBridgeFactory.ts)
- [`HistorianDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainService.ts)
- [`HistorianDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainController.ts)

### Unit test yang wajib

- enqueue historian row dari perubahan attribute
- target filtering berdasarkan historian target aktif
- timestamp unit handling
- queue max behavior
- stats reporting dari bridge

### Integration test yang wajib

- `HistorianDomainService.initializeBridge()` membentuk bridge sekali lalu reuse
- update target baru memperbarui bridge
- enqueue row diteruskan ke `DbConnectionManager.enqueueHistorian`
- `AssetStoreRepository` dan bridge historian bekerja bersama

### Edge case penting

- historian disabled
- tidak ada target historian aktif
- queue penuh
- DB manager tidak tersedia

## Composition Test Plan

Target file:

- [`RuntimeServiceRegistry.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeServiceRegistry.ts)
- [`ProgramRuntimeCompositionFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/ProgramRuntimeCompositionFactory.ts)
- [`RuntimeContextFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextFactory.ts)
- [`RuntimeContextSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextSupport.ts)

### Test yang wajib

- registry membuat domain controller yang benar
- composition memegang store/template/flow definition yang benar
- node context membaca asset/event/db dari composition
- context flow memunculkan `id`, `name`, dan `variables` yang benar
- fallback global compatibility tidak menjadi jalur utama ketika composition tersedia

## Runtime Engine Test Plan

Target file:

- [`Runtime.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/Runtime.ts)
- [`runtimeExecutionUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core/runtimeExecutionUtils.ts)
- [`runtimeMessageUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/core/runtimeMessageUtils.ts)

### Test yang wajib

- add node dan wire
- send message ke node berikutnya
- cloning message antar branch
- queue overflow behavior
- inflight limit behavior
- node timeout behavior
- shutdown drain behavior
- asset write serialization lewat `assetWriteChain`

## End-to-End Smoke Test

Minimal satu program contoh harus dites secara e2e.

Skenario minimum:

1. start runtime dengan program fixture sederhana
2. trigger membuka event
3. script action menulis attribute asset
4. event action menutup event
5. perubahan asset mengantre row historian
6. runtime shutdown tanpa leak queue

Fixture yang disarankan:

- satu asset tree kecil
- satu flow dengan trigger, script action, event open, event close
- satu template event sederhana
- satu target historian default

## Fake / Stub Yang Perlu Disediakan

Untuk test cepat dan murah, sediakan helper berikut:

- `createTestRuntime()`
- `createTestProgramComposition()`
- fake `DbConnectionManager`
- fake `EventStoreRepository`
- fake `AssetStore`
- fake `HistorianBridge`
- helper `sendCollector()` untuk menangkap output handler

Ini akan mengurangi boilerplate test secara drastis.

## Checklist Implementasi Test

Tahap 1:

- pasang test runner
- tambah script `test`
- tambah folder `tests/runtime`
- buat helper dasar runtime fixture

Tahap 2:

- unit test `asset`
- unit test `event`
- unit test `action`

Tahap 3:

- integration test `asset`
- integration test `event`
- integration test `historian`

Tahap 4:

- integration test `flow`
- composition test
- runtime engine test

Tahap 5:

- e2e smoke test program

## Definition of Done Untuk Testing Runtime

Runtime testing dianggap cukup sehat kalau:

- semua domain punya unit test inti
- semua boundary lintas domain punya minimal satu integration test
- `ProgramBootstrap` dan `Runtime` punya smoke test
- event template lifecycle punya test positif dan negatif
- asset-to-historian path punya integration test
- shutdown runtime punya test
- CI menjalankan minimal `typecheck` dan `test`

## Rekomendasi Praktis

Kalau harus mulai besok pagi dengan effort minimum, kerjakan ini dulu:

1. pasang `vitest`
2. buat helper `createTestRuntime`
3. test `AssetStoreFactory`
4. test `EventStoreService`
5. test `ScriptActionHandlerFactory`
6. test `ProgramBootstrap`
7. test satu alur e2e kecil

Itu sudah akan menangkap sebagian besar regression penting di runtime ini.
