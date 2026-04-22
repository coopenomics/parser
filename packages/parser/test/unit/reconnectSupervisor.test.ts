import { describe, it, expect, vi } from 'vitest'
import { ReconnectSupervisor } from '../../src/core/ReconnectSupervisor.js'

describe('ReconnectSupervisor — success on first try', () => {
  it('returns the result without retrying', async () => {
    const sup = new ReconnectSupervisor({ backoffSeconds: [0] })
    const result = await sup.run(async () => 42)
    expect(result).toBe(42)
  })
})

describe('ReconnectSupervisor — retries on failure', () => {
  it('retries and succeeds on second attempt', async () => {
    const sup = new ReconnectSupervisor({ maxAttempts: 5, backoffSeconds: [0] })
    let calls = 0
    const result = await sup.run(async () => {
      calls++
      if (calls < 2) throw new Error('fail')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('calls onAttempt with correct attempt number and delay', async () => {
    const attempts: Array<{ attempt: number; delayMs: number }> = []
    const sup = new ReconnectSupervisor({
      maxAttempts: 5,
      backoffSeconds: [0, 0],
      onAttempt: (attempt, delayMs) => attempts.push({ attempt, delayMs }),
    })
    let calls = 0
    await sup.run(async () => {
      calls++
      if (calls < 3) throw new Error('fail')
      return 'done'
    })
    expect(attempts).toHaveLength(2)
    expect(attempts[0]?.attempt).toBe(1)
    expect(attempts[1]?.attempt).toBe(2)
  })
})

describe('ReconnectSupervisor — exhaustion', () => {
  it('calls onGiveUp and throws after maxAttempts', async () => {
    let gaveUp = false
    const sup = new ReconnectSupervisor({
      maxAttempts: 3,
      backoffSeconds: [0],
      onGiveUp: () => { gaveUp = true; throw new Error('gave up') },
    })
    await expect(
      sup.run(async () => { throw new Error('always fails') })
    ).rejects.toThrow()
    expect(gaveUp).toBe(true)
  })

  it('uses the last backoff value when attempts exceed backoff array length', async () => {
    const delays: number[] = []
    const sup = new ReconnectSupervisor({
      maxAttempts: 5,
      backoffSeconds: [0, 0],
      onAttempt: (_, ms) => delays.push(ms),
      onGiveUp: () => { throw new Error('gave up') },
    })
    await expect(
      sup.run(async () => { throw new Error('always fails') })
    ).rejects.toThrow()
    // 4 retries (attempts 1..4) — last 2 should clamp to backoff[1]=0
    expect(delays).toHaveLength(4)
    delays.forEach(d => expect(d).toBe(0))
  })
})
