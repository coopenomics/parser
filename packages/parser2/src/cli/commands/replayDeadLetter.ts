import type { RedisStore, StreamMessage } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

async function findByEventId(
  redis: RedisStore,
  stream: string,
  eventId: string,
): Promise<StreamMessage | null> {
  let cursor = '-'
  while (true) {
    const batch = await redis.xrange(stream, cursor, '+', 100)
    if (batch.length === 0) return null
    for (const msg of batch) {
      const dataStr = msg.fields['data']
      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr) as Record<string, unknown>
          if (parsed['event_id'] === eventId) return msg
        } catch { /* skip */ }
      }
    }
    const last = batch[batch.length - 1]
    if (!last || batch.length < 100) return null
    cursor = '(' + last.id
  }
}

async function replaySingle(
  redis: RedisStore,
  liveStream: string,
  deadStream: string,
  subId: string,
  msg: StreamMessage,
  dryRun: boolean,
): Promise<string | null> {
  const dataStr = msg.fields['data']
  if (!dataStr) return null

  let eventId = ''
  try {
    const parsed = JSON.parse(dataStr) as Record<string, unknown>
    eventId = typeof parsed['event_id'] === 'string' ? parsed['event_id'] : ''
  } catch { /* skip */ }

  if (dryRun) {
    console.log(`[dry-run] Would replay event ${eventId || msg.id} → live stream, delete from dead-letter.`)
    return null
  }

  const newId = await redis.xadd(liveStream, { data: dataStr })
  await redis.xdel(deadStream, msg.id)
  if (eventId) {
    await redis.hdel(RedisKeys.subFailuresHash(subId), eventId)
  }
  return newId
}

export async function replayDeadLetter(
  redis: RedisStore,
  chainId: string,
  subId: string,
  eventId: string | null,
  all: boolean,
  dryRun: boolean,
): Promise<void> {
  const liveStream = RedisKeys.eventsStream(chainId)
  const deadStream = RedisKeys.deadLetterStream(chainId, subId)

  if (all) {
    let cursor = '-'
    let replayed = 0
    while (true) {
      const batch = await redis.xrange(deadStream, cursor, '+', 100)
      if (batch.length === 0) break
      for (const msg of batch) {
        const newId = await replaySingle(redis, liveStream, deadStream, subId, msg, dryRun)
        if (newId !== null) replayed++
      }
      if (dryRun) {
        replayed = batch.length
        break
      }
      if (batch.length < 100) break
      // After deletion, stream changes — restart from beginning
      cursor = '-'
      if (replayed > 0) break // safety: don't loop forever; batches shrink as we delete
    }
    if (dryRun) {
      console.log(`[dry-run] Would replay ${replayed} events from dead-letter stream for ${subId}.`)
    } else {
      console.log(`Replayed ${replayed} events, removed ${replayed} from dead-letter.`)
    }
    return
  }

  if (!eventId) throw new Error('--event-id is required unless --all is specified')

  const msg = await findByEventId(redis, deadStream, eventId)
  if (!msg) {
    console.error(`Event not found in dead-letter stream for subscription ${subId}.`)
    process.exit(1)
  }

  const newId = await replaySingle(redis, liveStream, deadStream, subId, msg, dryRun)
  if (newId !== null) {
    console.log(`Replayed event ${eventId} → new entry id ${newId}. Removed from dead-letter.`)
  }
}
