const DEFAULT_BACKOFF_SECONDS = [1, 2, 5, 15, 60]
const DEFAULT_MAX_ATTEMPTS = 10

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ReconnectSupervisorOptions {
  maxAttempts?: number
  backoffSeconds?: number[]
  onAttempt?: (attempt: number, delayMs: number) => void
  onGiveUp?: (attempts: number) => void
}

export class ReconnectSupervisor {
  private maxAttempts: number
  private backoffSeconds: number[]
  private onAttempt: (attempt: number, delayMs: number) => void
  private onGiveUp: (attempts: number) => void

  constructor(opts: ReconnectSupervisorOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    this.backoffSeconds = opts.backoffSeconds ?? DEFAULT_BACKOFF_SECONDS
    this.onAttempt = opts.onAttempt ?? (() => undefined)
    this.onGiveUp = opts.onGiveUp ?? ((n) => {
      process.stderr.write(`ReconnectSupervisor: exhausted ${n} attempts, exiting\n`)
      process.exit(1)
    })
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        attempt++
        if (attempt >= this.maxAttempts) {
          this.onGiveUp(attempt)
          // onGiveUp is expected to call process.exit, but in tests it may throw
          throw err
        }
        const backoffIdx = Math.min(attempt - 1, this.backoffSeconds.length - 1)
        const delayMs = (this.backoffSeconds[backoffIdx] ?? 60) * 1000
        this.onAttempt(attempt, delayMs)
        await sleep(delayMs)
      }
    }
  }
}
