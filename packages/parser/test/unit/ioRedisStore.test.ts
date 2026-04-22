import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IoRedisStore } from '../../src/adapters/IoRedisStore.js'

vi.mock('ioredis', () => {
  const mockRedis = {
    xadd: vi.fn().mockResolvedValue('1700000000000-0'),
    xtrim: vi.fn().mockResolvedValue(5),
    zadd: vi.fn().mockResolvedValue(1),
    zrangebyscore: vi.fn().mockResolvedValue(['{"version":"eosio::abi/1.0"}']),
    zrevrangebyscore: vi.fn().mockResolvedValue(['{"version":"eosio::abi/1.0"}']),
    hset: vi.fn().mockResolvedValue(2),
    hget: vi.fn().mockResolvedValue('100'),
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
    connect: vi.fn().mockResolvedValue(undefined),
  }
  return { default: vi.fn(() => mockRedis) }
})

describe('IoRedisStore', () => {
  let store: IoRedisStore

  beforeEach(() => {
    store = new IoRedisStore({ url: 'redis://localhost:6379' })
  })

  it('xadd calls redis.xadd with * id', async () => {
    const id = await store.xadd('mystream', { data: 'hello', kind: 'action' })
    expect(id).toBe('1700000000000-0')
    expect(store.client.xadd).toHaveBeenCalledWith('mystream', '*', 'data', 'hello', 'kind', 'action')
  })

  it('xtrim calls redis.xtrim with MINID', async () => {
    const removed = await store.xtrim('mystream', '1234567890000-0')
    expect(removed).toBe(5)
    expect(store.client.xtrim).toHaveBeenCalledWith('mystream', 'MINID', '1234567890000-0')
  })

  it('zadd calls redis.zadd with score and member', async () => {
    await store.zadd('parser:abi:eosio', 100, '{"version":"eosio::abi/1.0"}')
    expect(store.client.zadd).toHaveBeenCalledWith('parser:abi:eosio', 100, '{"version":"eosio::abi/1.0"}')
  })

  it('zrangeByscoreRev calls redis.zrevrangebyscore with max first, then min', async () => {
    const result = await store.zrangeByscoreRev('parser:abi:eosio', '250', '-inf')
    expect(result).toHaveLength(1)
    expect(store.client.zrevrangebyscore).toHaveBeenCalledWith('parser:abi:eosio', '250', '-inf', 'LIMIT', 0, 1)
  })

  it('hset calls redis.hset with flattened args', async () => {
    await store.hset('parser:sync:mychain', { block_num: '100', block_id: 'abc' })
    expect(store.client.hset).toHaveBeenCalledWith('parser:sync:mychain', 'block_num', '100', 'block_id', 'abc')
  })

  it('hget returns value', async () => {
    const val = await store.hget('parser:sync:mychain', 'block_num')
    expect(val).toBe('100')
  })

  it('setNx returns true when key set', async () => {
    const result = await store.setNx('mylock', 'val', 10000)
    expect(result).toBe(true)
    expect(store.client.set).toHaveBeenCalledWith('mylock', 'val', 'NX', 'PX', 10000)
  })

  it('setNx returns false when key not set', async () => {
    vi.mocked(store.client.set).mockResolvedValueOnce(null)
    const result = await store.setNx('mylock', 'val', 10000)
    expect(result).toBe(false)
  })

  it('pexpire returns true when LUA succeeds', async () => {
    const result = await store.pexpire('mylock', 3000, 'myvalue')
    expect(result).toBe(true)
  })

  it('luaDel returns true when LUA succeeds', async () => {
    const result = await store.luaDel('mylock', 'myvalue')
    expect(result).toBe(true)
  })
})
