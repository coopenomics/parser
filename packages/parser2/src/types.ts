import type { ActionAuthorization, ActionReceipt } from '@coopenomics/coopos-ship-reader'

export interface ActionEvent {
  kind: 'action'
  event_id: string
  chain_id: string
  block_num: number
  block_time: string
  block_id: string
  account: string
  name: string
  authorization: ActionAuthorization[]
  data: Record<string, unknown>
  action_ordinal: number
  global_sequence: bigint
  receipt: ActionReceipt | null
}

export interface DeltaEvent {
  kind: 'delta'
  event_id: string
  chain_id: string
  block_num: number
  block_time: string
  block_id: string
  code: string
  scope: string
  table: string
  primary_key: string
  value: Record<string, unknown>
  present: boolean
}

export interface NativeDeltaEvent {
  kind: 'native-delta'
  event_id: string
  chain_id: string
  block_num: number
  block_time: string
  block_id: string
  table: string
  lookup_key: string
  data: Record<string, unknown>
  present: boolean
}

export interface ForkEvent {
  kind: 'fork'
  event_id: string
  chain_id: string
  forked_from_block: number
  new_head_block_id: string
}

export type ParserEvent = ActionEvent | DeltaEvent | NativeDeltaEvent | ForkEvent
