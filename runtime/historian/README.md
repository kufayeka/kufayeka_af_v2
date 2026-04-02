# Historian Domain Manual

Domain `historian` bertugas menyalurkan perubahan attribute runtime ke backend historian.

## Tugas Inti Domain

- membuat bridge historian
- memelihara target historian aktif
- mengantre perubahan attribute
- meneruskan row historian ke DB manager

## Domain Ini Melayani Apa

- asset domain
- runtime API yang membaca statistik historian bridge

## Input Domain

- target historian dari state asset
- perubahan attribute dari asset store
- DB manager

## Output Domain

- bridge historian
- stats bridge
- enqueue row ke backend historian

## File Penting

- [`HistorianDomainController.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainController.ts)
- [`HistorianDomainService.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianDomainService.ts)
- [`HistorianBridgeFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianBridgeFactory.ts)
- [`HistorianContracts.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/historian/HistorianContracts.ts)

## Rules Internal

- historian tidak memiliki asset state sendiri
- domain ini hanya menerima perubahan yang sudah diputuskan valid oleh asset domain
- bridge harus bisa diinisialisasi sekali dan dipakai ulang

## Rules Kalau Mau Edit

- kalau mengubah queueing historian, cek dampaknya ke throughput dan memory
- kalau mengubah target resolution, cek dampaknya ke asset domain
- jangan letakkan keputusan business rule asset di historian

## Kalau Mau Nambah Fitur

- statistik bridge baru: domain historian
- transform row sebelum enqueue: bridge factory/service
- target selection baru: historian service, tapi inputnya tetap dari asset domain
