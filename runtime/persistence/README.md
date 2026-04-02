# Persistence Manual

Folder `persistence` menangani penyimpanan state runtime ke storage lokal atau backend persistensi.

## Tugas Inti Folder

- persist global runtime values
- persist nilai attribute bila diperlukan
- memfilter key global yang aman untuk dipersist

## Folder Ini Melayani Apa

- runtime startup/shutdown
- proses sync state
- tooling operasional runtime

## File Penting

- [`globalValuePersistence.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/globalValuePersistence.ts)
- [`attributeValuePersistence.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/attributeValuePersistence.ts)
- [`globalStoreUtils.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/persistence/globalStoreUtils.ts)

## Input

- runtime global entries
- asset state atau attribute state
- file path/interval config

## Output

- file/database persistence
- flush function
- load persisted globals

## Rules Kalau Mau Edit

- jangan persist internal key yang tidak aman atau tidak serializable
- filtering key global harus eksplisit
- persistence bukan tempat menaruh business rule domain
