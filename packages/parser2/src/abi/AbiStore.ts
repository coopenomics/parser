import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

export class AbiStore {
  constructor(private readonly redis: RedisStore) {}

  async getAbi(contract: string, blockNum: number): Promise<Uint8Array | null> {
    const key = RedisKeys.abiZset(contract)
    const results = await this.redis.zrangeByscoreRev(key, String(blockNum), '-inf')
    if (results.length === 0 || !results[0]) return null
    return Buffer.from(results[0], 'base64')
  }

  async storeAbi(contract: string, blockNum: number, abiBytes: Uint8Array): Promise<void> {
    const key = RedisKeys.abiZset(contract)
    const member = Buffer.from(abiBytes).toString('base64')
    await this.redis.zadd(key, blockNum, member)
  }
}
