import type { ActionEvent, DeltaEvent, NativeDeltaEvent, ForkEvent, ParserEvent } from '../types.js'

type ActionWithoutId = Omit<ActionEvent, 'event_id'>
type DeltaWithoutId = Omit<DeltaEvent, 'event_id'>
type NativeDeltaWithoutId = Omit<NativeDeltaEvent, 'event_id'>
type ForkWithoutId = Omit<ForkEvent, 'event_id'>

export type EventWithoutId = ActionWithoutId | DeltaWithoutId | NativeDeltaWithoutId | ForkWithoutId

export function computeEventId(event: EventWithoutId): string {
  const blockIdShort = (blockId: string) => blockId.slice(0, 16)

  if (event.kind === 'action') {
    return `${event.chain_id}:a:${event.block_num}:${blockIdShort(event.block_id)}:${event.global_sequence}`
  }
  if (event.kind === 'delta') {
    return `${event.chain_id}:d:${event.block_num}:${blockIdShort(event.block_id)}:${event.code}:${event.scope}:${event.table}:${event.primary_key}`
  }
  if (event.kind === 'native-delta') {
    return `${event.chain_id}:n:${event.block_num}:${blockIdShort(event.block_id)}:${event.table}:${event.lookup_key}`
  }
  if (event.kind === 'fork') {
    return `${event.chain_id}:f:${event.forked_from_block}:${blockIdShort(event.new_head_block_id)}`
  }

  const _exhaustive: never = event
  return _exhaustive
}

// Convenience overload that also accepts complete events (with event_id)
export function computeEventIdFromComplete(event: ParserEvent): string {
  return computeEventId(event as EventWithoutId)
}
