import type { RedisOptions } from 'ioredis'
import type { RedisStore, StreamMessage } from '../ports/RedisStore.js'

type RedisConstructor = new (url: string, opts?: RedisOptions) => IRedisClient
interface IRedisClient {
  connect(): Promise<void>
  xadd(stream: string, id: string, ...args: string[]): Promise<string | null>
  xtrim(stream: string, strategy: string, threshold: string): Promise<number>
  xgroup(action: string, stream: string, group: string, id: string, mkstream?: string): Promise<unknown>
  xreadgroup(
    group: string, groupName: string, consumer: string, consumerName: string,
    count: string, countVal: number,
    block: string, blockMs: number,
    streams: string, stream: string, id: string,
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>
  xack(stream: string, group: string, id: string): Promise<number>
  xinfoGroups(stream: string): Promise<unknown[]>
  zadd(key: string, score: number, member: string): Promise<number>
  zrangebyscore(key: string, min: string, max: string, limit: string, offset: number, count: number): Promise<string[]>
  hset(key: string, ...args: string[]): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hincrby(key: string, field: string, increment: number): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  set(key: string, value: string, nx: string, px: string, ms: number): Promise<string | null>
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>
  expire(key: string, seconds: number): Promise<number>
  quit(): Promise<string>
}

const { default: RedisClass } = await import('ioredis') as unknown as { default: RedisConstructor }

const PEXPIRE_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[2] then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return 1
end
return 0
`

const DEL_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`

export class IoRedisStore implements RedisStore {
  readonly client: IRedisClient

  constructor(opts: { url: string; password?: string; keyPrefix?: string }) {
    const redisOpts: RedisOptions = {
      lazyConnect: true,
      enableReadyCheck: true,
    }
    if (opts.password !== undefined) redisOpts.password = opts.password
    if (opts.keyPrefix !== undefined) redisOpts.keyPrefix = opts.keyPrefix

    this.client = new RedisClass(opts.url, redisOpts)
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) args.push(k, v)
    const id = await this.client.xadd(stream, '*', ...args)
    return id ?? ''
  }

  async xtrim(stream: string, minId: string): Promise<number> {
    return this.client.xtrim(stream, 'MINID', minId)
  }

  async xgroupCreate(stream: string, group: string, startId: string): Promise<void> {
    try {
      await this.client.xgroup('CREATE', stream, group, startId, 'MKSTREAM')
    } catch (err) {
      // BUSYGROUP = group already exists — idempotent
      if (err instanceof Error && err.message.includes('BUSYGROUP')) return
      throw err
    }
  }

  async xreadGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
    id: string,
  ): Promise<StreamMessage[]> {
    const result = await this.client.xreadgroup(
      'GROUP', group, consumer, consumer,
      'COUNT', count,
      'BLOCK', blockMs,
      'STREAMS', stream, id,
    )
    if (!result) return []
    const messages: StreamMessage[] = []
    for (const [, entries] of result) {
      for (const [msgId, rawFields] of entries) {
        const fields: Record<string, string> = {}
        for (let i = 0; i + 1 < rawFields.length; i += 2) {
          fields[rawFields[i] ?? ''] = rawFields[i + 1] ?? ''
        }
        messages.push({ id: msgId, fields })
      }
    }
    return messages
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    await this.client.xack(stream, group, id)
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member)
  }

  async zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max, 'LIMIT', 0, 1)
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) args.push(k, v)
    if (args.length > 0) await this.client.hset(key, ...args)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment)
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field)
  }

  async setNx(key: string, value: string, pxMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'NX', 'PX', pxMs)
    return result === 'OK'
  }

  async pexpire(key: string, ms: number, value: string): Promise<boolean> {
    const result = await this.client.eval(PEXPIRE_LUA, 1, key, String(ms), value) as number
    return result === 1
  }

  async luaDel(key: string, value: string): Promise<boolean> {
    const result = await this.client.eval(DEL_LUA, 1, key, value) as number
    return result === 1
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds)
  }

  async quit(): Promise<void> {
    await this.client.quit()
  }
}
