import type { NativeTableName, NativeRowTypeMap } from './types.js'

export function computeLookupKey<T extends NativeTableName>(
  table: T,
  row: NativeRowTypeMap[T],
): string {
  switch (table) {
    case 'permission': {
      const r = row as NativeRowTypeMap['permission']
      return `${r.owner}:${r.name}`
    }
    case 'permission_link': {
      const r = row as NativeRowTypeMap['permission_link']
      return `${r.account}:${r.code}:${r.message_type}`
    }
    case 'account': {
      const r = row as NativeRowTypeMap['account']
      return r.name
    }
    case 'account_metadata': {
      const r = row as NativeRowTypeMap['account_metadata']
      return r.name
    }
    case 'code': {
      const r = row as NativeRowTypeMap['code']
      return r.code_hash
    }
    case 'contract_table': {
      const r = row as NativeRowTypeMap['contract_table']
      return `${r.code}:${r.scope}:${r.table}`
    }
    case 'contract_row': {
      const r = row as Record<string, unknown>
      return `${String(r['code'] ?? '')}:${String(r['scope'] ?? '')}:${String(r['table'] ?? '')}:${String(r['primary_key'] ?? '')}`
    }
    case 'key_value': {
      const r = row as NativeRowTypeMap['key_value']
      return `${r.database}:${r.contract}:${r.primary_key}`
    }
    case 'received_block': {
      const r = row as NativeRowTypeMap['received_block']
      return String(r.block_num)
    }
    case 'block_info': {
      const r = row as NativeRowTypeMap['block_info']
      return String(r.block_num)
    }
    case 'resource_limits': {
      const r = row as NativeRowTypeMap['resource_limits']
      return r.owner
    }
    case 'resource_usage': {
      const r = row as NativeRowTypeMap['resource_usage']
      return r.owner
    }
    case 'global_property':
      return 'global'
    case 'fill_status':
      return 'fill_status'
    case 'protocol_state':
      return 'protocol_state'
    case 'resource_limits_state':
      return 'resource_limits_state'
    case 'resource_limits_config':
      return 'resource_limits_config'
    case 'generated_transaction': {
      const r = row as NativeRowTypeMap['generated_transaction']
      return `${r.sender}:${r.sender_id}`
    }
    case 'contract_index64':
    case 'contract_index128':
    case 'contract_index256':
    case 'contract_index_double':
    case 'contract_index_long_double': {
      const r = row as Record<string, unknown>
      return `${String(r['code'] ?? '')}:${String(r['scope'] ?? '')}:${String(r['table'] ?? '')}:${String(r['primary_key'] ?? '')}`
    }
    case 'transaction_trace': {
      const r = row as Record<string, unknown>
      return String(r['id'] ?? '')
    }
    default: {
      const _exhaustive: never = table
      return String(_exhaustive)
    }
  }
}
