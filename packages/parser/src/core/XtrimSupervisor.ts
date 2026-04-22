/**
 * Фоновый supervisor для периодической очистки основного стрима (XTRIM).
 *
 * Проблема: события XADD добавляются непрерывно, и без очистки стрим
 * будет расти бесконечно, занимая память Redis.
 *
 * Стратегия MINID:
 *   Вместо хранения фиксированного числа записей (MAXLEN), мы сохраняем все
 *   записи, которые ещё не подтверждены (pending) хотя бы одной consumer group.
 *   minId = min(lastDeliveredId всех групп с pending > 0).
 *   XTRIM stream MINID minId удаляет всё с ID < minId.
 *
 * Это гарантирует, что ни один consumer не потеряет сообщения при trim:
 * группа с отставанием «тормозит» trim, пока не догонит.
 *
 * Таймер unref'ится чтобы не мешать graceful shutdown Node.js процесса.
 */

import type { RedisStore } from '../ports/RedisStore.js'

export interface XtrimSupervisorOpts {
  redis: RedisStore
  /** Имя стрима для очистки (обычно ce:parser:<chainId>:events). */
  stream: string
  /** Интервал между trim-циклами в мс. По умолчанию 60 000 (1 минута). */
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

  /** Запускает периодический trim. Идемпотентен — повторный вызов игнорируется. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.trim()
    }, this.intervalMs)
    // unref: таймер не удерживает процесс от завершения
    this.timer.unref?.()
  }

  /** Останавливает trim-цикл (вызывается при graceful shutdown). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Один цикл очистки:
   * 1. Получаем список consumer groups через XINFO GROUPS.
   * 2. Фильтруем группы у которых есть pending сообщения (pending > 0).
   * 3. Находим минимальный lastDeliveredId среди таких групп.
   * 4. XTRIM stream MINID minId — удаляем всё старее этого ID.
   *
   * Если pending-групп нет — trim не делается (всё подтверждено).
   * Если стрим не существует или XInfo бросает — тихо игнорируем (best-effort).
   */
  private async trim(): Promise<void> {
    try {
      const groups = await this.redis.xinfoGroups(this.stream)
      if (!groups || groups.length === 0) return

      // Trim только по группам с pending: не трогаем сообщения которые ещё не доставлены
      const pendingGroups = groups.filter(g => g.pending > 0)
      if (pendingGroups.length === 0) return

      // Наименьший lastDeliveredId = самый отстающий consumer
      const minId = pendingGroups
        .map(g => g.lastDeliveredId)
        .reduce((a, b) => (a < b ? a : b))

      if (minId) await this.redis.xtrim(this.stream, minId)
    } catch {
      // XTRIM — best-effort: ошибки не должны влиять на основной поток обработки
    }
  }
}
