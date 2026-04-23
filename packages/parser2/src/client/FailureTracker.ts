/**
 * Трекер ошибок обработки событий для конкретной подписки.
 *
 * Логика: consumer обрабатывает событие и иногда выбрасывает исключение.
 * Вместо немедленного перевода в dead-letter даём несколько попыток (FAILURE_THRESHOLD = 3).
 * После FAILURE_THRESHOLD провалов событие переводится в dead-letter stream.
 *
 * Счётчики хранятся в Redis Hash (parser2:sub:<subId>:failures) с TTL 24 ч.
 * TTL сбрасывается при каждом новом провале — чтобы не накапливать стали счётчики.
 *
 * Почему Redis, а не in-memory: при рестарте consumer'а незакрытые ошибки
 * не теряются и события всё равно попадут в dead-letter при следующей попытке.
 */

import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

/** После 3 ошибок подряд событие уходит в dead-letter. */
const FAILURE_THRESHOLD = 3
/** TTL хэша с счётчиками: 24 часа. Обновляется при каждом новом провале. */
const FAILURE_TTL_SECONDS = 86_400

export class FailureTracker {
  private redis: RedisStore
  private chainId: string

  constructor(redis: RedisStore, chainId: string) {
    this.redis = redis
    this.chainId = chainId
  }

  /**
   * Инкрементирует счётчик ошибок для eventId и продлевает TTL хэша.
   * @returns Новое значение счётчика (1, 2, 3, …).
   */
  async recordFailure(subId: string, eventId: string): Promise<number> {
    const key = RedisKeys.subFailuresHash(subId)
    const count = await this.redis.hincrby(key, eventId, 1)
    // Продлеваем TTL всего хэша (per-field HEXPIRE доступен только с Redis 7.4+)
    await this.redis.expire(key, FAILURE_TTL_SECONDS)
    return count
  }

  /**
   * Возвращает текущий счётчик ошибок для eventId.
   * 0 если счётчик не существует (событие ещё не проваливалось).
   */
  async getFailureCount(subId: string, eventId: string): Promise<number> {
    const key = RedisKeys.subFailuresHash(subId)
    const val = await this.redis.hget(key, eventId)
    return val ? parseInt(val, 10) : 0
  }

  /**
   * Проверяет достиг ли счётчик порога для dead-letter.
   * Вызывается после recordFailure: if (shouldDeadLetter(count)) { … }
   */
  shouldDeadLetter(count: number): boolean {
    return count >= FAILURE_THRESHOLD
  }

  /**
   * Записывает событие в dead-letter stream с метаданными об ошибке.
   * Dead-letter stream: ce:parser2:<chainId>:dead:<subId>
   * Поля записи: data (оригинальный payload), failureCount, lastError, subId.
   */
  async routeToDeadLetter(
    subId: string,
    eventId: string,
    /** Оригинальные fields из StreamMessage (включая поле 'data'). */
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

  /**
   * Сбрасывает счётчик ошибок для eventId после успешной обработки.
   * Вызывается после успешного yield события в ParserClient.
   */
  async clearFailure(subId: string, eventId: string): Promise<void> {
    await this.redis.hdel(RedisKeys.subFailuresHash(subId), eventId)
  }
}
