import { ABI, Serializer, type ABISerializable } from '@wharfkit/antelope'
import type { Deserializer } from './Deserializer.js'
import type { Action, Delta, ShipTrace, ShipDelta } from '../types/ship.js'
import type { NativeDeltaEvent } from '../native-tables/index.js'
import { isNativeTableName, computeLookupKey } from '../native-tables/index.js'
import type { NativeTableName } from '../native-tables/types.js'
import { DeserializationError, UnknownNativeTableError } from '../errors.js'

export class WharfkitDeserializer implements Deserializer {
  readonly name = 'wharfkit' as const

  deserializeAction<T = Record<string, unknown>>(trace: ShipTrace, abi: ABI): Action<T> {
    try {
      const raw = Serializer.decode({ data: trace.actRaw, type: trace.name, abi })
      const data = Serializer.objectify(raw as ABISerializable) as T
      return {
        account: trace.account,
        name: trace.name,
        authorization: trace.authorization,
        data,
        actionOrdinal: trace.actionOrdinal,
        globalSequence: trace.globalSequence,
        receipt: trace.receipt,
      }
    } catch (err) {
      throw new DeserializationError(
        `Failed to deserialize action ${trace.account}::${trace.name}`,
        err,
      )
    }
  }

  deserializeContractRow<T = Record<string, unknown>>(delta: ShipDelta, abi: ABI): Delta<T> {
    if (delta.name !== 'contract_row') {
      throw new DeserializationError(`Expected contract_row delta, got "${delta.name}"`)
    }
    if (!delta.code || !delta.scope || !delta.table || !delta.primaryKey) {
      throw new DeserializationError('contract_row delta missing code/scope/table/primaryKey')
    }
    try {
      const rawValue = Serializer.decode({ data: delta.rowRaw, type: delta.table, abi })
      const value = Serializer.objectify(rawValue as ABISerializable) as T
      const present: boolean = delta.present
      return {
        code: delta.code,
        scope: delta.scope,
        table: delta.table,
        primaryKey: delta.primaryKey,
        present,
        value,
      }
    } catch (err) {
      throw new DeserializationError(
        `Failed to deserialize contract_row ${delta.code}/${delta.table}`,
        err,
      )
    }
  }

  deserializeNativeDelta<T = Record<string, unknown>>(delta: ShipDelta): NativeDeltaEvent<T> {
    if (!isNativeTableName(delta.name)) {
      throw new UnknownNativeTableError(delta.name)
    }
    const table = delta.name as NativeTableName
    try {
      const data = JSON.parse(Buffer.from(delta.rowRaw).toString('utf8')) as T
      const lookup_key = computeLookupKey(table, data as never)
      const present: boolean = delta.present
      return { present, table, data, lookup_key }
    } catch (err) {
      throw new DeserializationError(`Failed to deserialize native delta "${table}"`, err)
    }
  }
}
