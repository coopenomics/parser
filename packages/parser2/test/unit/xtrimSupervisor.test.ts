/**
 * Тесты XtrimSupervisor — фонового trim'а Redis Stream.
 *
 * Проверяем:
 *   - start/stop идемпотентны
 *   - trim использует MINID по отстающей группе с pending > 0
 *   - группы без pending не мешают trim'у
 *   - XTRIM не вызывается если групп нет или ни у одной нет pending
 *   - ошибки в xinfoGroups не прерывают supervisor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { XtrimSupervisor } from '../../src/core/XtrimSupervisor.js'
import type { RedisStore, XGroupInfo } from '../../src/ports/RedisStore.js'

function makeRedis(groups: XGroupInfo[] = []): RedisStore {
  return {
    xinfoGroups: vi.fn().mockResolvedValue(groups),
    xtrim: vi.fn().mockResolvedValue(0),
    // остальные методы не используются в supervisor
  } as unknown as RedisStore
}

// Заставляет promise из mock'а дождаться завершения между фейк-таймерами
async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('XtrimSupervisor — lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does nothing until start() is called', () => {
    const redis = makeRedis()
    new XtrimSupervisor({ redis, stream: 's', intervalMs: 1000 })
    vi.advanceTimersByTime(5000)
    expect(redis.xinfoGroups).not.toHaveBeenCalled()
  })

  it('start() begins periodic trimming at the configured interval', async () => {
    const redis = makeRedis([])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 1000 })
    sup.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(redis.xinfoGroups).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(redis.xinfoGroups).toHaveBeenCalledTimes(2)

    sup.stop()
  })

  it('start() is idempotent (multiple calls create only one timer)', async () => {
    const redis = makeRedis([])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 500 })
    sup.start()
    sup.start()
    sup.start()

    await vi.advanceTimersByTimeAsync(500)
    // Если бы было 3 таймера — было бы 3 вызова
    expect(redis.xinfoGroups).toHaveBeenCalledTimes(1)

    sup.stop()
  })

  it('stop() cancels the interval', async () => {
    const redis = makeRedis([])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 500 })
    sup.start()
    sup.stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(redis.xinfoGroups).not.toHaveBeenCalled()
  })

  it('stop() is safe to call when not started', () => {
    const redis = makeRedis()
    const sup = new XtrimSupervisor({ redis, stream: 's' })
    expect(() => sup.stop()).not.toThrow()
  })

  it('uses default intervalMs when not specified (60_000)', async () => {
    const redis = makeRedis([])
    const sup = new XtrimSupervisor({ redis, stream: 's' })
    sup.start()

    await vi.advanceTimersByTimeAsync(59_999)
    expect(redis.xinfoGroups).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(redis.xinfoGroups).toHaveBeenCalledTimes(1)

    sup.stop()
  })
})

describe('XtrimSupervisor — trim logic', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('skips trim when there are no groups', async () => {
    const redis = makeRedis([])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(redis.xtrim).not.toHaveBeenCalled()
    sup.stop()
  })

  it('skips trim when all groups have pending = 0', async () => {
    const redis = makeRedis([
      { name: 'g1', pending: 0, lastDeliveredId: '100-0', lag: 0, consumers: 1 },
      { name: 'g2', pending: 0, lastDeliveredId: '200-0', lag: 0, consumers: 1 },
    ])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(redis.xtrim).not.toHaveBeenCalled()
    sup.stop()
  })

  it('trims to minimum lastDeliveredId among groups with pending > 0', async () => {
    // g1 pending но отстал на 100 — должен стать minId
    // g2 pending и догнал до 500 — игнорируется для выбора min
    // g3 нет pending — вообще не учитывается
    const redis = makeRedis([
      { name: 'g1', pending: 5, lastDeliveredId: '100-0', lag: 5, consumers: 1 },
      { name: 'g2', pending: 2, lastDeliveredId: '500-0', lag: 2, consumers: 1 },
      { name: 'g3', pending: 0, lastDeliveredId: '50-0', lag: 0, consumers: 1 },
    ])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()

    expect(redis.xtrim).toHaveBeenCalledTimes(1)
    expect(redis.xtrim).toHaveBeenCalledWith('s', '100-0')
    sup.stop()
  })

  it('uses lexicographic comparison for stream IDs (which is also numeric-correct for same-length)', async () => {
    const redis = makeRedis([
      { name: 'g1', pending: 1, lastDeliveredId: '1000-0', lag: 1, consumers: 1 },
      { name: 'g2', pending: 1, lastDeliveredId: '999-0', lag: 1, consumers: 1 },
    ])
    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    // lexicographic: '1000-0' < '999-0' → выбран '1000-0'
    expect(redis.xtrim).toHaveBeenCalledWith('s', '1000-0')
    sup.stop()
  })

  it('silently swallows errors from xinfoGroups (best-effort)', async () => {
    const redis = makeRedis([])
    ;(redis.xinfoGroups as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Redis down'))

    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    // Ошибка не выпала наверх — supervisor продолжает работать
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect(redis.xinfoGroups).toHaveBeenCalledTimes(2)
    sup.stop()
  })

  it('silently swallows errors from xtrim itself', async () => {
    const redis = makeRedis([
      { name: 'g1', pending: 1, lastDeliveredId: '100-0', lag: 1, consumers: 1 },
    ])
    ;(redis.xtrim as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('xtrim failed'))

    const sup = new XtrimSupervisor({ redis, stream: 's', intervalMs: 100 })
    sup.start()
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    // Не бросает наружу
    sup.stop()
  })
})
