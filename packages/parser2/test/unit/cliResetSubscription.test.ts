import { describe, it, expect, vi } from 'vitest'
import { resetSubscription } from '../../src/cli/commands/resetSubscription.js'
import type { RedisStore, StreamMessage } from '../../src/ports/RedisStore.js'

function makeMsg(id: string, blockNum: number): StreamMessage {
  return { id, fields: { data: JSON.stringify({ kind: 'action', block_num: blockNum }) } }
}

function makeRedis(
  groups: Awaited<ReturnType<RedisStore['xinfoGroups']>> = [],
  streamEntries: StreamMessage[] = [],
): RedisStore {
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(),
    xgroupSetId: vi.fn().mockResolvedValue(undefined),
    xinfoGroups: vi.fn().mockResolvedValue(groups),
    xreadGroup: vi.fn(),
    xrange: vi.fn().mockResolvedValue(streamEntries),
    xrevrange: vi.fn(),
    xlen: vi.fn(), xdel: vi.fn(),
    xack: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(), zrangeByScore: vi.fn(), zcount: vi.fn(),
    zremRangeByScore: vi.fn(), zcard: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hgetAll: vi.fn().mockResolvedValue({}),
    hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(), scan: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

const GROUP = { name: 'sub1', pending: 0, lag: 0, lastDeliveredId: '1234-0', consumers: 1 }

describe('resetSubscription — to-block 0 or latest', () => {
  it('calls XGROUP SETID with "$" for --to-block 0', async () => {
    const redis = makeRedis([GROUP])
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await resetSubscription(redis, 'chain', 'sub1', '0', false)
      expect(redis.xgroupSetId).toHaveBeenCalledWith(expect.stringContaining('chain'), 'sub1', '$')
    } finally { spy.mockRestore() }
  })

  it('calls XGROUP SETID with "$" for --to-block latest', async () => {
    const redis = makeRedis([GROUP])
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await resetSubscription(redis, 'chain', 'sub1', 'latest', false)
      expect(redis.xgroupSetId).toHaveBeenCalledWith(expect.any(String), 'sub1', '$')
    } finally { spy.mockRestore() }
  })
})

describe('resetSubscription — specific block', () => {
  it('finds correct SETID by scanning stream entries', async () => {
    const entries = [
      makeMsg('100-0', 99),
      makeMsg('200-0', 150),
      makeMsg('300-0', 200),
    ]
    const redis = makeRedis([GROUP], entries)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await resetSubscription(redis, 'chain', 'sub1', '150', false)
      expect(redis.xgroupSetId).toHaveBeenCalledWith(expect.any(String), 'sub1', '100-0')
    } finally { spy.mockRestore() }
  })

  it('throws error when group not found', async () => {
    const redis = makeRedis([])
    await expect(resetSubscription(redis, 'chain', 'sub1', '100', false)).rejects.toThrow(
      'no active consumer group',
    )
  })
})

describe('resetSubscription — dry-run', () => {
  it('does NOT call xgroupSetId in dry-run mode', async () => {
    const redis = makeRedis([GROUP])
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await resetSubscription(redis, 'chain', 'sub1', '0', true)
      expect(redis.xgroupSetId).not.toHaveBeenCalled()
      expect(spy.mock.calls.flat().join('\n')).toContain('dry-run')
    } finally { spy.mockRestore() }
  })
})
