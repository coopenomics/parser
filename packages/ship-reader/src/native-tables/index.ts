export type { NativeTableName, NativeRowTypeMap, NativePermissionRow, NativePermissionLinkRow, NativeAccountRow, NativeAccountMetadataRow, NativeCodeRow, NativeContractTableRow, NativeKeyValueRow, NativeReceivedBlockRow, NativeBlockInfoRow, NativeResourceLimitsRow, NativeResourceLimitsStateRow, NativeResourceLimitsConfigRow, NativeResourceUsageRow, NativeGlobalPropertyRow, NativeGeneratedTransactionRow, NativeProtocolStateRow, NativeFillStatusRow } from './types.js'
export { NATIVE_TABLE_NAMES, isNativeTableName } from './types.js'
export { computeLookupKey } from './lookup-keys.js'

export interface NativeDeltaEvent<T = Record<string, unknown>> {
  readonly present: boolean
  readonly table: import('./types.js').NativeTableName
  readonly data: T
  readonly lookup_key: string
}
