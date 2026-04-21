/**
 * Низкоуровневый Redis Stream consumer (XREADGROUP).
 *
 * Реализует two-phase чтение:
 *   Фаза 1 — Recovery: при старте сначала читаем PEL (pending entries list)
 *     с id='0'. Это сообщения, которые были доставлены в предыдущей сессии
 *     но не подтверждены (XACK). Перечитываем их чтобы не потерять.
 *
 *   Фаза 2 — Normal read: читаем новые сообщения с id='>'.
 *     BLOCK blockMs: если новых нет — ждём (не-busyloop).
 *
 * Все consumer'ы в одной group читают один и тот же поток, но каждое сообщение
 * доставляется ровно одному consumer'у (группа обеспечивает fan-out).
 *
 * Имя consumer'а фиксировано ('primary') — мы не используем конкурентное чтение
 * внутри одной группы (это решается через single-active-consumer lock).
 */

import type { RedisStore, StreamMessage } from '../ports/RedisStore.js'

/** Фиксированное имя consumer'а внутри group. */
export const CONSUMER_NAME = 'primary'

export interface RedisConsumerOptions {
  redis: RedisStore
  stream: string
  groupName: string
  /** Время блокировки XREADGROUP в мс. 2000 = ждём 2 с перед следующей попыткой. */
  blockMs?: number
  /** Максимум сообщений за один XREADGROUP вызов. */
  count?: number
}

export class RedisConsumer {
  private redis: RedisStore
  private stream: string
  private groupName: string
  private blockMs: number
  private count: number
  private stopped = false

  constructor(opts: RedisConsumerOptions) {
    this.redis = opts.redis
    this.stream = opts.stream
    this.groupName = opts.groupName
    this.blockMs = opts.blockMs ?? 2_000
    this.count = opts.count ?? 10
  }

  /**
   * XGROUP CREATE stream groupName startId MKSTREAM
   * Создаёт group (или игнорирует если уже существует — BUSYGROUP).
   * startId='$' — читать только новые; startId='0' — с самого начала.
   */
  async init(startId = '$'): Promise<void> {
    await this.redis.xgroupCreate(this.stream, this.groupName, startId)
  }

  /**
   * XGROUP SETID — переставляет позицию group (для reset-subscription).
   * Примечание: здесь используется xgroupCreate что идемпотентно;
   * для точного SETID нужен xgroupSetId из RedisStore.
   */
  async setStartId(id: string): Promise<void> {
    await this.redis.xgroupCreate(this.stream, this.groupName, id)
  }

  /**
   * Читает PEL (pending entries) с id='0': сообщения, доставленные но не подтверждённые.
   * Вызывается при старте для recovery после крэша.
   */
  async recoverOwnPending(): Promise<StreamMessage[]> {
    return this.redis.xreadGroup(
      this.stream,
      this.groupName,
      CONSUMER_NAME,
      100,
      0,   // blockMs=0: не блокировать при чтении PEL
      '0', // id='0': PEL
    )
  }

  /**
   * Асинхронный генератор сообщений.
   *
   * Порядок:
   * 1. Сначала отдаём все pending (незавершённые из предыдущей сессии).
   * 2. Затем в бесконечном цикле читаем новые (BLOCK 2000 мс).
   *
   * Цикл прерывается при вызове stop().
   * Каждое сообщение нужно подтвердить через ack(msg.id).
   */
  async* read(): AsyncGenerator<StreamMessage> {
    // Фаза 1: recovery — перечитываем незавершённые из прошлой сессии
    const pending = await this.recoverOwnPending()
    for (const msg of pending) {
      yield msg
    }

    // Фаза 2: нормальное чтение новых сообщений
    while (!this.stopped) {
      const messages = await this.redis.xreadGroup(
        this.stream,
        this.groupName,
        CONSUMER_NAME,
        this.count,
        this.blockMs,
        '>', // id='>': только непрочитанные новые
      )
      for (const msg of messages) {
        if (this.stopped) return
        yield msg
      }
    }
  }

  /** XACK stream groupName id — подтверждает что сообщение обработано. */
  async ack(id: string): Promise<void> {
    await this.redis.xack(this.stream, this.groupName, id)
  }

  /** Сигнализирует генератору прекратить чтение (graceful stop). */
  stop(): void {
    this.stopped = true
  }
}
