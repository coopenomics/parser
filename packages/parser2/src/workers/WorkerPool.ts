/**
 * Пул worker-потоков для CPU-интенсивной ABI-десериализации.
 *
 * Использует Piscina — высокопроизводительный worker pool для Node.js.
 * Каждый worker держит собственный in-memory ABI-кэш, поэтому повторные
 * задания с одним и тем же abiJson не перепарсивают его.
 *
 * Важно: Piscina загружается через динамический import() из-за отсутствия
 * поля "exports" в package.json пакета — NodeNext resolution требует его.
 * Поэтому используется топ-левел await + явное приведение типа.
 */

import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

// __dirname не доступен в ESM — восстанавливаем через import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

interface PiscinaOptions {
  filename: string
  maxThreads?: number
}

// CJS/ESM interop: у Piscina нет поля "exports" для NodeNext resolution,
// поэтому TypeScript не может статически проверить тип импорта
type PiscinaConstructor = new (opts: PiscinaOptions) => {
  run(task: unknown): Promise<unknown>
  utilization: number
  destroy(): Promise<void>
}
const { default: PiscinaClass } = await import('piscina') as unknown as { default: PiscinaConstructor }

export class WorkerPool {
  private pool: InstanceType<PiscinaConstructor>

  /**
   * @param maxThreads — максимум параллельных worker-потоков.
   *   Оптимум зависит от числа CPU и IO-нагрузки. Дефолт 2 подходит
   *   для большинства серверов; 4+ потока ускоряют плотные блоки (много actions).
   */
  constructor(maxThreads = 2) {
    // Загружаем CJS-сборку worker'а, т.к. Piscina нативно работает с CJS
    this.pool = new PiscinaClass({
      filename: join(__dirname, 'deserialize.worker.cjs'),
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
