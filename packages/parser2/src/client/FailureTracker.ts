import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

const FAILURE_THRESHOLD = 3
const FAILURE_TTL_SECONDS = 86_400 // 24h

export class FailureTracker {
  private redis: RedisStore
  private chainId: string

  constructor(redis: RedisStore, chainId: string) {
    this.redis = redis
    this.chainId = chainId
  }

  async recordFailure(subId: string, eventId: string): Promise<number> {
    const key = RedisKeys.subFailuresHash(subId)
    const count = await this.redis.hincrby(key, eventId, 1)
    // Reset TTL on the whole hash (per-field HEXPIRE requires Redis 7.4+)
    await this.redis.expire(key, FAILURE_TTL_SECONDS)
    return count
  }

  async getFailureCount(subId: string, eventId: string): Promise<number> {
    const key = RedisKeys.subFailuresHash(subId)
    const val = await this.redis.hget(key, eventId)
    return val ? parseInt(val, 10) : 0
  }

  shouldDeadLetter(count: number): boolean {
    return count >= FAILURE_THRESHOLD
  }

  async routeToDeadLetter(
    subId: string,
    eventId: string,
    payload: Record<string, string>,
    lastError: string,
  ): Promise<void> {
    const stream = RedisKeys.deadLetterStream(this.chainId, subId)
    await this.redis.xadd(stream, {
      ...payload,
      failureCount: String(FAILURE_THRESHOLD),
      lastError,
      subId,
    })
  }

  async clearFailure(subId: string, eventId: string): Promise<void> {
    await this.redis.hdel(RedisKeys.subFailuresHash(subId), eventId)
  }
}
