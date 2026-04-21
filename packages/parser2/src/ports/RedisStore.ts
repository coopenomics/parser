/**
 * Порт хранилища Redis — абстракция над Redis-командами.
 *
 * Порт (интерфейс) изолирует бизнес-логику от конкретного Redis-клиента.
 * Единственная реализация — IoRedisStore (adapters/IoRedisStore.ts).
 * В тестах используются vi.fn()-моки, соответствующие этому интерфейсу.
 *
 * Именование методов следует camelCase-версии Redis-команд:
 *   XADD → xadd, ZRANGEBYSCORE → zrangeByScore и т.д.
 */

/** Одно сообщение Redis Stream, возвращаемое XRANGE / XREADGROUP. */
export interface StreamMessage {
  /** Redis Stream entry ID в формате <milliseconds>-<sequence>. */
  id: string
  /** Пары поле→значение записи. */
  fields: Record<string, string>
}

/** Информация о consumer group из XINFO GROUPS. */
export interface XGroupInfo {
  name: string
  /** Число сообщений в PEL (pending entries list) — доставлено, но не подтверждено. */
  pending: number
  /** ID последнего доставленного сообщения. */
  lastDeliveredId: string
  /** Отставание group от head стрима (null для Redis < 7.0). */
  lag: number | null
  /** Число зарегистрированных consumers в group. */
  consumers: number
}

export interface RedisStore {
  // ── Stream ────────────────────────────────────────────────────────────────

  /** XADD stream * field value … → возвращает присвоенный entry ID. */
  xadd(stream: string, fields: Record<string, string>): Promise<string>

  /** XTRIM stream MINID minId — удаляет записи с ID < minId. */
  xtrim(stream: string, minId: string): Promise<number>

  /**
   * XGROUP CREATE stream group startId MKSTREAM
   * Идемпотентен: BUSYGROUP ошибка поглощается — группа уже существует.
   */
  xgroupCreate(stream: string, group: string, startId: string): Promise<void>

  /** XGROUP SETID stream group id — перемещает позицию group. */
  xgroupSetId(stream: string, group: string, id: string): Promise<void>

  /** XINFO GROUPS stream → список consumer groups с метриками. */
  xinfoGroups(stream: string): Promise<XGroupInfo[]>

  /**
   * XREADGROUP GROUP group consumer COUNT count BLOCK blockMs STREAMS stream id
   * id='>' — читать новые; id='0' — читать PEL (pending, для recovery).
   */
  xreadGroup(
    stream: string,
    group: string,
    consumer: string,
    count: number,
    blockMs: number,
    id: string,
  ): Promise<StreamMessage[]>

  /** XRANGE stream start end COUNT count — диапазон по ID в прямом порядке. */
  xrange(stream: string, start: string, end: string, count: number): Promise<StreamMessage[]>

  /** XREVRANGE stream end start COUNT count — диапазон в обратном порядке. */
  xrevrange(stream: string, end: string, start: string, count: number): Promise<StreamMessage[]>

  /** XLEN stream — число записей в стриме. */
  xlen(stream: string): Promise<number>

  /** XDEL stream id — удаляет запись по ID. */
  xdel(stream: string, id: string): Promise<number>

  /** XACK stream group id — подтверждает обработку, убирает из PEL. */
  xack(stream: string, group: string, id: string): Promise<void>

  // ── Sorted Set ────────────────────────────────────────────────────────────

  /** ZADD key score member. */
  zadd(key: string, score: number, member: string): Promise<void>

  /**
   * ZREVRANGEBYSCORE key max min LIMIT 0 1
   * Используется для поиска «последней версии ABI на момент блока N»:
   * max=N, min='-inf', возвращает первый (наиболее свежий) элемент.
   */
  zrangeByscoreRev(key: string, max: string, min: string): Promise<string[]>

  /** ZRANGEBYSCORE key min max LIMIT 0 ∞. */
  zrangeByScore(key: string, min: string, max: string): Promise<string[]>

  /** ZCOUNT key min max. */
  zcount(key: string, min: string, max: string): Promise<number>

  /** ZREMRANGEBYSCORE key min max → число удалённых элементов. */
  zremRangeByScore(key: string, min: string, max: string): Promise<number>

  /** ZCARD key — мощность множества. */
  zcard(key: string): Promise<number>

  // ── Hash ──────────────────────────────────────────────────────────────────

  /** HSET key field1 value1 field2 value2 … */
  hset(key: string, fields: Record<string, string>): Promise<void>

  /** HGET key field → null если поле или ключ не существует. */
  hget(key: string, field: string): Promise<string | null>

  /** HGETALL key → пустой объект если ключ не существует. */
  hgetAll(key: string): Promise<Record<string, string>>

  /** HINCRBY key field increment → новое значение. */
  hincrby(key: string, field: string, increment: number): Promise<number>

  /** HDEL key field. */
  hdel(key: string, field: string): Promise<void>

  // ── Key / lock ────────────────────────────────────────────────────────────

  /**
   * SET key value NX PX pxMs — атомарный conditional set.
   * Возвращает true если ключ был успешно создан (не существовал).
   * Используется для захвата distributed lock'а.
   */
  setNx(key: string, value: string, pxMs: number): Promise<boolean>

  /**
   * Lua-скрипт: PEXPIRE key ms IF GET(key) == value.
   * Продлевает TTL lock'а только если мы — текущий владелец.
   * Атомарность необходима: между GET и PEXPIRE не должно быть race condition.
   */
  pexpire(key: string, ms: number, value: string): Promise<boolean>

  /**
   * Lua-скрипт: DEL key IF GET(key) == value.
   * Удаляет lock только если мы — его владелец.
   * Защищает от случайного сброса чужого lock'а (если наш TTL истёк).
   */
  luaDel(key: string, value: string): Promise<boolean>

  /** EXPIRE key seconds. */
  expire(key: string, seconds: number): Promise<void>

  /**
   * SCAN-итерация по паттерну: продолжает пока cursor != '0'.
   * Возвращает полный список ключей, соответствующих pattern.
   * @param count — подсказка Redis сколько ключей возвращать за итерацию (не гарантия).
   */
  scan(pattern: string, count?: number): Promise<string[]>

  /** Закрыть соединение с Redis. */
  quit(): Promise<void>
}
