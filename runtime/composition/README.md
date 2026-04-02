# Composition Manual

Folder `composition` adalah tempat perakitan dependency runtime dan pembentukan context node.

## Tugas Inti Folder

- membuat service registry seluruh domain
- membangun `ProgramRuntimeComposition`
- menghubungkan program definition dengan service runtime
- membuat `RuntimeNodeContext` yang dibaca handler saat eksekusi

## Folder Ini Melayani Apa

Folder ini melayani:

- `ProgramBootstrap`
- `Runtime`
- semua node handler yang memakai context runtime

## Input Folder

- `Runtime`
- program definition
- flow definitions
- domain controllers
- DB manager

## Output Folder

- `RuntimeServiceRegistry`
- `ProgramRuntimeComposition`
- `RuntimeNodeContext`

## File Penting

- [`RuntimeServiceRegistry.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeServiceRegistry.ts)
- [`RuntimeComposition.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeComposition.ts)
- [`ProgramRuntimeCompositionFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/ProgramRuntimeCompositionFactory.ts)
- [`RuntimeBootstrap.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeBootstrap.ts)
- [`RuntimeContextFactory.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextFactory.ts)
- [`RuntimeContextSupport.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/composition/RuntimeContextSupport.ts)

## Rules Internal

- dependency utama runtime harus terlihat di composition object
- jangan sembunyikan dependency domain penting di lookup string global
- `RuntimeContextFactory` harus membaca capability dari composition lebih dulu
- bootstrap domain harus tetap tipis dan fokus pada initial wiring

## Rules Kalau Mau Edit

- kalau domain baru muncul, tambahkan ke `RuntimeServiceRegistry`
- kalau node context butuh API baru, cek dulu apakah itu memang capability domain yang pantas diexpose
- kalau sebuah field dibutuhkan lintas banyak domain saat runtime program, pertimbangkan masuk ke `ProgramRuntimeComposition`

## Kalau Mau Nambah Fitur

Gunakan pertanyaan ini:

1. dependency ini milik satu domain atau lintas domain?
2. apakah node runtime perlu mengaksesnya?
3. apakah cukup di controller domain, atau perlu masuk composition?

Kalau jawabannya lintas domain dan dipakai selama satu program hidup, biasanya tempat yang tepat adalah composition.
