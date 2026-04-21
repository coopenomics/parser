import type { RedisStore } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

async function pruneContract(
  redis: RedisStore,
  contract: string,
  olderThan: number,
  dryRun: boolean,
): Promise<{ pruned: number; remaining: number; oldestScore: number | null; newestScore: number | null }> {
  const key = RedisKeys.abiZset(contract)

  const total = await redis.zcard(key)
  if (total === 0) {
    return { pruned: 0, remaining: 0, oldestScore: null, newestScore: null }
  }

  // Count candidates: score strictly less than olderThan (exclusive upper bound)
  const candidateCount = await redis.zcount(key, '-inf', `(${olderThan}`)
  const remaining = total - candidateCount

  if (remaining < 1 && candidateCount > 0) {
    throw new Error(`Cannot prune all ABI versions for ${contract} — at least one must remain`)
  }

  if (!dryRun && candidateCount > 0) {
    await redis.zremRangeByScore(key, '-inf', `(${olderThan}`)
  }

  return { pruned: dryRun ? 0 : candidateCount, remaining, oldestScore: null, newestScore: null }
}

export async function abiPrune(
  redis: RedisStore,
  contract: string | null,
  olderThan: number,
  dryRun: boolean,
  allContracts: boolean,
): Promise<void> {
  if (!allContracts && !contract) {
    throw new Error('Specify --contract or --all-contracts')
  }

  if (allContracts) {
    const keys = await redis.scan('parser2:abi:*')
    if (keys.length === 0) {
      console.log('No ABI history found.')
      return
    }

    const rows: Array<{ contract: string; pruned: number; remaining: number }> = []
    for (const key of keys) {
      const name = key.replace(/^parser2:abi:/, '')
      try {
        const result = await pruneContract(redis, name, olderThan, dryRun)
        rows.push({ contract: name, pruned: dryRun ? result.remaining : result.pruned, remaining: result.remaining })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`  ${name}: ${msg}`)
      }
    }

    if (dryRun) {
      console.log('CONTRACT'.padEnd(30) + 'WOULD PRUNE'.padEnd(14) + 'REMAINING')
      console.log('-'.repeat(54))
      for (const row of rows) {
        const candidateCount = row.pruned
        console.log(row.contract.padEnd(30) + String(candidateCount).padEnd(14) + row.remaining)
      }
    }
    return
  }

  // Single contract
  const key = RedisKeys.abiZset(contract!)
  const total = await redis.zcard(key)
  if (total === 0) {
    console.log(`No ABI history found for contract ${contract}.`)
    return
  }

  const candidateCount = await redis.zcount(key, '-inf', `(${olderThan}`)
  const remaining = total - candidateCount

  if (remaining < 1 && candidateCount > 0) {
    console.error(`Cannot prune all ABI versions — at least one must remain`)
    process.exitCode = 1
    return
  }

  if (dryRun) {
    console.log(`[dry-run] Would prune ${candidateCount} ABI version(s) for ${contract}. ${remaining} version(s) would remain.`)
    return
  }

  const pruned = candidateCount > 0 ? await redis.zremRangeByScore(key, '-inf', `(${olderThan}`) : 0
  const newTotal = await redis.zcard(key)

  if (pruned === 0) {
    console.log(`Pruned 0 ABI versions for ${contract}. ${newTotal} version(s) remain.`)
    return
  }

  console.log(`Pruned ${pruned} ABI version(s) for ${contract}. ${newTotal} version(s) remain.`)
}
