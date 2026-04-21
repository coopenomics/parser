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
  subscriptionId: string
  filters?: SubscriptionFilter[]
  startFrom?: 'last_known' | number | 'head-minus-1000'
  redis: { url: string; password?: string; keyPrefix?: string }
  chain: { id: string }
  acquireLockTimeoutMs?: number
  noSignalHandlers?: boolean
}

export class ParserClient {
  private opts: ParserClientOptions
  private redis: IoRedisStore | null = null
  private lock: SubscriptionLock | null = null
  private consumer: RedisConsumer | null = null
  private failureTracker: FailureTracker | null = null
  private instanceId: string
  private closed = false

  constructor(opts: ParserClientOptions) {
    this.opts = opts
    this.instanceId = `${hostname()}:${process.pid}:${randomUUID()}`
  }

  async *stream(): AsyncGenerator<ParserEvent> {
    this.redis = new IoRedisStore(this.opts.redis)
    await this.redis.connect()

    const subId = this.opts.subscriptionId
    const chainId = this.opts.chain.id
    const stream = RedisKeys.eventsStream(chainId)
    const groupName = subId

    this.failureTracker = new FailureTracker(this.redis, chainId)

    // Register subscription metadata
    await this.redis.hset(RedisKeys.subsHash(), {
      [subId]: JSON.stringify({
        subId,
        filters: this.opts.filters ?? [],
        startFrom: this.opts.startFrom ?? 'last_known',
        registeredAt: new Date().toISOString(),
      }),
    })

    // Acquire lock (single-active-consumer)
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

    const acquired = await this.lock.acquire()
    if (!acquired) {
      await this.lock.waitForPromotion()
    }

    // Determine consumer group start position
    const startFrom = this.opts.startFrom ?? 'last_known'
    let startId: string

    if (startFrom === 'last_known') {
      startId = '$'
    } else if (startFrom === 'head-minus-1000') {
      startId = '0' // simplified: start from beginning if no known position
    } else {
      // numeric block num — convert to approximate stream id
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
        await this.consumer.ack(msg.id)
        continue
      }

      let event: ParserEvent
      try {
        event = JSON.parse(rawData) as ParserEvent
        // Re-parse bigint fields that JSON doesn't preserve
        if (event.kind === 'action' && typeof event.global_sequence === 'string') {
          event = { ...event, global_sequence: BigInt(event.global_sequence as unknown as string) }
        }
      } catch {
        await this.consumer.ack(msg.id)
        continue
      }

      if (!matchFilters(event, this.opts.filters)) {
        await this.consumer.ack(msg.id)
        continue
      }

      try {
        yield event
        await this.consumer.ack(msg.id)
        await this.failureTracker.clearFailure(subId, event.event_id)
      } catch (err) {
        const count = await this.failureTracker.recordFailure(subId, event.event_id)
        if (this.failureTracker.shouldDeadLetter(count)) {
          await this.failureTracker.routeToDeadLetter(
            subId,
            event.event_id,
            msg.fields,
            err instanceof Error ? err.message : String(err),
          )
          await this.consumer.ack(msg.id)
          await this.failureTracker.clearFailure(subId, event.event_id)
        }
        // else: leave in PEL for retry via recoverOwnPending
      }
    }
  }

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

  closeAndExit(): void {
    void (async () => {
      await this.close()
      process.exit(0)
    })()
  }
}
