import type { ParserEvent, ActionEvent, DeltaEvent, NativeDeltaEvent } from '../types.js'
import type { NativeTableName } from '@coopenomics/coopos-ship-reader'

export interface ActionFilter<T extends Record<string, unknown> = Record<string, unknown>> {
  kind: 'action'
  account?: string
  name?: string
  data?: Partial<T>
}

export interface DeltaFilter {
  kind: 'delta'
  code?: string
  table?: string
  scope?: string
}

export interface NativeDeltaFilter {
  kind: 'native-delta'
  table?: NativeTableName
}

export interface ForkFilter {
  kind: 'fork'
}

export type SubscriptionFilter<T extends Record<string, unknown> = Record<string, unknown>> =
  | ActionFilter<T>
  | DeltaFilter
  | NativeDeltaFilter
  | ForkFilter

function matchesWildcard(value: string, pattern: string | undefined): boolean {
  if (pattern === undefined || pattern === '*') return true
  return value === pattern
}

function matchAction(event: ActionEvent, filter: ActionFilter): boolean {
  if (!matchesWildcard(event.account, filter.account)) return false
  if (!matchesWildcard(event.name, filter.name)) return false
  if (filter.data) {
    for (const [k, v] of Object.entries(filter.data)) {
      if (event.data[k] !== v) return false
    }
  }
  return true
}

function matchDelta(event: DeltaEvent, filter: DeltaFilter): boolean {
  if (!matchesWildcard(event.code, filter.code)) return false
  if (!matchesWildcard(event.table, filter.table)) return false
  if (!matchesWildcard(event.scope, filter.scope)) return false
  return true
}

function matchNativeDelta(event: NativeDeltaEvent, filter: NativeDeltaFilter): boolean {
  return matchesWildcard(event.table, filter.table)
}

function matchOne(event: ParserEvent, filter: SubscriptionFilter): boolean {
  if (event.kind !== filter.kind) return false
  if (filter.kind === 'action') return matchAction(event as ActionEvent, filter)
  if (filter.kind === 'delta') return matchDelta(event as DeltaEvent, filter)
  if (filter.kind === 'native-delta') return matchNativeDelta(event as NativeDeltaEvent, filter)
  if (filter.kind === 'fork') return true
  const _exhaustive: never = filter
  return _exhaustive
}

export function matchFilters(
  event: ParserEvent,
  filters: SubscriptionFilter[] | undefined,
): boolean {
  if (!filters || filters.length === 0) return true
  return filters.some(f => matchOne(event, f))
}
