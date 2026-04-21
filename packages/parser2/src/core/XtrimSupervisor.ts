import type { RedisStore } from '../ports/RedisStore.js'

export interface XtrimSupervisorOpts {
  redis: RedisStore
  stream: string
  intervalMs?: number
}

export class XtrimSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly redis: RedisStore
  private readonly stream: string
  private readonly intervalMs: number

  constructor(opts: XtrimSupervisorOpts) {
    this.redis = opts.redis
    this.stream = opts.stream
    this.intervalMs = opts.intervalMs ?? 60_000
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.trim()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async trim(): Promise<void> {
    try {
      const groups = await this.redis.xinfoGroups(this.stream)
      if (!groups || groups.length === 0) return

      const pendingGroups = groups.filter(g => g.pending > 0)
      if (pendingGroups.length === 0) return

      const minId = pendingGroups
        .map(g => g.lastDeliveredId)
        .reduce((a, b) => (a < b ? a : b))

      if (minId) await this.redis.xtrim(this.stream, minId)
    } catch {
      // best-effort
    }
  }
}
