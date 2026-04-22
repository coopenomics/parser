/**
 * Клиент-потребитель событий парсера.
 *
 * ParserClient — главная точка входа для прикладного кода, который хочет
 * получать события из блокчейна без прямого доступа к Redis или SHiP.
 *
 * Что делает:
 *   1. Регистрирует подписку (метаданные) в Redis Hash (parser:subs).
 *   2. Захватывает distributed lock (single-active-consumer) через SubscriptionLock.
 *   3. Читает события из Redis Stream через RedisConsumer (XREADGROUP).
 *   4. Применяет фильтры (matchFilters) — пропускает нерелевантные события.
 *   5. Доставляет событие через yield.
 *   6. После успешной обработки: XACK + clearFailure.
 *   7. При ошибке в обработчике: инкрементирует счётчик (FailureTracker).
 *      При достижении порога (3 ошибки) — переводит в dead-letter stream.
 *
 * Использование:
 *   const client = new ParserClient({ … })
 *   for await (const event of client.stream()) {
 *     await myHandler(event)
 *   }
 */

import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { IoRedisStore } from '../adapters/IoRedisStore.js'
import { RedisKeys } from '../redis/keys.js'
import { SubscriptionLock } from './SubscriptionLock.js'
import { RedisConsumer } from './RedisConsumer.js'
import { FailureTracker } from './FailureTracker.js'
import { matchFilters } from './filters.js'
import type { SubscriptionFilter } from './filters.js'
import type { SubscriptionLockOptions } from './SubscriptionLock.js'
import type { ParserEvent } from '../types.js'

export interface ParserClientOptions {
  /** Уникальный идентификатор подписки (имя consumer group в Redis Stream). */
  subscriptionId: string
  /** Список фильтров. Пустой = все события. */
  filters?: SubscriptionFilter[]
  /**
   * Стартовая позиция потребления:
   *   'last_known' — '$' (только новые события с момента регистрации)
   *   'head-minus-1000' — приблизительно с 1000 блоков назад
   *   number — с указанного block_num (приблизительное преобразование в stream ID)
   */
  startFrom?: 'last_known' | number | 'head-minus-1000'
  redis: { url: string; password?: string; keyPrefix?: string }
  chain: { id: string }
  /** Таймаут ожидания lock'а в мс (для тестов). */
  acquireLockTimeoutMs?: number
  /** Отключить SIGTERM/SIGINT обработчики (для тестов и встроенного использования). */
  noSignalHandlers?: boolean
}

export class ParserClient {
  private opts: ParserClientOptions
  private redis: IoRedisStore | null = null
  private lock: SubscriptionLock | null = null
  private consumer: RedisConsumer | null = null
  private failureTracker: FailureTracker | null = null
  /** Уникальный ID этого экземпляра — используется как значение distributed lock'а. */
  private instanceId: string
  private closed = false

  constructor(opts: ParserClientOptions) {
    this.opts = opts
    // instanceId = hostname:pid:uuid — уникален даже при нескольких process на одной машине
    this.instanceId = `${hostname()}:${process.pid}:${randomUUID()}`
  }

  /**
   * Основной AsyncGenerator: инициализирует подключение и начинает yield событий.
   *
   * Этапы старта:
   *   1. Подключаемся к Redis.
   *   2. Регистрируем подписку в HSET parser:subs.
   *   3. Пытаемся захватить lock; если занят — ждём освобождения.
   *   4. Определяем startId для consumer group.
   *   5. Создаём consumer group (XGROUP CREATE).
   *   6. Читаем события в цикле, фильтруем, yield'им.
   *
   * Генератор завершается при вызове close().
   */
  async *stream(): AsyncGenerator<ParserEvent> {
    this.redis = new IoRedisStore(this.opts.redis)
    await this.redis.connect()

    const subId = this.opts.subscriptionId
    const chainId = this.opts.chain.id
    const stream = RedisKeys.eventsStream(chainId)
    const groupName = subId

    this.failureTracker = new FailureTracker(this.redis, chainId)

    // Регистрация подписки: сохраняем метаданные в Redis Hash для CLI (list-subscriptions)
    await this.redis.hset(RedisKeys.subsHash(), {
      [subId]: JSON.stringify({
        subId,
        filters: this.opts.filters ?? [],
        startFrom: this.opts.startFrom ?? 'last_known',
        registeredAt: new Date().toISOString(),
      }),
    })

    // Distributed lock: только один экземпляр может быть active
    const lockOpts: SubscriptionLockOptions = {
      redis: this.redis,
      subId,
      instanceId: this.instanceId,
    }
    if (this.opts.acquireLockTimeoutMs !== undefined) {
      lockOpts.acquireLockTimeoutMs = this.opts.acquireLockTimeoutMs
    }
    this.lock = new SubscriptionLock(lockOpts)

    if (!this.opts.noSignalHandlers) {
      const close = () => void this.close()
      process.once('SIGTERM', close)
      process.once('SIGINT', close)
    }

    // Захватываем lock или ждём пока предыдущий holder умрёт
    const acquired = await this.lock.acquire()
    if (!acquired) {
      await this.lock.waitForPromotion()
    }

    // Определяем startId для consumer group
    const startFrom = this.opts.startFrom ?? 'last_known'
    let startId: string

    if (startFrom === 'last_known') {
      startId = '$' // только новые сообщения
    } else if (startFrom === 'head-minus-1000') {
      startId = '0' // упрощённо: с начала стрима
    } else {
      // Числовой block_num: конвертируем в приблизительный stream ID
      startId = `${startFrom}-0`
    }

    this.consumer = new RedisConsumer({
      redis: this.redis,
      stream,
      groupName,
      blockMs: 2_000,
    })
    await this.consumer.init(startId)

    for await (const msg of this.consumer.read()) {
      if (this.closed) break

      const rawData = msg.fields['data']
      if (!rawData) {
        // Сообщение без поля 'data' — некорректное, просто подтверждаем
        await this.consumer.ack(msg.id)
        continue
      }

      let event: ParserEvent
      try {
        event = JSON.parse(rawData) as ParserEvent
        // JSON не сохраняет BigInt: global_sequence сериализуется как string
        if (event.kind === 'action' && typeof event.global_sequence === 'string') {
          event = { ...event, global_sequence: BigInt(event.global_sequence as unknown as string) }
        }
      } catch {
        // Невалидный JSON — пропускаем
        await this.consumer.ack(msg.id)
        continue
      }

      // Применяем фильтры: если событие не нужно этой подписке — XACK и следующее
      if (!matchFilters(event, this.opts.filters)) {
        await this.consumer.ack(msg.id)
        continue
      }

      try {
        // Отдаём событие вызывающему коду
        yield event
        // Успешно обработано: подтверждаем и сбрасываем счётчик ошибок
        await this.consumer.ack(msg.id)
        await this.failureTracker.clearFailure(subId, event.event_id)
      } catch (err) {
        // Обработчик выбросил исключение: инкрементируем счётчик
        const count = await this.failureTracker.recordFailure(subId, event.event_id)
        if (this.failureTracker.shouldDeadLetter(count)) {
          // Порог достигнут: отправляем в dead-letter и подтверждаем
          await this.failureTracker.routeToDeadLetter(
            subId,
            event.event_id,
            msg.fields,
            err instanceof Error ? err.message : String(err),
          )
          await this.consumer.ack(msg.id)
          await this.failureTracker.clearFailure(subId, event.event_id)
        }
        // Иначе: оставляем в PEL — следующий recoverOwnPending повторит доставку
      }
    }
  }

  /**
   * Graceful shutdown: останавливает генератор, освобождает lock, закрывает Redis.
   */
  async close(): Promise<void> {
    this.closed = true
    this.consumer?.stop()
    if (this.lock) {
      this.lock.stopHeartbeat()
      await this.lock.release()
    }
    if (this.redis) {
      await this.redis.quit()
      this.redis = null
    }
  }

  /** Закрывает клиент и завершает процесс (для использования в SIGINT-обработчике). */
  closeAndExit(): void {
    void (async () => {
      await this.close()
      process.exit(0)
    })()
  }
}
