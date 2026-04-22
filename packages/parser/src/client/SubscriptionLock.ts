/**
 * Distributed lock для single-active-consumer паттерна.
 *
 * Проблема: несколько экземпляров одного consumer-а запущены одновременно
 * (горизонтальное масштабирование, rolling deploy). Обрабатывать события
 * должен ровно один (active), остальные — в режиме ожидания (standby).
 *
 * Механизм:
 *   - Lock реализован как Redis String с TTL 10 секунд.
 *   - Значение = instanceId (hostname:pid:uuid) — уникально для каждого процесса.
 *   - Active-экземпляр продлевает TTL каждые 3 секунды через heartbeat.
 *   - Standby-экземпляры опрашивают каждые 500 мс попытку захватить lock.
 *   - Если active-экземпляр упал — его TTL истекает за ≤10 с, standby захватывает lock.
 *
 * Атомарные операции:
 *   - setNx: атомарный SET NX PX — захватывает lock.
 *   - pexpire (LUA): продлевает TTL только если мы — владелец (не перезаписывает чужой).
 *   - luaDel (LUA): удаляет lock только если мы — владелец.
 */

import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

export type LockState = 'acquiring' | 'active' | 'standby' | 'released'

export interface SubscriptionLockOptions {
  redis: RedisStore
  /** Идентификатор подписки — определяет имя Redis-ключа. */
  subId: string
  /** Уникальный ID этого экземпляра (hostname:pid:uuid). */
  instanceId: string
  /** Интервал heartbeat в мс. По умолчанию 3000. */
  heartbeatIntervalMs?: number
  /** Таймаут ожидания lock'а в мс. По умолчанию Infinity. */
  acquireLockTimeoutMs?: number
}

/** TTL lock'а: если heartbeat прекратится — lock освободится через 10 с. */
const LOCK_TTL_MS = 10_000
/** Heartbeat раз в 3 с (меньше TTL / 3 — чтобы не терять lock при задержках). */
const HEARTBEAT_MS = 3_000
/** Standby-экземпляры опрашивают каждые 500 мс. */
const STANDBY_POLL_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export class SubscriptionLock {
  private redis: RedisStore
  private key: string
  readonly instanceId: string
  private heartbeatMs: number
  private acquireTimeoutMs: number
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private _state: LockState = 'acquiring'

  constructor(opts: SubscriptionLockOptions) {
    this.redis = opts.redis
    this.key = RedisKeys.subLock(opts.subId)
    this.instanceId = opts.instanceId
    this.heartbeatMs = opts.heartbeatIntervalMs ?? HEARTBEAT_MS
    this.acquireTimeoutMs = opts.acquireLockTimeoutMs ?? Infinity
  }

  /** Текущее состояние: acquiring → active/standby → released. */
  get state(): LockState {
    return this._state
  }

  /**
   * Пробует захватить lock одним атомарным SET NX PX.
   * @returns true если захватили (state = active), false если занят (state = standby).
   */
  async acquire(): Promise<boolean> {
    const acquired = await this.redis.setNx(this.key, this.instanceId, LOCK_TTL_MS)
    if (acquired) {
      this._state = 'active'
      this.startHeartbeat()
    } else {
      this._state = 'standby'
    }
    return acquired
  }

  /**
   * Блокирует текущий процесс до тех пор пока lock не освободится и мы его захватим.
   * Опрашивает Redis каждые STANDBY_POLL_MS мс.
   * @throws Error если acquireLockTimeoutMs истёк.
   */
  async waitForPromotion(): Promise<void> {
    const deadline =
      this.acquireTimeoutMs === Infinity ? Infinity : Date.now() + this.acquireTimeoutMs

    while (true) {
      if (Date.now() > deadline) {
        throw new Error(`Lock acquire timeout after ${this.acquireTimeoutMs}ms`)
      }
      await sleep(STANDBY_POLL_MS)
      const acquired = await this.redis.setNx(this.key, this.instanceId, LOCK_TTL_MS)
      if (acquired) {
        this._state = 'active'
        this.startHeartbeat()
        return
      }
    }
  }

  /** Запускает периодическое продление TTL (heartbeat). */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.renewHeartbeat()
    }, this.heartbeatMs)
    // unref: heartbeat не мешает завершению процесса
    this.heartbeatTimer.unref?.()
  }

  /**
   * Один шаг heartbeat: продлеваем TTL через LUA-скрипт.
   * Если LUA вернул false — кто-то другой захватил lock (race condition после
   * истечения нашего TTL). Переходим в standby.
   */
  private async renewHeartbeat(): Promise<void> {
    const renewed = await this.redis.pexpire(this.key, LOCK_TTL_MS, this.instanceId)
    if (!renewed && this._state === 'active') {
      this.stopHeartbeat()
      this._state = 'standby'
    }
  }

  /** Останавливает heartbeat-таймер (без освобождения lock'а). */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * Освобождает lock: останавливает heartbeat, удаляет ключ через LUA (conditional).
   * После вызова state = 'released'.
   */
  async release(): Promise<void> {
    this.stopHeartbeat()
    await this.redis.luaDel(this.key, this.instanceId)
    this._state = 'released'
  }
}
