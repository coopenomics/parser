import { describe, it, expect } from 'vitest'
import { computeEventId } from '../../src/events/eventId.js'
import type { ParserEvent } from '../../src/types.js'

type WithoutId<T> = Omit<T, 'event_id'>

const CHAIN_ID = 'aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906'
const BLOCK_ID = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
const BLOCK_ID_SHORT = BLOCK_ID.slice(0, 16)

function makeAction(override: Partial<WithoutId<Extract<ParserEvent, { kind: 'action' }>>> = {}): WithoutId<Extract<ParserEvent, { kind: 'action' }>> {
  return {
    kind: 'action',
    chain_id: CHAIN_ID,
    block_num: 100,
    block_time: '2024-01-01T00:00:00.000',
    block_id: BLOCK_ID,
    account: 'eosio.token',
    name: 'transfer',
    authorization: [],
    data: {},
    action_ordinal: 1,
    global_sequence: 12345n,
    receipt: null,
    ...override,
  }
}

function makeDelta(override: Partial<WithoutId<Extract<ParserEvent, { kind: 'delta' }>>> = {}): WithoutId<Extract<ParserEvent, { kind: 'delta' }>> {
  return {
    kind: 'delta',
    chain_id: CHAIN_ID,
    block_num: 100,
    block_time: '2024-01-01T00:00:00.000',
    block_id: BLOCK_ID,
    code: 'eosio.token',
    scope: 'alice',
    table: 'accounts',
    primary_key: '42',
    value: {},
    present: true,
    ...override,
  }
}

function makeNativeDelta(override: Partial<WithoutId<Extract<ParserEvent, { kind: 'native-delta' }>>> = {}): WithoutId<Extract<ParserEvent, { kind: 'native-delta' }>> {
  return {
    kind: 'native-delta',
    chain_id: CHAIN_ID,
    block_num: 100,
    block_time: '2024-01-01T00:00:00.000',
    block_id: BLOCK_ID,
    table: 'permission',
    lookup_key: 'alice:active',
    data: {},
    present: true,
    ...override,
  }
}

function makeFork(override: Partial<WithoutId<Extract<ParserEvent, { kind: 'fork' }>>> = {}): WithoutId<Extract<ParserEvent, { kind: 'fork' }>> {
  return {
    kind: 'fork',
    chain_id: CHAIN_ID,
    forked_from_block: 99,
    new_head_block_id: BLOCK_ID,
    ...override,
  }
}

describe('computeEventId — action', () => {
  it('produces correct format', () => {
    const e = makeAction()
    const id = computeEventId(e)
    expect(id).toBe(`${CHAIN_ID}:a:100:${BLOCK_ID_SHORT}:12345`)
  })

  it('is deterministic — same inputs same output', () => {
    const e = makeAction()
    expect(computeEventId(e)).toBe(computeEventId(e))
  })

  it('differs for different global_sequence', () => {
    const a = computeEventId(makeAction({ global_sequence: 1n }))
    const b = computeEventId(makeAction({ global_sequence: 2n }))
    expect(a).not.toBe(b)
  })

  it('block_id_short uses first 16 chars', () => {
    const id = computeEventId(makeAction())
    const parts = id.split(':')
    expect(parts[3]).toHaveLength(16)
    expect(parts[3]).toBe(BLOCK_ID.slice(0, 16))
  })
})

describe('computeEventId — delta', () => {
  it('produces correct format', () => {
    const e = makeDelta()
    const id = computeEventId(e)
    expect(id).toBe(`${CHAIN_ID}:d:100:${BLOCK_ID_SHORT}:eosio.token:alice:accounts:42`)
  })

  it('differs for different primary_key', () => {
    const a = computeEventId(makeDelta({ primary_key: '1' }))
    const b = computeEventId(makeDelta({ primary_key: '2' }))
    expect(a).not.toBe(b)
  })

  it('differs for different scope', () => {
    const a = computeEventId(makeDelta({ scope: 'alice' }))
    const b = computeEventId(makeDelta({ scope: 'bob' }))
    expect(a).not.toBe(b)
  })
})

describe('computeEventId — native-delta', () => {
  it('produces correct format', () => {
    const e = makeNativeDelta()
    const id = computeEventId(e)
    expect(id).toBe(`${CHAIN_ID}:n:100:${BLOCK_ID_SHORT}:permission:alice:active`)
  })

  it('differs for different lookup_key', () => {
    const a = computeEventId(makeNativeDelta({ lookup_key: 'alice:active' }))
    const b = computeEventId(makeNativeDelta({ lookup_key: 'bob:owner' }))
    expect(a).not.toBe(b)
  })
})

describe('computeEventId — fork', () => {
  it('produces correct format', () => {
    const e = makeFork()
    const id = computeEventId(e)
    expect(id).toBe(`${CHAIN_ID}:f:99:${BLOCK_ID_SHORT}`)
  })

  it('differs for different forked_from_block', () => {
    const a = computeEventId(makeFork({ forked_from_block: 99 }))
    const b = computeEventId(makeFork({ forked_from_block: 100 }))
    expect(a).not.toBe(b)
  })

  it('differs for different new_head_block_id', () => {
    const a = computeEventId(makeFork({ new_head_block_id: 'a'.repeat(64) }))
    const b = computeEventId(makeFork({ new_head_block_id: 'b'.repeat(64) }))
    expect(a).not.toBe(b)
  })
})

describe('computeEventId — property-based (100+ fixtures)', () => {
  it('two calls with identical inputs yield identical output', () => {
    for (let i = 0; i < 50; i++) {
      const e = makeAction({ global_sequence: BigInt(i) })
      expect(computeEventId(e)).toBe(computeEventId(e))
    }
    for (let i = 0; i < 25; i++) {
      const e = makeDelta({ primary_key: String(i) })
      expect(computeEventId(e)).toBe(computeEventId(e))
    }
    for (let i = 0; i < 25; i++) {
      const e = makeFork({ forked_from_block: i })
      expect(computeEventId(e)).toBe(computeEventId(e))
    }
  })

  it('different global_sequence always yields different action id', () => {
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => computeEventId(makeAction({ global_sequence: BigInt(i) })))
    )
    expect(ids.size).toBe(50)
  })

  it('different primary_key always yields different delta id', () => {
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => computeEventId(makeDelta({ primary_key: String(i) })))
    )
    expect(ids.size).toBe(50)
  })
})
