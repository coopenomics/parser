import { describe, it, expect, vi } from 'vitest'
import { AbiStore } from '../../src/abi/AbiStore.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

function makeRedis(zrevResults: string[] = []): RedisStore {
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xreadGroup: vi.fn(), xack: vi.fn(),
    zadd: vi.fn().mockResolvedValue(undefined),
    zrangeByscoreRev: vi.fn().mockResolvedValue(zrevResults),
    hset: vi.fn(), hget: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('AbiStore — storeAbi', () => {
  it('calls zadd with blockNum as score and base64-encoded bytes as member', async () => {
    const redis = makeRedis()
    const store = new AbiStore(redis)
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    await store.storeAbi('mycontract', 1000, bytes)
    expect(redis.zadd).toHaveBeenCalledWith(
      expect.stringContaining('mycontract'),
      1000,
      Buffer.from(bytes).toString('base64'),
    )
  })

  it('stores three versions with different block scores', async () => {
    const redis = makeRedis()
    const store = new AbiStore(redis)
    await store.storeAbi('eosio', 100, new Uint8Array([1]))
    await store.storeAbi('eosio', 200, new Uint8Array([2]))
    await store.storeAbi('eosio', 300, new Uint8Array([3]))
    expect(redis.zadd).toHaveBeenCalledTimes(3)
    const calls = (redis.zadd as ReturnType<typeof vi.fn>).mock.calls as [string, number, string][]
    expect(calls.map(c => c[1])).toEqual([100, 200, 300])
  })
})

describe('AbiStore — getAbi', () => {
  it('returns null when ZSET is empty', async () => {
    const redis = makeRedis([])
    const store = new AbiStore(redis)
    const result = await store.getAbi('eosio', 50)
    expect(result).toBeNull()
  })

  it('calls zrangeByscoreRev with blockNum as max and -inf as min', async () => {
    const redis = makeRedis([])
    const store = new AbiStore(redis)
    await store.getAbi('eosio', 250)
    expect(redis.zrangeByscoreRev).toHaveBeenCalledWith(
      expect.stringContaining('eosio'),
      '250',
      '-inf',
    )
  })

  it('returns decoded bytes for score=200 when blockNum=250 (3 versions: 100,200,300)', async () => {
    const v200 = Buffer.from(new Uint8Array([0xaa, 0xbb])).toString('base64')
    const redis = makeRedis([v200])
    const store = new AbiStore(redis)
    const result = await store.getAbi('eosio', 250)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result!)).toEqual([0xaa, 0xbb])
  })

  it('returns null when no version has score <= blockNum', async () => {
    const redis = makeRedis([])
    const store = new AbiStore(redis)
    const result = await store.getAbi('eosio', 50)
    expect(result).toBeNull()
  })

  it('returns correct version for exact score match (blockNum=300)', async () => {
    const v300 = Buffer.from(new Uint8Array([0xff])).toString('base64')
    const redis = makeRedis([v300])
    const store = new AbiStore(redis)
    const result = await store.getAbi('eosio', 300)
    expect(Array.from(result!)).toEqual([0xff])
  })
})
