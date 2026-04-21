/**
 * Фильтры подписки — декларативный DSL для выбора нужных событий.
 *
 * Потребитель задаёт массив SubscriptionFilter при создании ParserClient.
 * matchFilters(event, filters) возвращает true если событие удовлетворяет
 * хотя бы одному фильтру (OR-семантика).
 *
 * Значения полей фильтра:
 *   undefined / '*' — совпадает с любым значением (wildcard).
 *   строка — точное совпадение.
 *
 * Примеры фильтров:
 *   { kind: 'action', account: 'eosio.token', name: 'transfer' }
 *   { kind: 'delta', code: 'eosio', table: 'global' }
 *   { kind: 'native-delta', table: 'permission' }
 *   { kind: 'fork' }
 */

import type { ParserEvent, ActionEvent, DeltaEvent, NativeDeltaEvent } from '../types.js'
import type { NativeTableName } from '@coopenomics/coopos-ship-reader'

/** Фильтр по транзакционным действиям. */
export interface ActionFilter<T extends Record<string, unknown> = Record<string, unknown>> {
  kind: 'action'
  /** Аккаунт контракта. undefined = любой. */
  account?: string
  /** Имя действия. undefined = любое. */
  name?: string
  /** Частичное совпадение по полям data. */
  data?: Partial<T>
}

/** Фильтр по изменениям строк пользовательских таблиц. */
export interface DeltaFilter {
  kind: 'delta'
  /** Аккаунт контракта. undefined = любой. */
  code?: string
  /** Имя таблицы. undefined = любая. */
  table?: string
  /** Скоуп. undefined = любой. */
  scope?: string
}

/** Фильтр по изменениям нативных системных таблиц. */
export interface NativeDeltaFilter {
  kind: 'native-delta'
  /** Тип нативной таблицы (permission, account, …). undefined = любая. */
  table?: NativeTableName
}

/** Фильтр по событиям форка (подписывается на все форки без уточнений). */
export interface ForkFilter {
  kind: 'fork'
}

export type SubscriptionFilter<T extends Record<string, unknown> = Record<string, unknown>> =
  | ActionFilter<T>
  | DeltaFilter
  | NativeDeltaFilter
  | ForkFilter

/**
 * Wildcard-совпадение: undefined и '*' совпадают с чем угодно,
 * иначе требуется точное строковое совпадение.
 */
function matchesWildcard(value: string, pattern: string | undefined): boolean {
  if (pattern === undefined || pattern === '*') return true
  return value === pattern
}

/** Проверяет совпадение ActionEvent с ActionFilter. */
function matchAction(event: ActionEvent, filter: ActionFilter): boolean {
  if (!matchesWildcard(event.account, filter.account)) return false
  if (!matchesWildcard(event.name, filter.name)) return false
  // Частичное совпадение по data: все указанные поля должны совпадать
  if (filter.data) {
    for (const [k, v] of Object.entries(filter.data)) {
      if (event.data[k] !== v) return false
    }
  }
  return true
}

/** Проверяет совпадение DeltaEvent с DeltaFilter. */
function matchDelta(event: DeltaEvent, filter: DeltaFilter): boolean {
  if (!matchesWildcard(event.code, filter.code)) return false
  if (!matchesWildcard(event.table, filter.table)) return false
  if (!matchesWildcard(event.scope, filter.scope)) return false
  return true
}

/** Проверяет совпадение NativeDeltaEvent с NativeDeltaFilter. */
function matchNativeDelta(event: NativeDeltaEvent, filter: NativeDeltaFilter): boolean {
  return matchesWildcard(event.table, filter.table)
}

/** Проверяет одно событие против одного фильтра. */
function matchOne(event: ParserEvent, filter: SubscriptionFilter): boolean {
  // Быстрая проверка kind перед детальным сравнением
  if (event.kind !== filter.kind) return false
  if (filter.kind === 'action') return matchAction(event as ActionEvent, filter)
  if (filter.kind === 'delta') return matchDelta(event as DeltaEvent, filter)
  if (filter.kind === 'native-delta') return matchNativeDelta(event as NativeDeltaEvent, filter)
  if (filter.kind === 'fork') return true // ForkFilter — совпадает с любым ForkEvent
  const _exhaustive: never = filter
  return _exhaustive
}

/**
 * Проверяет событие против набора фильтров (OR-семантика).
 * @returns true если filters пустой/undefined (нет ограничений) или хотя бы один фильтр совпал.
 */
export function matchFilters(
  event: ParserEvent,
  filters: SubscriptionFilter[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return true
  return filters.some(f => matchOne(event, f))
}
