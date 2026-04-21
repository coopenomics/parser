import { describe, it, expect, vi } from 'vitest'
import { FailureTracker } from '../../src/client/FailureTracker.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

function makeRedis(overrides: Partial<RedisStore> = {}): RedisStore {
  const hincrCounter: Record<string, number> = {}
  return {
    xadd: vi.fn().mockResolvedValue('1-0'),
    xtrim: vi.fn(), xgroupCreate: vi.fn(), xreadGroup: vi.fn(), xack: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(),
    hset: vi.fn(),
    hget: vi.fn().mockImplementation(async (_key: string, field: string) => {
      return String(hincrCounter[field] ?? 0)
    }),
    hincrby: vi.fn().mockImplementation(async (_key: string, field: string, incr: number) => {
      hincrCounter[field] = (hincrCounter[field] ?? 0) + incr
      return hincrCounter[field]
    }),
    hdel: vi.fn().mockImplementation(async (_key: string, field: string) => {
      delete hincrCounter[field]
    }),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(),
    expire: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  } as unknown as RedisStore
}

describe('FailureTracker — recordFailure', () => {
  it('increments count on each call', async () => {
    const redis = makeRedis()
    const tracker = new FailureTracker(redis, 'mychain')
    expect(await tracker.recordFailure('sub1', 'eventA')).toBe(1)
    expect(await tracker.recordFailure('sub1', 'eventA')).toBe(2)
    expect(await tracker.recordFailure('sub1', 'eventA')).toBe(3)
  })

  it('calls expire on failures hash', async () => {
    const redis = makeRedis()
    const tracker = new FailureTracker(redis, 'mychain')
    await tracker.recordFailure('sub1', 'eventA')
    expect(redis.expire).toHaveBeenCalled()
  })
})

describe('FailureTracker — shouldDeadLetter', () => {
  it('returns false for count < 3', () => {
    const tracker = new FailureTracker({} as RedisStore, 'chain')
    expect(tracker.shouldDeadLetter(1)).toBe(false)
    expect(tracker.shouldDeadLetter(2)).toBe(false)
  })

  it('returns true for count >= 3', () => {
    const tracker = new FailureTracker({} as RedisStore, 'chain')
    expect(tracker.shouldDeadLetter(3)).toBe(true)
    expect(tracker.shouldDeadLetter(10)).toBe(true)
  })
})

describe('FailureTracker — dead-letter routing', () => {
  it('XADDs to dead-letter stream after 3rd failure', async () => {
    const redis = makeRedis()
    const tracker = new FailureTracker(redis, 'mychain')

    await tracker.recordFailure('sub1', 'eventX')
    await tracker.recordFailure('sub1', 'eventX')
    const count = await tracker.recordFailure('sub1', 'eventX')

    expect(tracker.shouldDeadLetter(count)).toBe(true)
    await tracker.routeToDeadLetter('sub1', 'eventX', { data: '{}' }, 'handler error')

    expect(redis.xadd).toHaveBeenCalledWith(
      expect.stringContaining('dead:sub1'),
      expect.objectContaining({ lastError: 'handler error', subId: 'sub1' }),
    )
  })

  it('2 failures — event stays in PEL (no dead-letter)', async () => {
    const redis = makeRedis()
    const tracker = new FailureTracker(redis, 'mychain')

    await tracker.recordFailure('sub1', 'eventY')
    const count = await tracker.recordFailure('sub1', 'eventY')

    expect(tracker.shouldDeadLetter(count)).toBe(false)
    expect(redis.xadd).not.toHaveBeenCalled()
  })
})

describe('FailureTracker — clearFailure', () => {
  it('removes field from failures hash', async () => {
    const redis = makeRedis()
    const tracker = new FailureTracker(redis, 'mychain')
    await tracker.clearFailure('sub1', 'eventZ')
    expect(redis.hdel).toHaveBeenCalledWith(
      expect.stringContaining('failures'),
      'eventZ',
    )
  })
})
