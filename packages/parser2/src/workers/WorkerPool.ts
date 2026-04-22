/**
 * Пул worker-потоков для CPU-интенсивной ABI-десериализации.
 *
 * Использует Piscina — высокопроизводительный worker pool для Node.js.
 * Каждый worker держит собственный in-memory ABI-кэш, поэтому повторные
 * задания с одним и тем же abiJson не перепарсивают его.
 */

// Piscina: default import через dynamic import() — TS не может статически
// проверить тип, поэтому используем топ-левел await + приведение типа.
type PiscinaPool = {
  run(task: unknown): Promise<unknown>
  utilization: number
  destroy(): Promise<void>
}
type PiscinaCtor = new (opts: { filename: string; maxThreads?: number }) => PiscinaPool
const { default: PiscinaClass } = await import('piscina') as unknown as { default: PiscinaCtor }
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

// __dirname не доступен в ESM — восстанавливаем через import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Находит путь к скомпилированному worker'у.
 *
 * Сценарии:
 *   1. Production (dist/index.cjs) — worker рядом: dist/deserialize.worker.cjs
 *   2. Source mode (src/workers/WorkerPool.ts) — worker должен быть предварительно
 *      собран в dist/workers/deserialize.worker.cjs (для тестов: build перед test:integration)
 */
function resolveWorkerPath(): string {
  const candidates = [
    // Production: рядом с WorkerPool
    join(__dirname, 'deserialize.worker.cjs'),
    // Source mode (tests): относительный путь к dist/
    resolve(__dirname, '../../dist/deserialize.worker.cjs'),
    resolve(__dirname, '../../dist/workers/deserialize.worker.cjs'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  throw new Error(
    `Could not find deserialize.worker.cjs. Tried: ${candidates.join(', ')}. ` +
    `Run "pnpm build" first if running from source.`,
  )
}

export interface DeserializeTask {
  /** Сырые байты action data или table row для декодирования. */
  rawBinary: Uint8Array
  /** JSON-представление ABI нужного контракта. */
  abiJson: string
  contract: string
  /** Имя типа в ABI для декодирования. */
  typeName: string
  kind: 'action' | 'delta'
}

export class WorkerPool {
  private pool: PiscinaPool

  /**
   * @param maxThreads — максимум параллельных worker-потоков.
   *   Оптимум зависит от числа CPU и IO-нагрузки. Дефолт 2 подходит
   *   для большинства серверов; 4+ потока ускоряют плотные блоки (много actions).
   */
  constructor(maxThreads = 2) {
    // Загружаем CJS-сборку worker'а, т.к. Piscina нативно работает с CJS
    this.pool = new PiscinaClass({
      filename: resolveWorkerPath(),
      maxThreads,
    })
  }

  /**
   * Запускает десериализацию в одном из свободных worker-потоков.
   * Блокирует промис пока worker не вернёт результат.
   */
  run(task: DeserializeTask): Promise<Record<string, unknown>> {
    return this.pool.run(task) as Promise<Record<string, unknown>>
  }

  /**
   * Доля занятых потоков от общего числа (0..1).
   * Полезно для метрики parser2_worker_pool_queue_depth.
   */
  get utilization(): number {
    return this.pool.utilization
  }

  /** Завершает все worker-потоки (вызывается при остановке парсера). */
  destroy(): Promise<void> {
    return this.pool.destroy()
  }
}
