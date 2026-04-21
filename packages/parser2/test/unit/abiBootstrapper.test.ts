import { describe, it, expect, vi } from 'vitest'
import { AbiBootstrapper } from '../../src/abi/AbiBootstrapper.js'
import { AbiStore } from '../../src/abi/AbiStore.js'
import { AbiNotFoundError } from '../../src/errors.js'
import type { ChainClient } from '../../src/ports/ChainClient.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

const FAKE_ABI_BYTES = new Uint8Array([0x01, 0x02, 0x03])

function makeRedis(storedResult: Uint8Array | null = null): RedisStore {
  const base64 = storedResult ? Buffer.from(storedResult).toString('base64') : null
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xreadGroup: vi.fn(), xack: vi.fn(),
    zadd: vi.fn().mockResolvedValue(undefined),
    zrangeByscoreRev: vi.fn().mockResolvedValue(base64 ? [base64] : []),
    hset: vi.fn(), hget: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

function makeChainClient(abiBytes: Uint8Array = FAKE_ABI_BYTES, shouldFail = false): ChainClient {
  return {
    connect: vi.fn(),
    streamBlocks: vi.fn(),
    ack: vi.fn(),
    close: vi.fn(),
    getChainInfo: vi.fn(),
    getRawAbi: shouldFail
      ? vi.fn().mockRejectedValue(new Error('RPC error'))
      : vi.fn().mockResolvedValue(abiBytes),
  } as unknown as ChainClient
}

describe('AbiBootstrapper — first observation', () => {
  it('calls getRawAbi on first appearance of a contract not in ZSET', async () => {
    const redis = makeRedis(null)
    const store = new AbiStore(redis)
    const client = makeChainClient()
    const bootstrapper = new AbiBootstrapper(client, store)

    await bootstrapper.ensureAbi('mycontract', 100)
    expect(client.getRawAbi).toHaveBeenCalledWith('mycontract')
  })

  it('stores fetched ABI in ZSET at correct blockNum', async () => {
    const redis = makeRedis(null)
    const store = new AbiStore(redis)
    const client = makeChainClient(FAKE_ABI_BYTES)
    const bootstrapper = new AbiBootstrapper(client, store)

    await bootstrapper.ensureAbi('mycontract', 150)
    expect(redis.zadd).toHaveBeenCalledWith(
      expect.stringContaining('mycontract'),
      150,
      Buffer.from(FAKE_ABI_BYTES).toString('base64'),
    )
  })

  it('does NOT call getRawAbi if ABI already in ZSET', async () => {
    const redis = makeRedis(FAKE_ABI_BYTES)
    const store = new AbiStore(redis)
    const client = makeChainClient()
    const bootstrapper = new AbiBootstrapper(client, store)

    await bootstrapper.ensureAbi('mycontract', 100)
    expect(client.getRawAbi).not.toHaveBeenCalled()
  })
})

describe('AbiBootstrapper — second observation', () => {
  it('does NOT call getRawAbi on second appearance (already observed)', async () => {
    const redis = makeRedis(null)
    const store = new AbiStore(redis)
    const client = makeChainClient()
    const bootstrapper = new AbiBootstrapper(client, store)

    await bootstrapper.ensureAbi('mycontract', 100)
    await bootstrapper.ensureAbi('mycontract', 101)

    expect(client.getRawAbi).toHaveBeenCalledTimes(1)
  })
})

describe('AbiBootstrapper — abiFallback=fail', () => {
  it('throws AbiNotFoundError when getRawAbi fails and abiFallback=fail', async () => {
    const redis = makeRedis(null)
    const store = new AbiStore(redis)
    const client = makeChainClient(FAKE_ABI_BYTES, true)
    const bootstrapper = new AbiBootstrapper(client, store, { abiFallback: 'fail' })

    await expect(bootstrapper.ensureAbi('brokencontract', 999)).rejects.toThrow(AbiNotFoundError)
  })

  it('returns null when getRawAbi fails and abiFallback=rpc-current (default)', async () => {
    const redis = makeRedis(null)
    const store = new AbiStore(redis)
    const client = makeChainClient(FAKE_ABI_BYTES, true)
    const bootstrapper = new AbiBootstrapper(client, store)

    const result = await bootstrapper.ensureAbi('brokencontract', 999)
    expect(result).toBeNull()
  })
})
