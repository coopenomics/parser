import type { RedisStore } from '../ports/RedisStore.js'
import { RedisKeys } from '../redis/keys.js'

export type LockState = 'acquiring' | 'active' | 'standby' | 'released'

export interface SubscriptionLockOptions {
  redis: RedisStore
  subId: string
  instanceId: string
  heartbeatIntervalMs?: number
  acquireLockTimeoutMs?: number
}

const LOCK_TTL_MS = 10_000
const HEARTBEAT_MS = 3_000
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

  get state(): LockState {
    return this._state
  }

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

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.renewHeartbeat()
    }, this.heartbeatMs)
    this.heartbeatTimer.unref?.()
  }

  private async renewHeartbeat(): Promise<void> {
    const renewed = await this.redis.pexpire(this.key, LOCK_TTL_MS, this.instanceId)
    if (!renewed && this._state === 'active') {
      this.stopHeartbeat()
      this._state = 'standby'
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  async release(): Promise<void> {
    this.stopHeartbeat()
    await this.redis.luaDel(this.key, this.instanceId)
    this._state = 'released'
  }
}
