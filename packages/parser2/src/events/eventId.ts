/**
 * Детерминированные идентификаторы событий.
 *
 * event_id — строка, однозначно идентифицирующая событие без обращения к базе данных.
 * Свойства:
 *   - Детерминированный: одни и те же входные данные → один и тот же ID.
 *   - Fork-safe: события из параллельных форков одного блока отличаются
 *     первыми 16 hex-символами block_id.
 *   - Stateless: вычисляется в worker-потоке без каких-либо side effects.
 *
 * Форматы по типам (подробнее: docs/event-id-semantics.md):
 *   action:       chain:a:block_num:blockId[0..16]:global_sequence
 *   delta:        chain:d:block_num:blockId[0..16]:code:scope:table:primary_key
 *   native-delta: chain:n:block_num:blockId[0..16]:table:lookup_key
 *   fork:         chain:f:forked_from_block:newHeadId[0..16]
 */

import type { ActionEvent, DeltaEvent, NativeDeltaEvent, ForkEvent, ParserEvent } from '../types.js'

type ActionWithoutId = Omit<ActionEvent, 'event_id'>
type DeltaWithoutId = Omit<DeltaEvent, 'event_id'>
type NativeDeltaWithoutId = Omit<NativeDeltaEvent, 'event_id'>
type ForkWithoutId = Omit<ForkEvent, 'event_id'>

/** Объединение всех типов событий до присвоения event_id. */
export type EventWithoutId = ActionWithoutId | DeltaWithoutId | NativeDeltaWithoutId | ForkWithoutId

/**
 * Вычисляет event_id по полям события (без поля event_id).
 *
 * Принимает событие без event_id, чтобы исключить возможность рекурсии.
 * Параметр blockId обрезается до 16 символов: это первые 8 байт, содержащих
 * номер блока, что делает ID читаемым, но достаточным для уникальности в рамках форка.
 */
export function computeEventId(event: EventWithoutId): string {
  // Первые 16 hex-символов block_id содержат enough entropy для fork-различия
  const blockIdShort = (blockId: string) => blockId.slice(0, 16)

  if (event.kind === 'action') {
    // global_sequence — монотонный счётчик действий в цепи, уникален в пределах цепи
    return `${event.chain_id}:a:${event.block_num}:${blockIdShort(event.block_id)}:${event.global_sequence}`
  }
  if (event.kind === 'delta') {
    // Комбинация code+scope+table+primary_key уникально идентифицирует строку таблицы
    return `${event.chain_id}:d:${event.block_num}:${blockIdShort(event.block_id)}:${event.code}:${event.scope}:${event.table}:${event.primary_key}`
  }
  if (event.kind === 'native-delta') {
    // lookup_key — натуральный PK нативной таблицы (например owner:name для permission)
    return `${event.chain_id}:n:${event.block_num}:${blockIdShort(event.block_id)}:${event.table}:${event.lookup_key}`
  }
  if (event.kind === 'fork') {
    // fork ID привязан к forked_from_block, а не к новому block_num — чтобы два
    // форка с одинаковой глубиной откати имели разные ID
    return `${event.chain_id}:f:${event.forked_from_block}:${blockIdShort(event.new_head_block_id)}`
  }

  // Exhaustiveness check: TS сообщит об ошибке при добавлении нового kind без обработки
  const _exhaustive: never = event
  return _exhaustive
}

/**
 * Удобная обёртка — принимает готовое событие (с event_id),
 * пересчитывает его ID (полезно для верификации целостности).
 */
export function computeEventIdFromComplete(event: ParserEvent): string {
  return computeEventId(event as EventWithoutId)
}
