import type { RedisStore } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

interface DeadLetterEntry {
  entryId: string
  eventId: string
  kind: string
  failureCount: number
  lastError: string
  deadLetteredAt: string
  originalPayload: unknown
}

function entryIdToTimestamp(entryId: string): string {
  const ms = parseInt(entryId.split('-')[0] ?? '0', 10)
  return new Date(ms).toISOString()
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

async function readDeadLetters(
  redis: RedisStore,
  stream: string,
  limit: number,
  fromEntry: string,
): Promise<DeadLetterEntry[]> {
  const raw = await redis.xrange(stream, fromEntry, '+', limit)
  return raw.map(msg => {
    let eventId = ''
    let kind = ''
    let originalPayload: unknown = null
    const dataStr = msg.fields['data']
    if (dataStr) {
      try {
        const parsed = JSON.parse(dataStr) as Record<string, unknown>
        eventId = typeof parsed['event_id'] === 'string' ? parsed['event_id'] : ''
        kind = typeof parsed['kind'] === 'string' ? parsed['kind'] : ''
        originalPayload = parsed
      } catch { /* ignore */ }
    }
    return {
      entryId: msg.id,
      eventId,
      kind,
      failureCount: parseInt(msg.fields['failureCount'] ?? '0', 10),
      lastError: msg.fields['lastError'] ?? '',
      deadLetteredAt: entryIdToTimestamp(msg.id),
      originalPayload,
    }
  })
}

export async function listDeadLetters(
  redis: RedisStore,
  chainId: string,
  subId: string | null,
  json: boolean,
  limit: number,
  fromEntry: string,
  all: boolean,
): Promise<void> {
  let streams: Array<{ key: string; subId: string }> = []

  if (all) {
    const pattern = RedisKeys.deadLetterStream(chainId, '*')
    const keys = await redis.scan(pattern)
    const prefix = `ce:parser2:${chainId}:dead:`
    streams = keys.map(k => ({ key: k, subId: k.slice(prefix.length) }))
    if (streams.length === 0) {
      console.log('No dead-letter streams found.')
      return
    }
  } else {
    if (!subId) throw new Error('--sub-id is required unless --all is specified')
    streams = [{ key: RedisKeys.deadLetterStream(chainId, subId), subId }]
  }

  if (json) {
    const allEntries: Array<DeadLetterEntry & { subId: string }> = []
    for (const { key, subId: sid } of streams) {
      const entries = await readDeadLetters(redis, key, limit, fromEntry)
      allEntries.push(...entries.map(e => ({ ...e, subId: sid })))
    }
    console.log(JSON.stringify(allEntries, null, 2))
    return
  }

  for (const { key, subId: sid } of streams) {
    const total = await redis.xlen(key)
    console.log(`Dead letters for ${sid}: ${total} total`)
    if (total === 0) {
      console.log(`No dead letters for subscription ${sid}.`)
      continue
    }

    const entries = await readDeadLetters(redis, key, limit, fromEntry)
    if (entries.length === 0) {
      console.log(`No dead letters for subscription ${sid}.`)
      continue
    }

    const cols = {
      entryId: 22,
      eventId: 50,
      kind: 14,
      failCount: 6,
      lastError: 40,
    }
    if (all) {
      const subCol = 12
      console.log(
        'SUB ID'.padEnd(subCol) +
        'ENTRY ID'.padEnd(cols.entryId) +
        'EVENT ID'.padEnd(cols.eventId) +
        'KIND'.padEnd(cols.kind) +
        'FAIL#'.padEnd(cols.failCount) +
        'LAST ERROR',
      )
      for (const e of entries) {
        console.log(
          truncate(sid, subCol).padEnd(subCol) +
          truncate(e.entryId, cols.entryId).padEnd(cols.entryId) +
          truncate(e.eventId, cols.eventId).padEnd(cols.eventId) +
          truncate(e.kind, cols.kind).padEnd(cols.kind) +
          String(e.failureCount).padEnd(cols.failCount) +
          truncate(e.lastError, cols.lastError),
        )
      }
    } else {
      console.log(
        'ENTRY ID'.padEnd(cols.entryId) +
        'EVENT ID'.padEnd(cols.eventId) +
        'KIND'.padEnd(cols.kind) +
        'FAIL#'.padEnd(cols.failCount) +
        'LAST ERROR',
      )
      for (const e of entries) {
        console.log(
          truncate(e.entryId, cols.entryId).padEnd(cols.entryId) +
          truncate(e.eventId, cols.eventId).padEnd(cols.eventId) +
          truncate(e.kind, cols.kind).padEnd(cols.kind) +
          String(e.failureCount).padEnd(cols.failCount) +
          truncate(e.lastError, cols.lastError),
        )
      }
    }
  }
}
