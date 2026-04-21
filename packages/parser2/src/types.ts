/**
 * Публичные типы событий, которые производит парсер и потребляет ParserClient.
 *
 * Каждое событие несёт `kind`-дискриминант для type-narrowing в switch/if,
 * а также `event_id` — детерминированный идентификатор, вычисляемый из
 * полей события (см. events/eventId.ts). Один и тот же event_id всегда
 * означает одно и то же событие, что позволяет идемпотентно обрабатывать
 * повторные доставки.
 */

import type { ActionAuthorization, ActionReceipt } from '@coopenomics/coopos-ship-reader'

/** Событие вызова смарт-контракта (inline action). */
export interface ActionEvent {
  kind: 'action'
  /** Уникальный детерминированный ID: chain:a:block_num:blockId[0..16]:global_sequence */
  event_id: string
  chain_id: string
  block_num: number
  /** ISO-8601 время блока из трассировки транзакции. */
  block_time: string
  block_id: string
  /** Аккаунт-владелец контракта (account). */
  account: string
  /** Имя действия (action name). */
  name: string
  authorization: ActionAuthorization[]
  /** Декодированные ABI-поля действия. Пустой объект если ABI недоступен. */
  data: Record<string, unknown>
  /** Порядковый номер действия внутри транзакции (1-based). */
  action_ordinal: number
  /** Глобальная уникальная последовательность — монотонный счётчик действий в цепи. */
  global_sequence: bigint
  /** Квитанция об исполнении; null если нет трассировки. */
  receipt: ActionReceipt | null
}

/** Изменение строки в пользовательской таблице смарт-контракта (contract_row delta). */
export interface DeltaEvent {
  kind: 'delta'
  /** Уникальный ID: chain:d:block_num:blockId[0..16]:code:scope:table:primary_key */
  event_id: string
  chain_id: string
  block_num: number
  block_time: string
  block_id: string
  /** Аккаунт контракта-владельца таблицы. */
  code: string
  /** Скоуп: обычно аккаунт, с которым связана строка. */
  scope: string
  table: string
  /** Первичный ключ строки (строковое представление). */
  primary_key: string
  /** Декодированные ABI-поля строки. */
  value: Record<string, unknown>
  /** true — строка создана/обновлена; false — удалена. */
  present: boolean
}

/**
 * Изменение нативной (системной) строки SHiP-дельты — permission, account,
 * resource_limits и другие типы из ship-reader/native-tables.
 *
 * Параметр T позволяет сузить тип данных: NativeDeltaEvent<NativePermissionRow>.
 */
export interface NativeDeltaEvent<T = Record<string, unknown>> {
  kind: 'native-delta'
  /** Уникальный ID: chain:n:block_num:blockId[0..16]:table:lookup_key */
  event_id: string
  chain_id: string
  block_num: number
  block_time: string
  block_id: string
  /** Имя нативной таблицы, например 'permission', 'account', 'resource_limits'. */
  table: string
  /** Натуральный первичный ключ строки (зависит от типа таблицы). */
  lookup_key: string
  /** Десериализованные данные строки. */
  data: T
  /** true — строка создана/обновлена; false — удалена. */
  present: boolean
}

/**
 * Сигнал о микрофорке блокчейна.
 *
 * Публикуется первым в пакете событий того блока, где обнаружен форк.
 * Потребитель должен откатить своё состояние для всех блоков > forked_from_block.
 * Подробнее: docs/event-id-semantics.md.
 */
export interface ForkEvent {
  kind: 'fork'
  /** Уникальный ID: chain:f:forked_from_block:newHeadBlockId[0..16] */
  event_id: string
  chain_id: string
  /** Последний безопасный блок (до него откатываться не нужно). */
  forked_from_block: number
  /** Block ID нового head — отличается от предыдущей версии того же номера. */
  new_head_block_id: string
}

/** Дискриминантное объединение всех типов событий парсера. */
export type ParserEvent = ActionEvent | DeltaEvent | NativeDeltaEvent | ForkEvent
