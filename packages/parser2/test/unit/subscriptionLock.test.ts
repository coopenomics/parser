import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SubscriptionLock } from '../../src/client/SubscriptionLock.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

function makeRedis(overrides: Partial<RedisStore> = {}): RedisStore {
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xreadGroup: vi.fn(), xack: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn().mockResolvedValue(true),
    pexpire: vi.fn().mockResolvedValue(true),
    luaDel: vi.fn().mockResolvedValue(true),
    expire: vi.fn(),
    quit: vi.fn(),
    ...overrides,
  } as unknown as RedisStore
}

describe('SubscriptionLock — acquire', () => {
  it('returns true and sets state=active when lock acquired', async () => {
    const redis = makeRedis({ setNx: vi.fn().mockResolvedValue(true) })
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1' })
    const result = await lock.acquire()
    expect(result).toBe(true)
    expect(lock.state).toBe('active')
  })

  it('returns false and sets state=standby when lock is taken', async () => {
    const redis = makeRedis({ setNx: vi.fn().mockResolvedValue(false) })
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1' })
    const result = await lock.acquire()
    expect(result).toBe(false)
    expect(lock.state).toBe('standby')
  })
})

describe('SubscriptionLock — waitForPromotion', () => {
  it('promotes when lock becomes free on second poll', async () => {
    const setNx = vi.fn()
      .mockResolvedValueOnce(false)  // first acquire → standby
      .mockResolvedValueOnce(false)  // first poll → still taken
      .mockResolvedValueOnce(true)   // second poll → acquired
    const redis = makeRedis({ setNx })
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1', heartbeatIntervalMs: 99999 })
    await lock.acquire()
    await lock.waitForPromotion()
    expect(lock.state).toBe('active')
    lock.stopHeartbeat()
  }, 5000)

  it('throws on timeout', async () => {
    const redis = makeRedis({ setNx: vi.fn().mockResolvedValue(false) })
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1', acquireLockTimeoutMs: 100 })
    await lock.acquire()
    await expect(lock.waitForPromotion()).rejects.toThrow('timeout')
  }, 5000)
})

describe('SubscriptionLock — heartbeat', () => {
  it('transitions to standby when heartbeat value mismatches', async () => {
    const pexpire = vi.fn().mockResolvedValue(false) // mismatch
    const redis = makeRedis({ pexpire })
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1', heartbeatIntervalMs: 50 })
    await lock.acquire()
    await new Promise(r => setTimeout(r, 150))
    expect(lock.state).toBe('standby')
    lock.stopHeartbeat()
  }, 5000)
})

describe('SubscriptionLock — release', () => {
  it('calls luaDel and sets state=released', async () => {
    const redis = makeRedis()
    const lock = new SubscriptionLock({ redis, subId: 'sub1', instanceId: 'inst1', heartbeatIntervalMs: 99999 })
    await lock.acquire()
    await lock.release()
    expect(lock.state).toBe('released')
    expect(redis.luaDel).toHaveBeenCalled()
  })
})
