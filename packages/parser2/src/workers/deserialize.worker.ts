/**
 * Worker-поток для ABI-десериализации (Piscina).
 *
 * Пискина запускает этот файл в отдельных worker_threads.
 * Десериализация — CPU-интенсивная операция (парсинг ABI + бинарное декодирование
 * через wharfkit/antelope), поэтому она вынесена в пул потоков чтобы не блокировать
 * event loop главного потока.
 *
 * ABI-кэш (abiCache): внутри worker'а держим Map<sha256 → ABI object>.
 * ABI одного контракта приходит в сотнях тысяч вызовов — кэш экономит повторный
 * ABI.from(JSON.parse(…)) при каждом декодировании.
 */

import { isMainThread } from 'node:worker_threads'
import { ABI, Serializer, type ABISerializable } from '@wharfkit/antelope'
import { createHash } from 'node:crypto'

// Защита: этот файл нельзя запускать напрямую в главном потоке
if (isMainThread) {
  throw new Error('This file must be run in a worker thread')
}

interface WorkerTask {
  /** Сырые бинарные данные для декодирования (action data или table row). */
  rawBinary: Uint8Array
  /** Сериализованный ABI в JSON-формате (от ABI.from(…).toJSON()). */
  abiJson: string
  contract: string
  /** Имя типа в ABI-схеме, который нужно декодировать. */
  typeName: string
  kind: 'action' | 'delta'
}

/**
 * Кэш разобранных ABI по SHA-256 от JSON-строки.
 * Живёт в памяти worker'а на протяжении всего его существования.
 * При смене ABI (setabi) в главном потоке передаётся новый abiJson → новый хэш → новый элемент кэша.
 */
const abiCache = new Map<string, ABI>()

/**
 * Возвращает ABI-объект для abiJson, используя кэш.
 * SHA-256 — достаточно быстрый и collision-resistant ключ кэша.
 */
function getAbi(abiJson: string): ABI {
  const hash = createHash('sha256').update(abiJson).digest('hex')
  let parsed = abiCache.get(hash)
  if (!parsed) {
    parsed = ABI.from(JSON.parse(abiJson) as object)
    abiCache.set(hash, parsed)
  }
  return parsed
}

/**
 * Основная функция worker'а — экспортируется по default для Piscina.
 *
 * Шаги:
 * 1. Разбираем ABI (или берём из кэша).
 * 2. Serializer.decode — бинарное декодирование rawBinary согласно typeName в схеме ABI.
 * 3. Serializer.objectify — конвертирует wharfkit-объекты в plain JS Record.
 */
export default function deserialize(task: WorkerTask): Record<string, unknown> {
  const abi = getAbi(task.abiJson)
  const raw = Serializer.decode({ data: task.rawBinary, type: task.typeName, abi })
  return Serializer.objectify(raw as ABISerializable) as Record<string, unknown>
}
