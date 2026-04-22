import { describe, it, expect, vi } from 'vitest'
import { replayDeadLetter } from '../../src/cli/commands/replayDeadLetter.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

const EVENT_ID = 'mainnet:a:150000:abcd1234:9876543'
const ENTRY_DATA = JSON.stringify({ kind: 'action', event_id: EVENT_ID, block_num: 150000 })
const ENTRY = { id: '1714500000000-1', fields: { data: ENTRY_DATA, failureCount: '3', lastError: 'boom', subId: 'verifier' } }

function makeRedis(opts: {
  xrangeResult?: typeof ENTRY[]
} = {}): RedisStore {
  return {
    xadd: vi.fn().mockResolvedValue('1714600000000-0'),
    xtrim: vi.fn(), xgroupCreate: vi.fn(), xgroupSetId: vi.fn(),
    xinfoGroups: vi.fn(), xreadGroup: vi.fn(),
    xrange: vi.fn().mockResolvedValue(opts.xrangeResult ?? []),
    xrevrange: vi.fn(), xack: vi.fn(),
    xlen: vi.fn().mockResolvedValue(0),
    xdel: vi.fn().mockResolvedValue(1),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(), zrangeByScore: vi.fn(), zcount: vi.fn(),
    zremRangeByScore: vi.fn(), zcard: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hgetAll: vi.fn().mockResolvedValue({}), hincrby: vi.fn(),
    hdel: vi.fn().mockResolvedValue(undefined),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(), scan: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('replayDeadLetter — event found', () => {
  it('calls xadd with original data, xdel, hdel', async () => {
    const redis = makeRedis({ xrangeResult: [ENTRY] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await replayDeadLetter(redis, 'mainnet', 'verifier', EVENT_ID, false, false)
      expect(redis.xadd).toHaveBeenCalledWith(
        expect.stringContaining('mainnet'),
        expect.objectContaining({ data: ENTRY_DATA }),
      )
      expect(redis.xdel).toHaveBeenCalledWith(expect.stringContaining('dead:verifier'), '1714500000000-1')
      expect(redis.hdel).toHaveBeenCalledWith(expect.stringContaining('failures'), EVENT_ID)
    } finally { spy.mockRestore() }
  })

  it('prints success message with new entry id', async () => {
    const redis = makeRedis({ xrangeResult: [ENTRY] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await replayDeadLetter(redis, 'mainnet', 'verifier', EVENT_ID, false, false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('Replayed event')
      expect(output).toContain('1714600000000-0')
    } finally { spy.mockRestore() }
  })
})

describe('replayDeadLetter — event not found', () => {
  it('prints error and exits with code 1', async () => {
    const redis = makeRedis({ xrangeResult: [] })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    try {
      await expect(replayDeadLetter(redis, 'mainnet', 'verifier', 'missing:id', false, false))
        .rejects.toThrow('process.exit')
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Event not found'))
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })
})

describe('replayDeadLetter — dry-run', () => {
  it('does NOT call xadd or xdel in dry-run', async () => {
    const redis = makeRedis({ xrangeResult: [ENTRY] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await replayDeadLetter(redis, 'mainnet', 'verifier', EVENT_ID, false, true)
      expect(redis.xadd).not.toHaveBeenCalled()
      expect(redis.xdel).not.toHaveBeenCalled()
      expect(spy.mock.calls.flat().join('\n')).toContain('dry-run')
    } finally { spy.mockRestore() }
  })
})

describe('replayDeadLetter — --all flag', () => {
  it('replays all entries from dead-letter stream', async () => {
    const entry2 = { id: '1714500001000-0', fields: { data: JSON.stringify({ kind: 'delta', event_id: 'mainnet:d:150001:x:c:s:t:k', block_num: 150001 }), failureCount: '3', lastError: 'err2', subId: 'verifier' } }
    const redis = makeRedis({ xrangeResult: [ENTRY, entry2] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await replayDeadLetter(redis, 'mainnet', 'verifier', null, true, false)
      expect(redis.xadd).toHaveBeenCalledTimes(2)
      expect(redis.xdel).toHaveBeenCalledTimes(2)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('2')
    } finally { spy.mockRestore() }
  })

  it('dry-run --all shows count without executing', async () => {
    const redis = makeRedis({ xrangeResult: [ENTRY] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await replayDeadLetter(redis, 'mainnet', 'verifier', null, true, true)
      expect(redis.xadd).not.toHaveBeenCalled()
      expect(spy.mock.calls.flat().join('\n')).toContain('dry-run')
    } finally { spy.mockRestore() }
  })
})
