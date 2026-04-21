import { describe, it, expect, vi } from 'vitest'
import { RedisConsumer, CONSUMER_NAME } from '../../src/client/RedisConsumer.js'
import type { RedisStore, StreamMessage } from '../../src/ports/RedisStore.js'

function makeMsg(id: string, data = '{}'): StreamMessage {
  return { id, fields: { data } }
}

function makeRedis(messages: StreamMessage[][] = []): RedisStore {
  let callCount = 0
  return {
    xadd: vi.fn(), xtrim: vi.fn(),
    xgroupCreate: vi.fn().mockResolvedValue(undefined),
    xreadGroup: vi.fn().mockImplementation(async () => {
      const batch = messages[callCount++]
      return batch ?? []
    }),
    xack: vi.fn().mockResolvedValue(undefined),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('RedisConsumer — init', () => {
  it('calls xgroupCreate with MKSTREAM', async () => {
    const redis = makeRedis()
    const c = new RedisConsumer({ redis, stream: 'mystream', groupName: 'mygroup' })
    await c.init('$')
    expect(redis.xgroupCreate).toHaveBeenCalledWith('mystream', 'mygroup', '$')
  })

  it('uses constant consumer name "primary"', () => {
    expect(CONSUMER_NAME).toBe('primary')
  })
})

describe('RedisConsumer — recoverOwnPending', () => {
  it('calls xreadGroup with id "0" to get pending messages', async () => {
    const pending = [makeMsg('1-0'), makeMsg('2-0'), makeMsg('3-0'), makeMsg('4-0'), makeMsg('5-0')]
    const redis = makeRedis([pending])
    const c = new RedisConsumer({ redis, stream: 's', groupName: 'g' })
    const result = await c.recoverOwnPending()
    expect(result).toHaveLength(5)
    expect(redis.xreadGroup).toHaveBeenCalledWith('s', 'g', CONSUMER_NAME, 100, 0, '0')
  })
})

describe('RedisConsumer — read generator', () => {
  it('yields pending messages first, then new messages', async () => {
    const pending = [makeMsg('1-0', '{"kind":"action"}')]
    const newMsgs = [makeMsg('2-0', '{"kind":"delta"}')]
    // First call returns pending (id='0'), second returns new (id='>'), third returns empty → stop
    const redis = makeRedis([pending, newMsgs, []])
    const c = new RedisConsumer({ redis, stream: 's', groupName: 'g', blockMs: 0 })
    await c.init()

    const received: StreamMessage[] = []
    for await (const msg of c.read()) {
      received.push(msg)
      if (received.length === 2) c.stop()
    }

    expect(received[0]?.id).toBe('1-0')
    expect(received[1]?.id).toBe('2-0')
  }, 5000)

  it('XACK is called after ack()', async () => {
    const redis = makeRedis([[]])
    const c = new RedisConsumer({ redis, stream: 's', groupName: 'g' })
    await c.ack('5-0')
    expect(redis.xack).toHaveBeenCalledWith('s', 'g', '5-0')
  })
})
