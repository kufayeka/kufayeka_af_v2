# Program Manual

Folder `program` adalah entry point kecil untuk load dan start program runtime.

## Tugas Inti Folder

- membaca file program dari disk
- mengekspor entry point `startProgram`

## Folder Ini Melayani Apa

- `index.ts`
- proses startup runtime

## File Penting

- [`ProgramEngine.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/program/ProgramEngine.ts)

## Input

- path file program
- object `ProgramDefinition`
- instance `Runtime`

## Output

- object program hasil parse
- fungsi `stop` hasil `startProgram`

## Rules Kalau Mau Edit

- folder ini harus tetap tipis
- orchestration detail tetap milik `flow/ProgramBootstrap`
- jangan taruh logic domain besar di sini
