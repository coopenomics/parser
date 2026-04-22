/**
 * Supervisor для автоматического переподключения с экспоненциальным backoff.
 *
 * Оборачивает произвольную async-функцию (например подключение к SHiP-ноде)
 * и повторяет её при ошибке с нарастающими паузами между попытками.
 *
 * Стратегия backoff: берём backoffSeconds[attempt-1], зажимая индекс
 * по длине массива (последнее значение используется для всех поздних попыток).
 * По умолчанию: [1, 2, 5, 15, 60] секунд.
 *
 * Если число попыток достигает maxAttempts — вызывается onGiveUp, который
 * по умолчанию пишет в stderr и вызывает process.exit(1).
 * В тестах onGiveUp можно заменить на throw чтобы не завершать процесс.
 */

/** Задержки по умолчанию: 1→2→5→15→60→60→… секунд */
const DEFAULT_BACKOFF_SECONDS = [1, 2, 5, 15, 60]
const DEFAULT_MAX_ATTEMPTS = 10

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export interface ReconnectSupervisorOptions {
  /** Максимальное число попыток до вызова onGiveUp. По умолчанию 10. */
  maxAttempts?: number
  /** Паузы между попытками в секундах. Последний элемент используется для всех поздних попыток. */
  backoffSeconds?: number[]
  /** Вызывается перед каждым повтором с номером попытки и паузой в мс. */
  onAttempt?: (attempt: number, delayMs: number) => void
  /** Вызывается при исчерпании всех попыток. По умолчанию пишет в stderr и process.exit(1). */
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

  /**
   * Запускает fn и повторяет при исключении с паузами.
   *
   * Псевдокод:
   *   loop:
   *     try: return await fn()
   *     catch: attempt++
   *       if attempt >= maxAttempts: onGiveUp(); throw
   *       delay = backoffSeconds[min(attempt-1, len-1)] * 1000
   *       onAttempt(attempt, delay); sleep(delay)
   *
   * @returns Результат первого успешного вызова fn.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        attempt++
        if (attempt >= this.maxAttempts) {
          this.onGiveUp(attempt)
          // onGiveUp ожидается вызывает process.exit; в тестах может бросать
          throw err
        }
        // Зажимаем индекс: если попыток больше чем элементов в массиве — используем последний
        const backoffIdx = Math.min(attempt - 1, this.backoffSeconds.length - 1)
        const delayMs = (this.backoffSeconds[backoffIdx] ?? 60) * 1000
        this.onAttempt(attempt, delayMs)
        await sleep(delayMs)
      }
    }
  }
}
