import { describe, it, expect, vi } from 'vitest'
import { abiPrune } from '../../src/cli/commands/abiPrune.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

function makeRedis(opts: {
  total?: number
  candidateCount?: number
  pruned?: number
  scanKeys?: string[]
} = {}): RedisStore {
  const { total = 0, candidateCount = 0, pruned = candidateCount, scanKeys = [] } = opts
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xgroupSetId: vi.fn(),
    xinfoGroups: vi.fn(), xreadGroup: vi.fn(), xrange: vi.fn(), xrevrange: vi.fn(), xlen: vi.fn(), xdel: vi.fn(), xack: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(), zrangeByScore: vi.fn(),
    zcount: vi.fn().mockResolvedValue(candidateCount),
    zremRangeByScore: vi.fn().mockResolvedValue(pruned),
    zcard: vi.fn()
      .mockResolvedValueOnce(total)
      .mockResolvedValue(total - pruned),
    hset: vi.fn(), hget: vi.fn(), hgetAll: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(),
    scan: vi.fn().mockResolvedValue(scanKeys),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('abiPrune — empty ZSET', () => {
  it('prints "No ABI history found" when ZSET is empty', async () => {
    const redis = makeRedis({ total: 0 })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 100000, false, false)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('No ABI history found'))
      expect(redis.zremRangeByScore).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
})

describe('abiPrune — normal prune', () => {
  it('calls zremRangeByScore with exclusive upper bound', async () => {
    const redis = makeRedis({ total: 10, candidateCount: 7, pruned: 7 })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 100000, false, false)
      expect(redis.zremRangeByScore).toHaveBeenCalledWith(
        expect.stringContaining('eosio'),
        '-inf',
        '(100000',
      )
    } finally { spy.mockRestore() }
  })

  it('reports pruned count in output', async () => {
    const redis = makeRedis({ total: 10, candidateCount: 7, pruned: 7 })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 100000, false, false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('7')
    } finally { spy.mockRestore() }
  })
})

describe('abiPrune — dry-run', () => {
  it('does NOT call zremRangeByScore in dry-run', async () => {
    const redis = makeRedis({ total: 5, candidateCount: 3 })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 100000, true, false)
      expect(redis.zremRangeByScore).not.toHaveBeenCalled()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('dry-run'))
    } finally { spy.mockRestore() }
  })
})

describe('abiPrune — safety guard', () => {
  it('prints error and does not prune when all versions would be removed', async () => {
    const redis = makeRedis({ total: 3, candidateCount: 3 })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 999999, false, false)
      expect(redis.zremRangeByScore).not.toHaveBeenCalled()
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot prune all'))
    } finally { errSpy.mockRestore() }
  })
})

describe('abiPrune — zero candidates', () => {
  it('reports 0 pruned when no candidates exist', async () => {
    const redis = makeRedis({ total: 5, candidateCount: 0, pruned: 0 })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await abiPrune(redis, 'eosio', 100000, false, false)
      expect(redis.zremRangeByScore).not.toHaveBeenCalled()
      expect(spy.mock.calls.flat().join('\n')).toContain('0')
    } finally { spy.mockRestore() }
  })
})
