import type { RedisStore } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

interface SubMeta {
  subId: string
  filters: Array<Record<string, string>>
  startFrom: string
  registeredAt?: string
}

export interface SubStatus {
  subId: string
  filters: Array<Record<string, string>>
  startFrom: string
  registeredAt: string
  pending: number | null
  lag: number | null
  lastDeliveredId: string
}

function formatFilters(filters: Array<Record<string, string>>): string {
  if (!filters || filters.length === 0) return '*'
  return filters.slice(0, 2).map(f => {
    const kind = f['kind'] ?? '*'
    if (kind === 'action') return `action:${f['account'] ?? '*'}/${f['name'] ?? '*'}`
    if (kind === 'delta') return `delta:${f['code'] ?? '*'}`
    if (kind === 'native-delta') return `native-delta:${f['table'] ?? '*'}`
    return kind
  }).join(',')
}

export async function listSubscriptions(
  redis: RedisStore,
  chainId: string,
  json: boolean,
): Promise<void> {
  const allSubs = await redis.hgetAll(RedisKeys.subsHash())

  if (Object.keys(allSubs).length === 0) {
    console.log('No subscriptions registered.')
    return
  }

  const stream = RedisKeys.eventsStream(chainId)
  let groups: Awaited<ReturnType<typeof redis.xinfoGroups>> = []
  try {
    groups = await redis.xinfoGroups(stream)
  } catch {
    // stream may not exist yet — treat all subs as not started
  }

  const results: SubStatus[] = []

  for (const rawJson of Object.values(allSubs)) {
    let meta: SubMeta
    try {
      meta = JSON.parse(rawJson) as SubMeta
    } catch {
      continue
    }

    const group = groups.find(g => g.name === meta.subId)
    results.push({
      subId: meta.subId,
      filters: meta.filters,
      startFrom: String(meta.startFrom),
      registeredAt: meta.registeredAt ?? '',
      pending: group !== undefined ? group.pending : null,
      lag: group !== undefined ? group.lag : null,
      lastDeliveredId: group?.lastDeliveredId ?? 'not started',
    })
  }

  if (json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  const cols = {
    subId: 16,
    filters: 25,
    pending: 9,
    lag: 6,
    lastDelivered: 21,
    startFrom: 10,
  }
  const header =
    'SUB ID'.padEnd(cols.subId) +
    'FILTERS'.padEnd(cols.filters) +
    'PENDING'.padEnd(cols.pending) +
    'LAG'.padEnd(cols.lag) +
    'LAST DELIVERED'.padEnd(cols.lastDelivered) +
    'START FROM'
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const sub of results) {
    const row =
      sub.subId.slice(0, cols.subId - 1).padEnd(cols.subId) +
      formatFilters(sub.filters).slice(0, cols.filters - 1).padEnd(cols.filters) +
      String(sub.pending ?? '-').padEnd(cols.pending) +
      String(sub.lag ?? '-').padEnd(cols.lag) +
      sub.lastDeliveredId.slice(0, cols.lastDelivered - 1).padEnd(cols.lastDelivered) +
      sub.startFrom
    console.log(row)
  }
}
