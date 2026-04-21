/**
 * CLI-команда: parser list-subscriptions
 *
 * Показывает зарегистрированные подписки и их текущее состояние в consumer group.
 *
 * Источник данных — два ключа Redis:
 *   1. parser2:subs — HASH: subId → JSON с метаданными подписки (filters, startFrom, registeredAt).
 *      Записывается при вызове ParserClient.subscribe(), сохраняется между перезапусками.
 *
 *   2. ce:parser2:<chainId>:events — Redis Stream с consumer groups.
 *      XINFO GROUPS даёт для каждой группы: pending count, lag, last-delivered-id.
 *      Если стрим ещё не создан (парсер не запускался) — xinfoGroups выбросит ошибку;
 *      мы перехватываем её и показываем все подписки как «not started».
 *
 * Соединение двух источников: по subId.
 * HASH — регистрационные данные, XINFO — runtime-статистика.
 * Подписка может быть в HASH но не иметь consumer group (зарегистрирована, но не запущена).
 *
 * Колонка LAG: число сообщений в стриме после last-delivered-id этой группы.
 * Растущий LAG означает что consumer отстаёт или не работает.
 *
 * Режим --json: выводит полный JSON-массив SubStatus объектов — удобен для мониторинга и автоматизации.
 */

import type { RedisStore } from '../../ports/RedisStore.js'
import { RedisKeys } from '../../redis/keys.js'

/**
 * Метаданные подписки, хранимые в Redis HASH parser2:subs.
 * Сохраняются при registerSubscription() и используются для восстановления после рестарта.
 */
interface SubMeta {
  subId: string
  /** Массив фильтров (action/delta/native-delta); пустой массив = принять всё. */
  filters: Array<Record<string, string>>
  /** Начальный блок: число или 'latest'. Используется при первом запуске consumer group. */
  startFrom: string
  /** ISO-8601 время первой регистрации — для информационных целей. */
  registeredAt?: string
}

/**
 * Полная информация о подписке для вывода пользователю.
 * Объединяет данные из Redis HASH и XINFO GROUPS.
 */
export interface SubStatus {
  subId: string
  filters: Array<Record<string, string>>
  startFrom: string
  registeredAt: string
  /** Количество pending (непросмотренных) сообщений в PEL. null если группа не создана. */
  pending: number | null
  /** Отставание группы от конца стрима (сообщений). null если группа не создана. */
  lag: number | null
  /** ID последнего доставленного сообщения, или 'not started'. */
  lastDeliveredId: string
}

/**
 * Форматирует массив фильтров в компактную читаемую строку для таблицы.
 * Показывает максимум 2 первых фильтра, остальное обрезается.
 *
 * Примеры вывода:
 *   action:eosio/setabi      — конкретный экшн
 *   delta:eosio.token        — дельта таблицы по контракту
 *   native-delta:accounts    — нативная дельта по имени таблицы
 *   *                        — пустой массив (принять всё)
 */
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

/**
 * Основная функция команды list-subscriptions.
 *
 * Алгоритм:
 *   1. HGETALL parser2:subs → все зарегистрированные подписки.
 *   2. XINFO GROUPS <stream> → runtime-статистика consumer groups (может упасть если стрим не создан).
 *   3. JOIN по subId: дополняем каждую подписку данными из consumer group.
 *   4. Вывод: JSON-массив или ASCII-таблица с выравниванием.
 *
 * @param redis — Redis-клиент.
 * @param chainId — идентификатор цепи (для построения имени стрима).
 * @param json — вывод в JSON вместо таблицы.
 */
export async function listSubscriptions(
  redis: RedisStore,
  chainId: string,
  json: boolean,
): Promise<void> {
  // Читаем все зарегистрированные подписки из Redis HASH
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
    // Стрим не существует — парсер ещё ни разу не запускался.
    // Показываем подписки как зарегистрированные, но без runtime-статистики.
  }

  const results: SubStatus[] = []

  for (const rawJson of Object.values(allSubs)) {
    let meta: SubMeta
    try {
      meta = JSON.parse(rawJson) as SubMeta
    } catch {
      continue // пропускаем повреждённые записи
    }

    // Ищем соответствующую consumer group по имени (subId = groupName)
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

  // Ширина колонок ASCII-таблицы
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
