/**
 * CLI-команда: parser reset-subscription
 *
 * Перемещает позицию consumer group в Redis Stream.
 *
 * Зачем нужно: после потери состояния Redis, ручного вмешательства или
 * при тестировании нужно заставить consumer повторно обработать события
 * начиная с конкретного блока (или пропустить всё до последнего).
 *
 * Операция: XGROUP SETID <stream> <groupName> <targetId>
 * После этого consumer при следующем старте начнёт читать с targetId.
 *
 * Нюансы:
 *   - Если у group есть pending messages (PEL) — они будут повторно доставлены
 *     при следующем recoverOwnPending. Предупреждаем об этом.
 *   - Поиск targetId: сканируем XRANGE чтобы найти entry ID с block_num < targetBlock.
 *     Устанавливаем group на этот ID — следующий XREADGROUP '>' начнёт с targetBlock.
 *   - Если block_num уже вышел за пределы стрима (XTRIM) — выдаём ошибку.
 */

import type { RedisStore, StreamMessage } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

/**
 * Сканирует стрим и находит последний entry ID с block_num < targetBlock.
 * Используется как позиция для XGROUP SETID: consumer начнёт с targetBlock,
 * а не с targetBlock-1 (т.к. читает '>' — после установленного ID).
 *
 * Пагинация через '(' + lastId (исключительный старт) чтобы не читать огромный стрим целиком.
 */
async function findSetidForBlock(
  redis: RedisStore,
  stream: string,
  targetBlock: number,
): Promise<string> {
  let cursor = '-'
  let lastBeforeTarget = '0-0'

  while (true) {
    const entries: StreamMessage[] = await redis.xrange(stream, cursor, '+', 100)
    if (entries.length === 0) break

    for (const entry of entries) {
      let blockNum: number | undefined
      try {
        const event = JSON.parse(entry.fields['data'] ?? '{}') as { block_num?: unknown }
        if (event.block_num !== undefined) blockNum = Number(event.block_num)
      } catch { /* пропускаем записи с невалидным JSON */ }

      if (blockNum !== undefined) {
        if (blockNum < targetBlock) {
          // Эта запись — кандидат: block_num меньше целевого
          lastBeforeTarget = entry.id
        } else {
          // Нашли запись с block_num >= targetBlock — дальше искать не нужно
          return lastBeforeTarget
        }
      }
    }

    if (entries.length < 100) break
    const lastId = entries[entries.length - 1]!.id
    // Исключительный старт следующей страницы: '(' + id (Redis 6.2+)
    cursor = '(' + lastId
  }

  return lastBeforeTarget
}

/**
 * Выполняет сброс позиции consumer group.
 *
 * @param redis — Redis-клиент.
 * @param chainId — идентификатор цепи (для построения ключей).
 * @param subId — идентификатор подписки (имя consumer group).
 * @param toBlock — '0'/'latest' = '$' (конец стрима), или числовой block_num.
 * @param dryRun — только показать, не изменять Redis.
 */
export async function resetSubscription(
  redis: RedisStore,
  chainId: string,
  subId: string,
  toBlock: string,
  dryRun: boolean,
): Promise<void> {
  const stream = RedisKeys.eventsStream(chainId)
  const groupName = subId

  // Проверяем что consumer group вообще существует — иначе сброс бессмысленен
  let groups: Awaited<ReturnType<typeof redis.xinfoGroups>> = []
  try {
    groups = await redis.xinfoGroups(stream)
  } catch {
    throw new Error(`Subscription ${subId} has no active consumer group. Start the consumer first.`)
  }

  const group = groups.find(g => g.name === groupName)
  if (!group) {
    throw new Error(`Subscription ${subId} has no active consumer group. Start the consumer first.`)
  }

  const pelCount = group.pending

  // Определяем целевой ID
  let targetId: string
  if (toBlock === '0' || toBlock === 'latest' || toBlock === '$') {
    // '$' = «последний записанный ID»: consumer будет получать только новые события
    targetId = '$'
  } else {
    const blockNum = Number(toBlock)
    if (isNaN(blockNum) || blockNum < 0) {
      throw new Error(`Invalid --to-block value: ${toBlock}. Use a block number, 0, or "latest".`)
    }

    // Проверяем доступность: стрим мог быть обрезан XTRIM
    const firstEntries = await redis.xrange(stream, '-', '+', 1)
    if (firstEntries.length > 0) {
      let earliestBlock: number | undefined
      try {
        const event = JSON.parse(firstEntries[0]!.fields['data'] ?? '{}') as { block_num?: unknown }
        if (event.block_num !== undefined) earliestBlock = Number(event.block_num)
      } catch { /* игнорируем невалидный JSON */ }

      if (earliestBlock !== undefined && blockNum < earliestBlock) {
        throw new Error(
          `Block ${blockNum} is before earliest available block ${earliestBlock} (stream trimmed). Cannot reset to trimmed range.`,
        )
      }
    }

    // Ищем entry ID, предшествующий targetBlock
    targetId = await findSetidForBlock(redis, stream, blockNum)
  }

  if (dryRun) {
    console.log(`[dry-run] Would execute: XGROUP SETID ${stream} ${groupName} ${targetId}`)
    if (pelCount > 0) {
      console.log(`Warning: PEL has ${pelCount} pending messages. They will be re-delivered on next consumer start.`)
    }
    return
  }

  await redis.xgroupSetId(stream, groupName, targetId)
  console.log(`Reset subscription ${subId} to entry ${targetId}.`)
  if (pelCount > 0) {
    console.log(`Warning: PEL has ${pelCount} pending messages. They will be re-delivered on next consumer start.`)
  }
}
