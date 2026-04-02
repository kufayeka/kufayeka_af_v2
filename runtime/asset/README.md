# Asset Domain Manual

Domain `asset` adalah pemilik state asset runtime yang aktif di memori.

## Tugas Inti Domain

- menginisialisasi asset store
- membaca dan menulis attribute asset
- menyediakan query path asset
- membangun hierarchy asset
- menjaga schema/effective attribute view
- meneruskan perubahan attribute ke historian bridge

## Domain Ini Melayani Apa

Domain ini melayani:

- node runtime melalui `context.asset`
- API runtime yang membaca asset tree dan attribute
- domain historian melalui perubahan attribute
- flow/trigger yang memantau perubahan asset

## Input Domain

Input utama:

- initial asset section dari program
- operasi baca dan tulis asset path
- request replace state
- historian controller untuk bridge update

## Output Domain

Output utama:

- `AssetStore`
- hasil query dan hasil write
- hierarchy tree
- state asset terbaru
- perubahan attribute yang diteruskan ke historian bridge

## Dependency Utama

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

## Alur Internal Domain

1. controller menerima request domain
2. domain service mendelegasikan ke state service
3. state service mengelola repository/store lifecycle
4. repository membuat store dan menyinkronkan runtime mirror
5. store read/write dibantu service spesifik
6. perubahan write memicu bridge historian bila relevan

## Rules Internal

- sumber kebenaran asset aktif adalah store in-memory
- `replaceState()` harus lewat normalisasi
- write asset harus aman terhadap eksekusi paralel
- bridge historian tidak boleh menjadi alasan asset domain tahu detail DB historian

## Rules Kalau Mau Edit

- kalau mengubah model state asset, cek impact ke hierarchy, query, dan historian
- kalau menambah read logic, tempatkan di `AssetReadService`
- kalau menambah write logic, tempatkan di `AssetWriteService`
- kalau menambah lifecycle store atau sync runtime mirror, tempatkan di `AssetStoreRepository`
- jangan menambah query helper generik ke file acak; pilih file yang memang memiliki ownership

## Kalau Mau Nambah Fitur

Contoh pembagian yang benar:

- schema / attribute derivation baru: `AssetSchemaService`
- query baru: `AssetReadService`
- mutation baru: `AssetWriteService`
- view/hierarchy baru: `AssetTreeService`
- access helper ke composition: `AssetStoreAccess`
