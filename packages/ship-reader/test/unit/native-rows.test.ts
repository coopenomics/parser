import { describe, it, expect } from 'vitest'
import { WharfkitDeserializer } from '../../src/deserializers/WharfkitDeserializer.js'
import { computeLookupKey } from '../../src/native-tables/index.js'
import { isNativeTableName, NATIVE_TABLE_NAMES } from '../../src/native-tables/types.js'
import { UnknownNativeTableError } from '../../src/errors.js'
import type { ShipDelta } from '../../src/types/ship.js'
import type { NativePermissionRow, NativePermissionLinkRow } from '../../src/native-tables/types.js'

function jsonDelta(name: string, data: unknown, present = true): ShipDelta {
  return {
    name,
    present,
    rowRaw: new Uint8Array(Buffer.from(JSON.stringify(data))),
  }
}

describe('NATIVE_TABLE_NAMES whitelist', () => {
  it('has exactly 24 entries', () => {
    expect(NATIVE_TABLE_NAMES).toHaveLength(24)
  })

  it('isNativeTableName returns true for known tables', () => {
    expect(isNativeTableName('permission')).toBe(true)
    expect(isNativeTableName('account')).toBe(true)
    expect(isNativeTableName('contract_row')).toBe(true)
  })

  it('isNativeTableName returns false for unknown tables', () => {
    expect(isNativeTableName('unknown_table')).toBe(false)
    expect(isNativeTableName('')).toBe(false)
  })
})

describe('computeLookupKey', () => {
  it('permission → owner:name', () => {
    const row: NativePermissionRow = {
      owner: 'alice', name: 'active', parent: 'owner',
      last_updated: '2024-01-01T00:00:00.000',
      auth: { threshold: 1, keys: [], accounts: [], waits: [] },
    }
    expect(computeLookupKey('permission', row)).toBe('alice:active')
  })

  it('permission_link → account:code:message_type', () => {
    const row: NativePermissionLinkRow = {
      account: 'alice', code: 'eosio', message_type: 'transfer', required_permission: 'active',
    }
    expect(computeLookupKey('permission_link', row)).toBe('alice:eosio:transfer')
  })

  it('account → name', () => {
    expect(computeLookupKey('account', { name: 'alice', creation_date: '', abi: '' })).toBe('alice')
  })

  it('resource_limits → owner', () => {
    expect(computeLookupKey('resource_limits', { owner: 'bob', net_weight: '0', cpu_weight: '0', ram_bytes: '0' })).toBe('bob')
  })

  it('global_property → "global"', () => {
    expect(computeLookupKey('global_property', {} as never)).toBe('global')
  })
})

describe('WharfkitDeserializer — deserializeNativeDelta', () => {
  const deser = new WharfkitDeserializer()

  it('deserializes permission delta with correct lookup_key', () => {
    const permData: NativePermissionRow = {
      owner: 'alice', name: 'active', parent: 'owner',
      last_updated: '2024-01-01T00:00:00.000',
      auth: { threshold: 1, keys: [], accounts: [], waits: [] },
    }
    const delta = jsonDelta('permission', permData)
    const event = deser.deserializeNativeDelta<NativePermissionRow>(delta)
    expect(event.table).toBe('permission')
    expect(event.lookup_key).toBe('alice:active')
    expect(event.present).toBe(true)
    expect(event.data.owner).toBe('alice')
  })

  it('present field is boolean (not string)', () => {
    const delta = jsonDelta('account', { name: 'bob', creation_date: '', abi: '' }, false)
    const event = deser.deserializeNativeDelta(delta)
    expect(typeof event.present).toBe('boolean')
    expect(event.present).toBe(false)
  })

  it('throws UnknownNativeTableError for unknown table', () => {
    const delta: ShipDelta = { name: 'my_custom_table', present: true, rowRaw: new Uint8Array([]) }
    expect(() => deser.deserializeNativeDelta(delta)).toThrow(UnknownNativeTableError)
  })

  it('all NATIVE_TABLE_NAMES tables deserialize without throwing (smoke test)', () => {
    for (const table of NATIVE_TABLE_NAMES) {
      const delta = jsonDelta(table, { name: 'test' })
      expect(() => deser.deserializeNativeDelta(delta)).not.toThrow()
    }
  })
})
