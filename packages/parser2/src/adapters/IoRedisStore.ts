import type { RedisOptions } from 'ioredis'
import type { RedisStore, StreamMessage, XGroupInfo } from '../ports/RedisStore.js'

type RedisConstructor = new (url: string, opts?: RedisOptions) => IRedisClient
interface IRedisClient {
  connect(): Promise<void>
  xadd(stream: string, id: string, ...args: string[]): Promise<string | null>
  xtrim(stream: string, strategy: string, threshold: string): Promise<number>
  xgroup(action: string, stream: string, group: string, id: string, mkstream?: string): Promise<unknown>
  xinfo(subcommand: string, key: string): Promise<unknown>
  xreadgroup(
    group: string, groupName: string, consumer: string, consumerName: string,
    count: string, countVal: number,
    block: string, blockMs: number,
    streams: string, stream: string, id: string,
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>
  xrange(key: string, start: string, end: string, count: string, countVal: number): Promise<Array<[string, string[]]>>
  xrevrange(key: string, end: string, start: string, count: string, countVal: number): Promise<Array<[string, string[]]>>
  xlen(key: string): Promise<number>
  xdel(key: string, ...ids: string[]): Promise<number>
  xack(stream: string, group: string, id: string): Promise<number>
  zadd(key: string, score: number, member: string): Promise<number>
  zrangebyscore(key: string, min: string, max: string, limit: string, offset: number, count: number): Promise<string[]>
  zrevrangebyscore(key: string, max: string, min: string, limit: string, offset: number, count: number): Promise<string[]>
  zcount(key: string, min: string, max: string): Promise<number>
  zremrangebyscore(key: string, min: string, max: string): Promise<number>
  zcard(key: string): Promise<number>
  hset(key: string, ...args: string[]): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string> | null>
  hincrby(key: string, field: string, increment: number): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  set(key: string, value: string, nx: string, px: string, ms: number): Promise<string | null>
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>
  expire(key: string, seconds: number): Promise<number>
  scan(cursor: string, match: string, pattern: string, count: string, countVal: number): Promise<[string, string[]]>
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

function parseStreamEntries(raw: Array<[string, string[]]>): StreamMessage[] {
  const messages: StreamMessage[] = []
  for (const [msgId, rawFields] of raw) {
    const fields: Record<string, string> = {}
    for (let i = 0; i + 1 < rawFields.length; i += 2) {
      fields[rawFields[i] ?? ''] = rawFields[i + 1] ?? ''
    }
    messages.push({ id: msgId, fields })
  }
  return messages
}

function parseXGroupInfo(raw: unknown): XGroupInfo {
  let obj: Record<string, unknown>
  if (Array.isArray(raw)) {
    obj = {}
    for (let i = 0; i + 1 < raw.length; i += 2) {
      obj[raw[i] as string] = raw[i + 1]
    }
  } else {
    obj = raw as Record<string, unknown>
  }
  return {
    name: String(obj['name'] ?? ''),
    pending: Number(obj['pending'] ?? 0),
    lastDeliveredId: String(obj['last-delivered-id'] ?? '0-0'),
    lag: obj['lag'] != null ? Number(obj['lag']) : null,
    consumers: Number(obj['consumers'] ?? 0),
  }
}

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
      if (err instanceof Error && err.message.includes('BUSYGROUP')) return
      throw err
    }
  }

  async xgroupSetId(stream: string, group: string, id: string): Promise<void> {
    await this.client.xgroup('SETID', stream, group, id)
  }

  async xinfoGroups(stream: string): Promise<XGroupInfo[]> {
    const raw = await this.client.xinfo('GROUPS', stream) as unknown[]
    return (raw ?? []).map(parseXGroupInfo)
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
      messages.push(...parseStreamEntries(entries))
    }
    return messages
  }

  async xrange(stream: string, start: string, end: string, count: number): Promise<StreamMessage[]> {
    const raw = await this.client.xrange(stream, start, end, 'COUNT', count)
    return parseStreamEntries(raw)
  }

  async xrevrange(stream: string, end: string, start: string, count: number): Promise<StreamMessage[]> {
    const raw = await this.client.xrevrange(stream, end, start, 'COUNT', count)
    return parseStreamEntries(raw)
  }

  async xlen(stream: string): Promise<number> {
    return this.client.xlen(stream)
  }

  async xdel(stream: string, id: string): Promise<number> {
    return this.client.xdel(stream, id)
  }

  async xack(stream: string, group: string, id: string): Promise<void> {
    await this.client.xack(stream, group, id)
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member)
  }

  async zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]> {
    return this.client.zrevrangebyscore(key, max, min, 'LIMIT', 0, 1)
  }

  async zrangeByScore(key: string, min: string, max: string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max, 'LIMIT', 0, 9_999_999)
  }

  async zcount(key: string, min: string, max: string): Promise<number> {
    return this.client.zcount(key, min, max)
  }

  async zremRangeByScore(key: string, min: string, max: string): Promise<number> {
    return this.client.zremrangebyscore(key, min, max)
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key)
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) args.push(k, v)
    if (args.length > 0) await this.client.hset(key, ...args)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  async hgetAll(key: string): Promise<Record<string, string>> {
    const result = await this.client.hgetall(key)
    return result ?? {}
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

  async scan(pattern: string, count = 100): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count)
      keys.push(...batch)
      cursor = nextCursor
    } while (cursor !== '0')
    return keys
  }

  async quit(): Promise<void> {
    await this.client.quit()
  }
}
