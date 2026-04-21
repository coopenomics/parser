import type { ABI } from '@wharfkit/antelope'
import type { Deserializer } from './Deserializer.js'
import type { Action, Delta, ShipTrace, ShipDelta } from '../types/ship.js'
import type { NativeDeltaEvent } from '../native-tables/index.js'
import { WharfkitDeserializer } from './WharfkitDeserializer.js'
import { isNativeTableName, computeLookupKey } from '../native-tables/index.js'
import type { NativeTableName } from '../native-tables/types.js'
import { DeserializationError, UnknownNativeTableError } from '../errors.js'

interface AbieosBridge {
  loadAbiHex(contract: string, abiHex: string): boolean
  deserializeActionData(contract: string, action: string, dataHex: string): string
  deserializeTableRowData(contract: string, table: string, dataHex: string): string
  destroy(): void
}

/**
 * Пробует загрузить нативный abieos модуль.
 * Совместимые пакеты (устанавливаются отдельно, не в зависимостях):
 *   - @eosrio/node-abieos  — официальный Node.js биндинг
 *   - @coopenomics/abieos  — форк coopenomics (когда будет опубликован на npm)
 * Если ни один не найден — возвращает null, и будет использован wharfkit fallback.
 */
function tryLoadAbieos(): AbieosBridge | null {
  const candidates = ['@coopenomics/abieos', '@eosrio/node-abieos']
  for (const pkg of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(pkg) as AbieosBridge
      if (mod && typeof mod.loadAbiHex === 'function') return mod
    } catch { /* пакет не установлен — пробуем следующий */ }
  }
  return null
}

function uint8ToHex(arr: Uint8Array): string {
  return Buffer.from(arr).toString('hex')
}

function abiToHex(abi: ABI): string {
  const json = JSON.stringify(abi.toJSON())
  return Buffer.from(json).toString('hex')
}

export class AbieosDeserializer implements Deserializer {
  readonly name = 'abieos' as const

  private readonly abieos: AbieosBridge
  private readonly fallback: WharfkitDeserializer
  private readonly abiCache = new Map<string, boolean>()

  static tryCreate(): AbieosDeserializer | null {
    const abieos = tryLoadAbieos()
    if (!abieos) return null
    return new AbieosDeserializer(abieos)
  }

  private constructor(abieos: AbieosBridge) {
    this.abieos = abieos
    this.fallback = new WharfkitDeserializer()
  }

  private ensureAbi(contract: string, abi: ABI): void {
    const key = `${contract}:${JSON.stringify(abi.version)}`
    if (!this.abiCache.has(key)) {
      this.abieos.loadAbiHex(contract, abiToHex(abi))
      this.abiCache.set(key, true)
    }
  }

  deserializeAction<T = Record<string, unknown>>(trace: ShipTrace, abi: ABI): Action<T> {
    try {
      this.ensureAbi(trace.account, abi)
      const hex = uint8ToHex(trace.actRaw)
      const json = this.abieos.deserializeActionData(trace.account, trace.name, hex)
      const data = JSON.parse(json) as T
      const present: boolean = true
      void present
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
        `abieos failed to deserialize action ${trace.account}::${trace.name}`,
        err,
      )
    }
  }

  deserializeContractRow<T = Record<string, unknown>>(delta: ShipDelta, abi: ABI): Delta<T> {
    if (!delta.code || !delta.scope || !delta.table || !delta.primaryKey) {
      throw new DeserializationError('contract_row delta missing code/scope/table/primaryKey')
    }
    try {
      this.ensureAbi(delta.code, abi)
      const hex = uint8ToHex(delta.rowRaw)
      const json = this.abieos.deserializeTableRowData(delta.code, delta.table, hex)
      const value = JSON.parse(json) as T
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
        `abieos failed to deserialize contract_row ${delta.code}/${delta.table}`,
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
      throw new DeserializationError(`abieos failed to deserialize native delta "${table}"`, err)
    }
  }

  destroy(): void {
    this.abieos.destroy()
  }
}

export function createDeserializer(mode: 'wharfkit' | 'abieos'): Deserializer {
  if (mode === 'abieos') {
    const d = AbieosDeserializer.tryCreate()
    if (d) return d
    console.warn('[coopos-ship-reader] abieos not available, falling back to wharfkit')
  }
  return new WharfkitDeserializer()
}
