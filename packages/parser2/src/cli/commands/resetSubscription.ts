import type { RedisStore, StreamMessage } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

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
      } catch { /* skip */ }

      if (blockNum !== undefined) {
        if (blockNum < targetBlock) {
          lastBeforeTarget = entry.id
        } else {
          return lastBeforeTarget
        }
      }
    }

    if (entries.length < 100) break
    const lastId = entries[entries.length - 1]!.id
    cursor = '(' + lastId  // exclusive start for next XRANGE (Redis 6.2+)
  }

  return lastBeforeTarget
}

export async function resetSubscription(
  redis: RedisStore,
  chainId: string,
  subId: string,
  toBlock: string,
  dryRun: boolean,
): Promise<void> {
  const stream = RedisKeys.eventsStream(chainId)
  const groupName = subId

  // Verify group exists
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

  // Determine target stream entry ID
  let targetId: string
  if (toBlock === '0' || toBlock === 'latest' || toBlock === '$') {
    targetId = '$'
  } else {
    const blockNum = Number(toBlock)
    if (isNaN(blockNum) || blockNum < 0) {
      throw new Error(`Invalid --to-block value: ${toBlock}. Use a block number, 0, or "latest".`)
    }

    // Check earliest available block
    const firstEntries = await redis.xrange(stream, '-', '+', 1)
    if (firstEntries.length > 0) {
      let earliestBlock: number | undefined
      try {
        const event = JSON.parse(firstEntries[0]!.fields['data'] ?? '{}') as { block_num?: unknown }
        if (event.block_num !== undefined) earliestBlock = Number(event.block_num)
      } catch { /* ignore */ }

      if (earliestBlock !== undefined && blockNum < earliestBlock) {
        throw new Error(
          `Block ${blockNum} is before earliest available block ${earliestBlock} (stream trimmed). Cannot reset to trimmed range.`,
        )
      }
    }

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
