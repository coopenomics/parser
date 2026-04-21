export interface RedisStore {
  xadd(stream: string, fields: Record<string, string>): Promise<string>
  xtrim(stream: string, minId: string): Promise<number>
  zadd(key: string, score: number, member: string): Promise<void>
  zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]>
  hset(key: string, fields: Record<string, string>): Promise<void>
  hget(key: string, field: string): Promise<string | null>
  setNx(key: string, value: string, pxMs: number): Promise<boolean>
  pexpire(key: string, ms: number, value: string): Promise<boolean>
  luaDel(key: string, value: string): Promise<boolean>
  quit(): Promise<void>
}
