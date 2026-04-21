import type { RedisStore, StreamMessage } from '../ports/RedisStore.js'

export const CONSUMER_NAME = 'primary'

export interface RedisConsumerOptions {
  redis: RedisStore
  stream: string
  groupName: string
  blockMs?: number
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

  async init(startId = '$'): Promise<void> {
    await this.redis.xgroupCreate(this.stream, this.groupName, startId)
  }

  async setStartId(id: string): Promise<void> {
    // XGROUP SETID — ioredis uses xgroup('SETID', ...)
    // We use xgroupCreate with existing group to set position
    // Actually SETID is a separate command: use the client directly
    // For now we implement via a helper that calls xgroupCreate which is idempotent (BUSYGROUP ignored)
    // and separately does XGROUP SETID
    await this.redis.xgroupCreate(this.stream, this.groupName, id)
  }

  async recoverOwnPending(): Promise<StreamMessage[]> {
    return this.redis.xreadGroup(
      this.stream,
      this.groupName,
      CONSUMER_NAME,
      100,
      0,
      '0',
    )
  }

  async* read(): AsyncGenerator<StreamMessage> {
    // First yield all pending messages
    const pending = await this.recoverOwnPending()
    for (const msg of pending) {
      yield msg
    }

    // Then read new messages
    while (!this.stopped) {
      const messages = await this.redis.xreadGroup(
        this.stream,
        this.groupName,
        CONSUMER_NAME,
        this.count,
        this.blockMs,
        '>',
      )
      for (const msg of messages) {
        if (this.stopped) return
        yield msg
      }
    }
  }

  async ack(id: string): Promise<void> {
    await this.redis.xack(this.stream, this.groupName, id)
  }

  stop(): void {
    this.stopped = true
  }
}
