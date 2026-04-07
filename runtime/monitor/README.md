# Monitor Manual

Folder `monitor` menangani observability runtime untuk node flow.

## Tugas Inti Folder

- menyimpan state `monitor status` per node
- menyimpan state `profiling` per node
- memisahkan observability dari orchestration queue di `Runtime.ts`

## Folder Ini Melayani Apa

- `Runtime.ts`
- API monitor status/profiling
- node context yang ingin menulis status manual

## File Penting

- [`NodeStatusMonitor.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/monitor/NodeStatusMonitor.ts)
- [`NodeProfilingMonitor.ts`](/d:/DEV/kufayeka/node_red_style_event_loop/runtime/monitor/NodeProfilingMonitor.ts)

## Rules Internal

- `monitor status` hanya untuk badge/status yang ditulis eksplisit oleh node
- `profiling` harus berasal dari metrik runtime otomatis, bukan teks bebas
- jangan taruh logic queue execution di folder ini
