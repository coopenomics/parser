export interface StreamMessage {
  id: string
  fields: Record<string, string>
}

export interface RedisStore {
  // Stream operations
  xadd(stream: string, fields: Record<string, string>): Promise<string>
  xtrim(stream: string, minId: string): Promise<number>
  xgroupCreate(stream: string, group: string, startId: string): Promise<void>
  xreadGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
    id: string,
  ): Promise<StreamMessage[]>
  xack(stream: string, group: string, id: string): Promise<void>

  // Sorted set operations
  zadd(key: string, score: number, member: string): Promise<void>
  zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]>

  // Hash operations
  hset(key: string, fields: Record<string, string>): Promise<void>
  hget(key: string, field: string): Promise<string | null>
  hincrby(key: string, field: string, increment: number): Promise<number>
  hdel(key: string, field: string): Promise<void>

  // Key operations
  setNx(key: string, value: string, pxMs: number): Promise<boolean>
  pexpire(key: string, ms: number, value: string): Promise<boolean>
  luaDel(key: string, value: string): Promise<boolean>
  expire(key: string, seconds: number): Promise<void>

  quit(): Promise<void>
}
