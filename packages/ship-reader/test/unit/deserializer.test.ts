import { describe, it, expect } from 'vitest'
import { ABI, Serializer } from '@wharfkit/antelope'
import { WharfkitDeserializer } from '../../src/deserializers/WharfkitDeserializer.js'
import { DeserializationError } from '../../src/errors.js'
import type { ShipTrace, ShipDelta } from '../../src/types/ship.js'

function makeAbi(actions: Array<{ name: string; fields: Array<{ name: string; type: string }> }>, tables?: Array<{ name: string; type: string }>): ABI {
  return ABI.from({
    version: 'eosio::abi/1.0',
    types: [],
    structs: actions.map(a => ({ name: a.name, base: '', fields: a.fields })),
    actions: actions.map(a => ({ name: a.name, type: a.name, ricardian_contract: '' })),
    tables: (tables ?? []).map(t => ({ name: t.name, type: t.type, index_type: 'i64', key_names: ['id'], key_types: ['uint64'] })),
    variants: [],
  })
}

function makeTrace(override: Partial<ShipTrace> = {}): ShipTrace {
  return {
    account: 'eosio',
    name: 'transfer',
    authorization: [{ actor: 'alice', permission: 'active' }],
    actRaw: new Uint8Array([]),
    actionOrdinal: 1,
    globalSequence: 100n,
    receipt: null,
    blockNum: 1,
    blockId: 'a'.repeat(64),
    blockTime: '2024-01-01T00:00:00.000',
    transactionId: 'b'.repeat(64),
    ...override,
  }
}

function makeDelta(override: Partial<ShipDelta> = {}): ShipDelta {
  return {
    name: 'contract_row',
    present: true,
    rowRaw: new Uint8Array([]),
    code: 'eosio.token',
    scope: 'alice',
    table: 'accounts',
    primaryKey: '1',
    ...override,
  }
}

describe('WharfkitDeserializer — deserializeAction', () => {
  const deser = new WharfkitDeserializer()

  it('decodes transfer action with uint64 amount', () => {
    const abi = makeAbi([
      { name: 'transfer', fields: [{ name: 'from', type: 'name' }, { name: 'to', type: 'name' }, { name: 'amount', type: 'uint64' }] },
    ])
    const encoded = Serializer.encode({
      object: { from: 'alice', to: 'bob', amount: 100 },
      type: 'transfer',
      abi,
    })
    const trace = makeTrace({ actRaw: encoded.array })
    const action = deser.deserializeAction<{ from: string; to: string; amount: number }>(trace, abi)
    expect(action.data.from).toBe('alice')
    expect(action.data.to).toBe('bob')
    expect(action.account).toBe('eosio')
    expect(action.globalSequence).toBe(100n)
  })

  it('preserves authorization array', () => {
    const abi = makeAbi([{ name: 'transfer', fields: [{ name: 'v', type: 'uint32' }] }])
    const encoded = Serializer.encode({ object: { v: 42 }, type: 'transfer', abi })
    const trace = makeTrace({
      actRaw: encoded.array,
      authorization: [{ actor: 'alice', permission: 'active' }, { actor: 'bob', permission: 'owner' }],
    })
    const action = deser.deserializeAction(trace, abi)
    expect(action.authorization).toHaveLength(2)
  })

  it('throws DeserializationError on bad binary', () => {
    const abi = makeAbi([{ name: 'transfer', fields: [{ name: 'v', type: 'uint64' }] }])
    const trace = makeTrace({ actRaw: new Uint8Array([0xff, 0xff]) })
    expect(() => deser.deserializeAction(trace, abi)).toThrow(DeserializationError)
  })

  it('returns present: boolean (not string)', () => {
    const rowAbi = makeAbi([{ name: 'accounts', fields: [{ name: 'v', type: 'uint32' }] }], [{ name: 'accounts', type: 'accounts' }])
    const encoded = Serializer.encode({ object: { v: 1 }, type: 'accounts', abi: rowAbi })
    const delta = makeDelta({ rowRaw: encoded.array })
    const result = deser.deserializeContractRow(delta, rowAbi)
    expect(typeof result.present).toBe('boolean')
    expect(result.present).toBe(true)
  })

  it('processes 5 actions and 3 deltas correctly', () => {
    const abi = makeAbi(
      [{ name: 'transfer', fields: [{ name: 'v', type: 'uint32' }] }],
      [{ name: 'accounts', type: 'transfer' }],
    )
    const encoded = Serializer.encode({ object: { v: 99 }, type: 'transfer', abi })

    const actions = Array.from({ length: 5 }, (_, i) =>
      deser.deserializeAction(makeTrace({ actRaw: encoded.array, actionOrdinal: i + 1 }), abi),
    )
    // use accounts table (which maps to transfer struct)
    const deltas = Array.from({ length: 3 }, () =>
      deser.deserializeContractRow(makeDelta({ rowRaw: encoded.array, table: 'transfer' }), abi),
    )

    expect(actions).toHaveLength(5)
    expect(deltas).toHaveLength(3)
    for (const a of actions) expect((a.data as { v: number }).v).toBe(99)
    for (const d of deltas) expect((d.value as { v: number }).v).toBe(99)
  })
})

describe('WharfkitDeserializer — deserializeContractRow', () => {
  const deser = new WharfkitDeserializer()

  it('throws when delta.name is not contract_row', () => {
    const abi = makeAbi([{ name: 'accounts', fields: [{ name: 'v', type: 'uint64' }] }])
    const delta = makeDelta({ name: 'permission' })
    expect(() => deser.deserializeContractRow(delta, abi)).toThrow(DeserializationError)
  })

  it('throws when code/scope/table/primaryKey missing', () => {
    const abi = makeAbi([])
    const delta = makeDelta({ code: undefined })
    expect(() => deser.deserializeContractRow(delta, abi)).toThrow(DeserializationError)
  })
})
