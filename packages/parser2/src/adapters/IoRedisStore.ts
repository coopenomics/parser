/**
 * Адаптер Redis — реализует интерфейс RedisStore через ioredis.
 *
 * Ioredis не имеет поля "exports" в package.json, поэтому для NodeNext
 * resolution используется динамический import() с явным приведением типа.
 *
 * Два Lua-скрипта реализуют атомарные операции для distributed lock:
 *
 * PEXPIRE_LUA — условное продление TTL:
 *   «Продли TTL ключа key на ms миллисекунд, но только если его текущее
 *   значение равно value (т.е. мы — владельцы lock'а)».
 *   Атомарность важна: без неё возможен race condition между GET и PEXPIRE.
 *
 * DEL_LUA — условное удаление:
 *   «Удали ключ key, но только если его текущее значение равно value».
 *   Защищает от случайного удаления lock'а другого процесса, если наш TTL истёк.
 */

import type { RedisOptions } from 'ioredis'
import type { RedisStore, StreamMessage, XGroupInfo } from '../ports/RedisStore.js'

// Ioredis не имеет "exports" поля — используем динамический import с приведением типа
type RedisConstructor = new (url: string, opts?: RedisOptions) => IRedisClient

/**
 * Минимальный интерфейс ioredis-клиента с только нужными командами.
 * Сигнатуры точно соответствуют тому что возвращает ioredis — без обёрток.
 */
interface IRedisClient {
  connect(): Promise<void>
  xadd(stream: string, id: string, ...args: string[]): Promise<string | null>
  xtrim(stream: string, strategy: string, threshold: string): Promise<number>
  xgroup(action: string, stream: string, group: string, id: string, mkstream?: string): Promise<unknown>
  xinfo(subcommand: string, key: string): Promise<unknown>
  xreadgroup(
    group: string, groupName: string, consumer: string, consumerName: string,
    count: string, countVal: number,
    block: string, blockMs: number,
    streams: string, stream: string, id: string,
  ): Promise<Array<[string, Array<[string, string[]]>]> | null>
  xrange(key: string, start: string, end: string, count: string, countVal: number): Promise<Array<[string, string[]]>>
  xrevrange(key: string, end: string, start: string, count: string, countVal: number): Promise<Array<[string, string[]]>>
  xlen(key: string): Promise<number>
  xdel(key: string, ...ids: string[]): Promise<number>
  xack(stream: string, group: string, id: string): Promise<number>
  zadd(key: string, score: number, member: string): Promise<number>
  zrangebyscore(key: string, min: string, max: string, limit: string, offset: number, count: number): Promise<string[]>
  zrevrangebyscore(key: string, max: string, min: string, limit: string, offset: number, count: number): Promise<string[]>
  zcount(key: string, min: string, max: string): Promise<number>
  zremrangebyscore(key: string, min: string, max: string): Promise<number>
  zcard(key: string): Promise<number>
  hset(key: string, ...args: string[]): Promise<number>
  hget(key: string, field: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string> | null>
  hincrby(key: string, field: string, increment: number): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  set(key: string, value: string, nx: string, px: string, ms: number): Promise<string | null>
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>
  expire(key: string, seconds: number): Promise<number>
  scan(cursor: string, match: string, pattern: string, count: string, countVal: number): Promise<[string, string[]]>
  quit(): Promise<string>
}

const { default: RedisClass } = await import('ioredis') as unknown as { default: RedisConstructor }

/**
 * Атомарно продлевает PEXPIRE только если мы — владелец lock'а.
 * ARGV[1] = ms (новый TTL), ARGV[2] = expectedValue.
 */
const PEXPIRE_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[2] then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  return 1
end
return 0
`

/**
 * Атомарно удаляет ключ только если мы — владелец lock'а.
 * ARGV[1] = expectedValue.
 */
const DEL_LUA = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`

/**
 * Конвертирует сырой ответ XRANGE/XREADGROUP в массив StreamMessage.
 * Redis возвращает: [[id, [field1, val1, field2, val2, ...]], ...]
 * Мы конвертируем в: [{id, fields: {field1: val1, ...}}, ...]
 */
function parseStreamEntries(raw: Array<[string, string[]]>): StreamMessage[] {
  const messages: StreamMessage[] = []
  for (const [msgId, rawFields] of raw) {
    const fields: Record<string, string> = {}
    // rawFields — плоский массив [key, val, key, val, ...], шагаем по 2
    for (let i = 0; i + 1 < rawFields.length; i += 2) {
      fields[rawFields[i] ?? ''] = rawFields[i + 1] ?? ''
    }
    messages.push({ id: msgId, fields })
  }
  return messages
}

/**
 * Конвертирует ответ XINFO GROUPS в XGroupInfo.
 * Redis < 7.0 возвращает плоский массив [key, val, key, val, ...].
 * Redis >= 7.0 может возвращать объект — обрабатываем оба случая.
 */
function parseXGroupInfo(raw: unknown): XGroupInfo {
  let obj: Record<string, unknown>
  if (Array.isArray(raw)) {
    // Старый формат: плоский массив ключ-значение
    obj = {}
    for (let i = 0; i + 1 < raw.length; i += 2) {
      obj[raw[i] as string] = raw[i + 1]
    }
  } else {
    obj = raw as Record<string, unknown>
  }
  return {
    name: String(obj['name'] ?? ''),
    pending: Number(obj['pending'] ?? 0),
    // Поле 'last-delivered-id' в Redis (с дефисами), не 'lastDeliveredId'
    lastDeliveredId: String(obj['last-delivered-id'] ?? '0-0'),
    // lag появилось в Redis 7.0; null для старых версий
    lag: obj['lag'] != null ? Number(obj['lag']) : null,
    consumers: Number(obj['consumers'] ?? 0),
  }
}

export class IoRedisStore implements RedisStore {
  /** Прямой доступ к ioredis-клиенту (для тестов и расширения). */
  readonly client: IRedisClient

  constructor(opts: { url: string; password?: string; keyPrefix?: string }) {
    const redisOpts: RedisOptions = {
      lazyConnect: true,       // не подключаться в конструкторе — явный connect()
      enableReadyCheck: true,  // проверять готовность перед командами
    }
    if (opts.password !== undefined) redisOpts.password = opts.password
    if (opts.keyPrefix !== undefined) redisOpts.keyPrefix = opts.keyPrefix

    this.client = new RedisClass(opts.url, redisOpts)
  }

  /** Явное подключение — вызывается один раз при старте Parser/ParserClient. */
  async connect(): Promise<void> {
    await this.client.connect()
  }

  /** XADD stream * field1 val1 … — возвращает присвоенный entry ID. */
  async xadd(stream: string, fields: Record<string, string>): Promise<string> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) args.push(k, v)
    const id = await this.client.xadd(stream, '*', ...args)
    return id ?? ''
  }

  /** XTRIM stream MINID minId — удаляет записи с ID < minId. */
  async xtrim(stream: string, minId: string): Promise<number> {
    return this.client.xtrim(stream, 'MINID', minId)
  }

  /**
   * XGROUP CREATE stream group startId MKSTREAM
   * MKSTREAM: создаёт стрим если не существует.
   * BUSYGROUP: группа уже существует — это нормально, поглощаем ошибку.
   */
  async xgroupCreate(stream: string, group: string, startId: string): Promise<void> {
    try {
      await this.client.xgroup('CREATE', stream, group, startId, 'MKSTREAM')
    } catch (err) {
      if (err instanceof Error && err.message.includes('BUSYGROUP')) return
      throw err
    }
  }

  /** XGROUP SETID stream group id — переставляет позицию group в стриме. */
  async xgroupSetId(stream: string, group: string, id: string): Promise<void> {
    await this.client.xgroup('SETID', stream, group, id)
  }

  /** XINFO GROUPS stream → список consumer groups с метриками. */
  async xinfoGroups(stream: string): Promise<XGroupInfo[]> {
    const raw = await this.client.xinfo('GROUPS', stream) as unknown[]
    return (raw ?? []).map(parseXGroupInfo)
  }

  /**
   * XREADGROUP GROUP group consumer COUNT count BLOCK blockMs STREAMS stream id
   * id='>' — только новые сообщения.
   * id='0' — PEL (pending): уже доставленные, но не подтверждённые (recovery).
   */
  async xreadGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
    id: string,
  ): Promise<StreamMessage[]> {
    const result = await this.client.xreadgroup(
      'GROUP', group, consumer, consumer,
      'COUNT', count,
      'BLOCK', blockMs,
      'STREAMS', stream, id,
    )
    if (!result) return []
    const messages: StreamMessage[] = []
    for (const [, entries] of result) {
      messages.push(...parseStreamEntries(entries))
    }
    return messages
  }

  /** XRANGE stream start end COUNT count. */
  async xrange(stream: string, start: string, end: string, count: number): Promise<StreamMessage[]> {
    const raw = await this.client.xrange(stream, start, end, 'COUNT', count)
    return parseStreamEntries(raw)
  }

  /** XREVRANGE stream end start COUNT count. */
  async xrevrange(stream: string, end: string, start: string, count: number): Promise<StreamMessage[]> {
    const raw = await this.client.xrevrange(stream, end, start, 'COUNT', count)
    return parseStreamEntries(raw)
  }

  /** XLEN stream. */
  async xlen(stream: string): Promise<number> {
    return this.client.xlen(stream)
  }

  /** XDEL stream id — удаляет запись по ID. */
  async xdel(stream: string, id: string): Promise<number> {
    return this.client.xdel(stream, id)
  }

  /** XACK stream group id — убирает из PEL. */
  async xack(stream: string, group: string, id: string): Promise<void> {
    await this.client.xack(stream, group, id)
  }

  /** ZADD key score member. */
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member)
  }

  /**
   * ZREVRANGEBYSCORE key max min LIMIT 0 1
   * Возвращает максимум один элемент с score ≤ max.
   * Используется для поиска ABI: «последняя версия не позже блока N».
   */
  async zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]> {
    return this.client.zrevrangebyscore(key, max, min, 'LIMIT', 0, 1)
  }

  /** ZRANGEBYSCORE key min max LIMIT 0 9999999 — все элементы в диапазоне. */
  async zrangeByScore(key: string, min: string, max: string): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max, 'LIMIT', 0, 9_999_999)
  }

  /** ZCOUNT key min max. */
  async zcount(key: string, min: string, max: string): Promise<number> {
    return this.client.zcount(key, min, max)
  }

  /** ZREMRANGEBYSCORE key min max → число удалённых. */
  async zremRangeByScore(key: string, min: string, max: string): Promise<number> {
    return this.client.zremrangebyscore(key, min, max)
  }

  /** ZCARD key. */
  async zcard(key: string): Promise<number> {
    return this.client.zcard(key)
  }

  /** HSET key field1 val1 field2 val2 … */
  async hset(key: string, fields: Record<string, string>): Promise<void> {
    const args: string[] = []
    for (const [k, v] of Object.entries(fields)) args.push(k, v)
    if (args.length > 0) await this.client.hset(key, ...args)
  }

  /** HGET key field. */
  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  /** HGETALL key → пустой объект если ключ не существует (ioredis возвращает null). */
  async hgetAll(key: string): Promise<Record<string, string>> {
    const result = await this.client.hgetall(key)
    return result ?? {}
  }

  /** HINCRBY key field increment → новое значение счётчика. */
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.client.hincrby(key, field, increment)
  }

  /** HDEL key field. */
  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field)
  }

  /**
   * SET key value NX PX pxMs
   * NX: только если не существует. PX: TTL в миллисекундах.
   * Используется для захвата distributed lock'а.
   */
  async setNx(key: string, value: string, pxMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, 'NX', 'PX', pxMs)
    return result === 'OK'
  }

  /**
   * Выполняет PEXPIRE_LUA: продлевает TTL lock'а только если мы — владелец.
   * Возвращает true если продление прошло успешно.
   */
  async pexpire(key: string, ms: number, value: string): Promise<boolean> {
    const result = await this.client.eval(PEXPIRE_LUA, 1, key, String(ms), value) as number
    return result === 1
  }

  /**
   * Выполняет DEL_LUA: удаляет lock только если мы — владелец.
   * Возвращает true если удаление прошло успешно.
   */
  async luaDel(key: string, value: string): Promise<boolean> {
    const result = await this.client.eval(DEL_LUA, 1, key, value) as number
    return result === 1
  }

  /** EXPIRE key seconds. */
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds)
  }

  /**
   * Полный SCAN по паттерну: итерирует cursor пока не вернётся '0'.
   * @param count — подсказка Redis сколько ключей возвращать за итерацию.
   * @returns Полный список ключей (может быть большим для широких паттернов).
   */
  async scan(pattern: string, count = 100): Promise<string[]> {
    const keys: string[] = []
    let cursor = '0'
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', count)
      keys.push(...batch)
      cursor = nextCursor
    } while (cursor !== '0')
    return keys
  }

  /** Закрывает соединение с Redis. */
  async quit(): Promise<void> {
    await this.client.quit()
  }
}
