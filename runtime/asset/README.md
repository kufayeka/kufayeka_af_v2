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
- [`AssetStoreIndex.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreIndex.ts)
- [`AssetSchemaService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetSchemaService.ts)
- [`AssetNormalizationService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetNormalizationService.ts)

## Jalur Aktif Saat Ini

Jalur utama yang dipakai runtime sekarang:

1. [`AssetDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetDomainController.ts) adalah facade publik domain asset
2. [`AssetDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetDomainService.ts) meneruskan use-case asset ke state service dan store
3. [`AssetStateService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStateService.ts) mengelola lifecycle store untuk satu runtime
4. [`AssetStoreRepository.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreRepository.ts) membuat store, sync mirror runtime, dan menghubungkan historian bridge
5. [`AssetStoreFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreFactory.ts) membuat object `AssetStore` yang dipakai runtime
6. [`AssetStoreIndex.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreIndex.ts) menjadi mesin read/write/query/hierarchy berbasis index
7. [`AssetSchemaService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetSchemaService.ts) menormalisasi schema dan menghitung effective attribute

Kalau sedang tracing `context.asset.get()` atau `context.asset.set()`, biasanya jalurnya berakhir di `AssetStoreFactory` lalu `AssetStoreIndex`.

## File Pendukung

- [`AssetNormalizationService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetNormalizationService.ts) adalah wrapper kecil untuk normalisasi asset section
- [`assetDataUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/assetDataUtils.ts) berisi helper path, wildcard match, dan value comparison
- [`AssetStoreAccess.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/asset/AssetStoreAccess.ts) adalah helper akses store dari runtime/composition

## Alur Internal Domain

1. controller menerima request domain
2. domain service mendelegasikan ke state service
3. state service mengelola repository/store lifecycle
4. repository membuat store dan menyinkronkan runtime mirror
5. store read/write dijalankan oleh `AssetStoreIndex`
6. perubahan write memicu bridge historian bila relevan

## Rules Internal

- sumber kebenaran asset aktif adalah store in-memory
- `replaceState()` harus lewat normalisasi
- write asset harus aman terhadap eksekusi paralel
- bridge historian tidak boleh menjadi alasan asset domain tahu detail DB historian

## Rules Kalau Mau Edit

- kalau mengubah model state asset, cek impact ke hierarchy, query, dan historian
- kalau menambah read/write logic di jalur aktif, cek `AssetStoreFactory` dan `AssetStoreIndex`
- kalau menambah lifecycle store atau sync runtime mirror, tempatkan di `AssetStoreRepository`
- jangan menambah query helper generik ke file acak; pilih file yang memang memiliki ownership

## Kalau Mau Nambah Fitur

Contoh pembagian yang benar:

- schema / attribute derivation baru: `AssetSchemaService`
- query atau mutation baru di jalur aktif: `AssetStoreIndex`
- lifecycle store atau runtime mirror baru: `AssetStoreRepository`
- view/hierarchy baru: `AssetStoreIndex` dulu, lalu ekstrak ke service khusus kalau mulai terlalu besar
- access helper ke composition: `AssetStoreAccess`
