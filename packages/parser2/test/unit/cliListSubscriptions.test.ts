import { describe, it, expect, vi } from 'vitest'
import { listSubscriptions } from '../../src/cli/commands/listSubscriptions.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

const SUB_META = JSON.stringify({
  subId: 'verifier',
  filters: [{ kind: 'action', account: 'eosio', name: '*' }],
  startFrom: 'last_known',
  registeredAt: '2024-01-01T00:00:00.000Z',
})

function makeRedis(
  subs: Record<string, string> = {},
  groups: Awaited<ReturnType<RedisStore['xinfoGroups']>> = [],
): RedisStore {
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xgroupSetId: vi.fn(),
    xinfoGroups: vi.fn().mockResolvedValue(groups),
    xreadGroup: vi.fn(), xrange: vi.fn(), xrevrange: vi.fn(), xlen: vi.fn(), xdel: vi.fn(), xack: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(), zrangeByScore: vi.fn(), zcount: vi.fn(),
    zremRangeByScore: vi.fn(), zcard: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hgetAll: vi.fn().mockResolvedValue(subs),
    hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(), scan: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('listSubscriptions — empty', () => {
  it('prints "No subscriptions registered." when HASH is empty', async () => {
    const redis = makeRedis({})
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listSubscriptions(redis, 'mychain', false)
      expect(spy).toHaveBeenCalledWith('No subscriptions registered.')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('listSubscriptions — with subscriptions', () => {
  it('shows table header when subs exist', async () => {
    const redis = makeRedis({ verifier: SUB_META })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listSubscriptions(redis, 'mychain', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('SUB ID')
      expect(output).toContain('PENDING')
      expect(output).toContain('verifier')
    } finally {
      spy.mockRestore()
    }
  })

  it('shows pending/lag from consumer group when group exists', async () => {
    const groups = [{ name: 'verifier', pending: 3, lag: 7, lastDeliveredId: '1714500000-5', consumers: 1 }]
    const redis = makeRedis({ verifier: SUB_META }, groups)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listSubscriptions(redis, 'mychain', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('3')
      expect(output).toContain('7')
    } finally {
      spy.mockRestore()
    }
  })

  it('shows "not started" when group does not exist', async () => {
    const redis = makeRedis({ verifier: SUB_META }, [])
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listSubscriptions(redis, 'mychain', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('not started')
    } finally {
      spy.mockRestore()
    }
  })

  it('outputs JSON array when --json flag is set', async () => {
    const groups = [{ name: 'verifier', pending: 0, lag: 0, lastDeliveredId: '0-0', consumers: 1 }]
    const redis = makeRedis({ verifier: SUB_META }, groups)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listSubscriptions(redis, 'mychain', true)
      const raw = spy.mock.calls[0]?.[0] as string
      const parsed = JSON.parse(raw) as unknown[]
      expect(Array.isArray(parsed)).toBe(true)
      expect((parsed[0] as { subId: string }).subId).toBe('verifier')
    } finally {
      spy.mockRestore()
    }
  })
})
