import { describe, it, expect } from 'vitest'
import { matchFilters } from '../../src/client/filters.js'
import type { SubscriptionFilter } from '../../src/client/filters.js'
import type { ParserEvent } from '../../src/types.js'

const CHAIN = 'abc123'
const BLOCK = { chain_id: CHAIN, block_num: 100, block_time: '2024-01-01T00:00:00.000', block_id: 'a'.repeat(64) }

const actionEvent: ParserEvent = {
  kind: 'action',
  event_id: 'id1',
  ...BLOCK,
  account: 'eosio',
  name: 'updateauth',
  authorization: [],
  data: { from: 'alice', permission: 'active' },
  action_ordinal: 1,
  global_sequence: 100n,
  receipt: null,
}

const deltaEvent: ParserEvent = {
  kind: 'delta',
  event_id: 'id2',
  ...BLOCK,
  code: 'eosio.token',
  scope: 'alice',
  table: 'accounts',
  primary_key: '1',
  value: {},
  present: true,
}

const nativeDeltaEvent: ParserEvent = {
  kind: 'native-delta',
  event_id: 'id3',
  ...BLOCK,
  table: 'permission',
  lookup_key: 'alice:active',
  data: {},
  present: true,
}

const forkEvent: ParserEvent = {
  kind: 'fork',
  event_id: 'id4',
  chain_id: CHAIN,
  forked_from_block: 99,
  new_head_block_id: 'b'.repeat(64),
}

describe('matchFilters — subscribe-to-all', () => {
  it('undefined filters → true for any event', () => {
    expect(matchFilters(actionEvent, undefined)).toBe(true)
    expect(matchFilters(forkEvent, undefined)).toBe(true)
  })

  it('empty array → true for any event', () => {
    expect(matchFilters(actionEvent, [])).toBe(true)
    expect(matchFilters(deltaEvent, [])).toBe(true)
  })
})

describe('matchFilters — exact match', () => {
  it('action exact account+name match', () => {
    const f: SubscriptionFilter = { kind: 'action', account: 'eosio', name: 'updateauth' }
    expect(matchFilters(actionEvent, [f])).toBe(true)
  })

  it('action exact match — wrong name', () => {
    const f: SubscriptionFilter = { kind: 'action', account: 'eosio', name: 'deleteauth' }
    expect(matchFilters(actionEvent, [f])).toBe(false)
  })

  it('action exact match — wrong account', () => {
    const f: SubscriptionFilter = { kind: 'action', account: 'eosio.token', name: 'updateauth' }
    expect(matchFilters(actionEvent, [f])).toBe(false)
  })

  it('delta exact match', () => {
    const f: SubscriptionFilter = { kind: 'delta', code: 'eosio.token', table: 'accounts', scope: 'alice' }
    expect(matchFilters(deltaEvent, [f])).toBe(true)
  })

  it('delta exact match — wrong scope', () => {
    const f: SubscriptionFilter = { kind: 'delta', code: 'eosio.token', table: 'accounts', scope: 'bob' }
    expect(matchFilters(deltaEvent, [f])).toBe(false)
  })

  it('native-delta exact match', () => {
    const f: SubscriptionFilter = { kind: 'native-delta', table: 'permission' }
    expect(matchFilters(nativeDeltaEvent, [f])).toBe(true)
  })

  it('fork filter matches fork event', () => {
    expect(matchFilters(forkEvent, [{ kind: 'fork' }])).toBe(true)
  })
})

describe('matchFilters — wildcard', () => {
  it('action with account=* matches any account', () => {
    const f: SubscriptionFilter = { kind: 'action', account: '*', name: 'updateauth' }
    expect(matchFilters(actionEvent, [f])).toBe(true)
  })

  it('action with name=* matches any name', () => {
    const f: SubscriptionFilter = { kind: 'action', account: 'eosio', name: '*' }
    expect(matchFilters(actionEvent, [f])).toBe(true)
  })

  it('action with no account/name fields → match any', () => {
    const f: SubscriptionFilter = { kind: 'action' }
    expect(matchFilters(actionEvent, [f])).toBe(true)
  })

  it('delta with no fields → match any', () => {
    const f: SubscriptionFilter = { kind: 'delta' }
    expect(matchFilters(deltaEvent, [f])).toBe(true)
  })

  it('native-delta with no table → match any', () => {
    const f: SubscriptionFilter = { kind: 'native-delta' }
    expect(matchFilters(nativeDeltaEvent, [f])).toBe(true)
  })
})

describe('matchFilters — OR semantics', () => {
  it('first filter matches → true', () => {
    const filters: SubscriptionFilter[] = [
      { kind: 'action', account: 'eosio', name: 'updateauth' },
      { kind: 'delta', code: 'eosio.token' },
    ]
    expect(matchFilters(actionEvent, filters)).toBe(true)
  })

  it('second filter matches → true', () => {
    const filters: SubscriptionFilter[] = [
      { kind: 'action', account: 'missing' },
      { kind: 'action', account: 'eosio', name: 'updateauth' },
    ]
    expect(matchFilters(actionEvent, filters)).toBe(true)
  })

  it('no filter matches → false', () => {
    const filters: SubscriptionFilter[] = [
      { kind: 'action', account: 'wrong' },
      { kind: 'delta', code: 'wrong' },
    ]
    expect(matchFilters(actionEvent, filters)).toBe(false)
  })
})

describe('matchFilters — kind mismatch', () => {
  it('action filter does not match delta event', () => {
    expect(matchFilters(deltaEvent, [{ kind: 'action', account: 'eosio' }])).toBe(false)
  })

  it('delta filter does not match fork event', () => {
    expect(matchFilters(forkEvent, [{ kind: 'delta', code: 'eosio.token' }])).toBe(false)
  })

  it('native-delta filter does not match action event', () => {
    expect(matchFilters(actionEvent, [{ kind: 'native-delta', table: 'permission' }])).toBe(false)
  })

  it('fork filter does not match action event', () => {
    expect(matchFilters(actionEvent, [{ kind: 'fork' }])).toBe(false)
  })
})

describe('matchFilters — data shallow match', () => {
  it('data.from matches → true', () => {
    const f: SubscriptionFilter<{ from: string; permission: string }> = {
      kind: 'action',
      account: 'eosio',
      data: { from: 'alice' },
    }
    expect(matchFilters(actionEvent, [f as SubscriptionFilter])).toBe(true)
  })

  it('data.from wrong value → false', () => {
    const f: SubscriptionFilter = { kind: 'action', account: 'eosio', data: { from: 'bob' } }
    expect(matchFilters(actionEvent, [f])).toBe(false)
  })
})
