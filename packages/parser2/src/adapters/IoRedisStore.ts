import type { RedisOptions } from 'ioredis'
import type { RedisStore } from '../ports/RedisStore.js'

// CJS/ESM interop — ioredis has no "exports" field for NodeNext resolution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RedisConstructor = new (url: string, opts?: RedisOptions) => any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: any

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
    await this.client.connect() as Promise<void>
  }

  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, v)
    }
    const id = await this.client.xadd(stream, '*', ...args) as string | null
    return id ?? ''
  }

  async xtrim(stream: string, minId: string): Promise<number> {
    return this.client.xtrim(stream, 'MINID', minId) as Promise<number>
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member)
  }

  async zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max, 'LIMIT', 0, 1) as Promise<string[]>
  }

  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) {
      args.push(k, v)
    }
    if (args.length > 0) await this.client.hset(key, ...args)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field) as Promise<string | null>
  }

  async setNx(key: string, value: string, pxMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'NX', 'PX', pxMs) as string | null
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

  async quit(): Promise<void> {
    await this.client.quit()
  }
}
