import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    // ESM only: код использует top-level await (для динамической загрузки CJS-only
    // пакетов ioredis и piscina). TLA несовместим с CJS форматом.
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
  },
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    // ESM: CLI импортирует из src/ который использует top-level await
    format: ['esm'],
    sourcemap: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  // Piscina worker: отдельный CJS файл (Piscina не поддерживает ESM).
  // Размещается в dist/deserialize.worker.cjs — WorkerPool ищет по этому пути.
  {
    entry: { 'deserialize.worker': 'src/workers/deserialize.worker.ts' },
    format: ['cjs'],
    sourcemap: true,
    target: 'node20',
  },
])
