/**
 * CLI-команда: parser abi-prune
 *
 * Удаляет устаревшие версии ABI из Redis Sorted Set.
 *
 * Проблема: каждый вызов eosio::setabi сохраняет новую версию ABI в ZSET.
 * За месяцы/годы для активных контрактов накапливаются сотни версий,
 * большинство из которых уже никогда не понадобятся.
 *
 * Логика удаления: удаляем версии со score (block_num) < olderThan.
 * Исключительная верхняя граница: `(olderThan` — чтобы не удалить
 * версию ровно на границе (версия exactAt должна остаться как «начальная»
 * для блоков начиная с olderThan).
 *
 * Защита: не допускаем удаление ВСЕХ версий — хотя бы одна должна остаться.
 *
 * Режим --dry-run: показывает что было бы удалено, не изменяя Redis.
 */

import type { RedisStore } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

/**
 * Выполняет prune для одного контракта.
 * Выбрасывает Error если все версии попадут под удаление (safety guard).
 */
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

  // Считаем кандидатов: score строго меньше olderThan (исключительная верхняя граница)
  const candidateCount = await redis.zcount(key, '-inf', `(${olderThan}`)
  const remaining = total - candidateCount

  // Safety: нельзя удалить последнюю версию — без ABI декодирование сломается
  if (remaining < 1 && candidateCount > 0) {
    throw new Error(`Cannot prune all ABI versions for ${contract} — at least one must remain`)
  }

  if (!dryRun && candidateCount > 0) {
    await redis.zremRangeByScore(key, '-inf', `(${olderThan}`)
  }

  return { pruned: dryRun ? 0 : candidateCount, remaining, oldestScore: null, newestScore: null }
}

/**
 * Основная функция команды abi-prune.
 *
 * @param redis — Redis-клиент.
 * @param contract — имя контракта (null если allContracts=true).
 * @param olderThan — block_num: удалить версии с block_num < olderThan.
 * @param dryRun — только показать, не удалять.
 * @param allContracts — обработать все контракты в Redis (SCAN parser:abi:*).
 */
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
    // SCAN по паттерну: находим все ABI-ключи во всех контрактах
    const keys = await redis.scan('parser:abi:*')
    if (keys.length === 0) {
      console.log('No ABI history found.')
      return
    }

    const rows: Array<{ contract: string; pruned: number; remaining: number }> = []
    for (const key of keys) {
      const name = key.replace(/^parser:abi:/, '')
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

  // Одиночный контракт
  const key = RedisKeys.abiZset(contract!)
  const total = await redis.zcard(key)
  if (total === 0) {
    console.log(`No ABI history found for contract ${contract}.`)
    return
  }

  // Исключительная верхняя граница '(N': не трогаем версию ровно на olderThan
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
