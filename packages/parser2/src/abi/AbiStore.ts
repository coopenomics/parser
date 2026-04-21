/**
 * Хранилище версий ABI в Redis Sorted Set.
 *
 * Проблема: ABI контракта меняется в блоке eosio::setabi. Чтобы корректно
 * декодировать действия и дельты исторических блоков, нужна версия ABI,
 * актуальная именно на момент этого блока.
 *
 * Решение: каждая версия ABI хранится как member в ZSET с score=block_num.
 * Для получения ABI на блок N делается ZREVRANGEBYSCORE key N -inf LIMIT 0 1 —
 * это возвращает самую позднюю версию, появившуюся не позже блока N.
 */

import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

export class AbiStore {
  constructor(private readonly redis: RedisStore) {}

  /**
   * Ищет версию ABI контракта, актуальную на момент blockNum.
   * Использует ZREVRANGEBYSCORE: возвращает последнюю запись со score ≤ blockNum.
   * @returns Байты ABI или null если история пуста для данного контракта.
   */
  async getAbi(contract: string, blockNum: number): Promise<Uint8Array | null> {
    const key = RedisKeys.abiZset(contract)
    // ZREVRANGEBYSCORE key blockNum -inf LIMIT 0 1 — один элемент с максимальным score ≤ blockNum
    const results = await this.redis.zrangeByscoreRev(key, String(blockNum), '-inf')
    if (results.length === 0 || !results[0]) return null
    // Байты хранятся в base64 для совместимости с Redis String-значениями
    return Buffer.from(results[0], 'base64')
  }

  /**
   * Сохраняет новую версию ABI, привязывая её к blockNum.
   * Вызывается AbiBootstrapper при первом наблюдении контракта и
   * BlockProcessor'ом при перехвате eosio::setabi / account-дельты.
   */
  async storeAbi(contract: string, blockNum: number, abiBytes: Uint8Array): Promise<void> {
    const key = RedisKeys.abiZset(contract)
    const member = Buffer.from(abiBytes).toString('base64')
    await this.redis.zadd(key, blockNum, member)
  }
}
