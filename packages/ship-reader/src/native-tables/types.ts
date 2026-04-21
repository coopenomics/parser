export type NativeTableName =
  | 'account'
  | 'account_metadata'
  | 'block_info'
  | 'code'
  | 'contract_table'
  | 'contract_row'
  | 'contract_index64'
  | 'contract_index128'
  | 'contract_index256'
  | 'contract_index_double'
  | 'contract_index_long_double'
  | 'fill_status'
  | 'generated_transaction'
  | 'global_property'
  | 'key_value'
  | 'permission'
  | 'permission_link'
  | 'protocol_state'
  | 'received_block'
  | 'resource_limits'
  | 'resource_limits_config'
  | 'resource_limits_state'
  | 'resource_usage'
  | 'transaction_trace'

export const NATIVE_TABLE_NAMES: readonly NativeTableName[] = [
  'account', 'account_metadata', 'block_info', 'code', 'contract_table',
  'contract_row', 'contract_index64', 'contract_index128', 'contract_index256',
  'contract_index_double', 'contract_index_long_double', 'fill_status',
  'generated_transaction', 'global_property', 'key_value', 'permission',
  'permission_link', 'protocol_state', 'received_block', 'resource_limits',
  'resource_limits_config', 'resource_limits_state', 'resource_usage',
  'transaction_trace',
]

export function isNativeTableName(name: string): name is NativeTableName {
  return NATIVE_TABLE_NAMES.includes(name as NativeTableName)
}

export interface NativePermissionRow {
  owner: string
  name: string
  parent: string
  last_updated: string
  auth: {
    threshold: number
    keys: Array<{ key: string; weight: number }>
    accounts: Array<{ permission: { actor: string; permission: string }; weight: number }>
    waits: Array<{ wait_sec: number; weight: number }>
  }
}

export interface NativePermissionLinkRow {
  account: string
  code: string
  message_type: string
  required_permission: string
}

export interface NativeAccountRow {
  name: string
  creation_date: string
  abi: string
}

export interface NativeAccountMetadataRow {
  name: string
  recv_sequence: string
  auth_sequence: string
  code_sequence: string
  abi_sequence: string
  code_hash: string
  last_code_update: string
  flags: number
  vm_type: number
  vm_version: number
}

export interface NativeCodeRow {
  vm_type: number
  vm_version: number
  code_hash: string
  code: string
}

export interface NativeContractTableRow {
  code: string
  scope: string
  table: string
  payer: string
  count: number
}

export interface NativeKeyValueRow {
  database: string
  contract: string
  primary_key: string
  payer: string
  value: string
}

export interface NativeReceivedBlockRow {
  block_num: number
  block_id: string
}

export interface NativeBlockInfoRow {
  block_num: number
  block_id: string
  timestamp: string
  producer: string
  confirmed: number
  previous: string
  transaction_mroot: string
  action_mroot: string
  schedule_version: number
  new_producers: unknown | null
  producer_signature: string
  transactions: unknown[]
  block_extensions: unknown[]
}

export interface NativeResourceLimitsRow {
  owner: string
  net_weight: string
  cpu_weight: string
  ram_bytes: string
}

export interface NativeResourceLimitsStateRow {
  average_block_net_usage: { last_ordinal: number; value_ex: string; consumed: string }
  average_block_cpu_usage: { last_ordinal: number; value_ex: string; consumed: string }
  total_net_weight: string
  total_cpu_weight: string
  total_ram_bytes: string
  virtual_net_limit: string
  virtual_cpu_limit: string
}

export interface NativeResourceLimitsConfigRow {
  cpu_limit_parameters: unknown
  net_limit_parameters: unknown
  account_cpu_usage_average_window: number
  account_net_usage_average_window: number
}

export interface NativeResourceUsageRow {
  owner: string
  net_usage: { last_ordinal: number; value_ex: string; consumed: string }
  cpu_usage: { last_ordinal: number; value_ex: string; consumed: string }
  ram_usage: string
}

export interface NativeGlobalPropertyRow {
  proposed_schedule_block_num: number | null
  proposed_schedule: unknown
  configuration: unknown
  chain_id: string
  kv_database_config: unknown
  wasm_configuration: unknown
}

export interface NativeGeneratedTransactionRow {
  sender_id: string
  sender: string
  payer: string
  delay_until: string
  expiration: string
  published: string
  packed_trx: string
}

export interface NativeProtocolStateRow {
  activated_protocol_features: string[]
}

export interface NativeFillStatusRow {
  head: number
  head_id: string
  irreversible: number
  irreversible_id: string
  first: number
}

export type NativeRowTypeMap = {
  permission: NativePermissionRow
  permission_link: NativePermissionLinkRow
  account: NativeAccountRow
  account_metadata: NativeAccountMetadataRow
  code: NativeCodeRow
  contract_table: NativeContractTableRow
  contract_row: Record<string, unknown>
  contract_index64: Record<string, unknown>
  contract_index128: Record<string, unknown>
  contract_index256: Record<string, unknown>
  contract_index_double: Record<string, unknown>
  contract_index_long_double: Record<string, unknown>
  key_value: NativeKeyValueRow
  received_block: NativeReceivedBlockRow
  block_info: NativeBlockInfoRow
  resource_limits: NativeResourceLimitsRow
  resource_limits_state: NativeResourceLimitsStateRow
  resource_limits_config: NativeResourceLimitsConfigRow
  resource_usage: NativeResourceUsageRow
  global_property: NativeGlobalPropertyRow
  generated_transaction: NativeGeneratedTransactionRow
  protocol_state: NativeProtocolStateRow
  fill_status: NativeFillStatusRow
  transaction_trace: Record<string, unknown>
}
