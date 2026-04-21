export interface StreamMessage {
  id: string
  fields: Record<string, string>
}

export interface XGroupInfo {
  name: string
  pending: number
  lastDeliveredId: string
  lag: number | null
  consumers: number
}

export interface RedisStore {
  // Stream operations
  xadd(stream: string, fields: Record<string, string>): Promise<string>
  xtrim(stream: string, minId: string): Promise<number>
  xgroupCreate(stream: string, group: string, startId: string): Promise<void>
  xgroupSetId(stream: string, group: string, id: string): Promise<void>
  xinfoGroups(stream: string): Promise<XGroupInfo[]>
  xreadGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
    id: string,
  ): Promise<StreamMessage[]>
  xrange(stream: string, start: string, end: string, count: number): Promise<StreamMessage[]>
  xrevrange(stream: string, end: string, start: string, count: number): Promise<StreamMessage[]>
  xlen(stream: string): Promise<number>
  xdel(stream: string, id: string): Promise<number>
  xack(stream: string, group: string, id: string): Promise<void>

  // Sorted set operations
  zadd(key: string, score: number, member: string): Promise<void>
  zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]>
  zrangeByScore(key: string, min: string, max: string): Promise<string[]>
  zcount(key: string, min: string, max: string): Promise<number>
  zremRangeByScore(key: string, min: string, max: string): Promise<number>
  zcard(key: string): Promise<number>

  // Hash operations
  hset(key: string, fields: Record<string, string>): Promise<void>
  hget(key: string, field: string): Promise<string | null>
  hgetAll(key: string): Promise<Record<string, string>>
  hincrby(key: string, field: string, increment: number): Promise<number>
  hdel(key: string, field: string): Promise<void>

  // Key operations
  setNx(key: string, value: string, pxMs: number): Promise<boolean>
  pexpire(key: string, ms: number, value: string): Promise<boolean>
  luaDel(key: string, value: string): Promise<boolean>
  expire(key: string, seconds: number): Promise<void>
  scan(pattern: string, count?: number): Promise<string[]>

  quit(): Promise<void>
}
