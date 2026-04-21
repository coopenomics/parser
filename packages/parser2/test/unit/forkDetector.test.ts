import { describe, it, expect } from 'vitest'
import { ForkDetector } from '../../src/core/ForkDetector.js'

describe('ForkDetector — no fork', () => {
  it('returns null for first block', () => {
    const fd = new ForkDetector('eos')
    expect(fd.check(100, 'id100')).toBeNull()
  })

  it('returns null for monotonically increasing blocks', () => {
    const fd = new ForkDetector('eos')
    fd.check(100, 'id100')
    expect(fd.check(101, 'id101')).toBeNull()
    expect(fd.check(200, 'id200')).toBeNull()
  })
})

describe('ForkDetector — fork detected', () => {
  it('returns ForkEvent when block_num equals last processed', () => {
    const fd = new ForkDetector('eos')
    fd.check(200, 'id200')
    const ev = fd.check(200, 'id200b')
    expect(ev).not.toBeNull()
    expect(ev?.kind).toBe('fork')
    expect(ev?.forked_from_block).toBe(200)
    expect(ev?.new_head_block_id).toBe('id200b')
    expect(ev?.chain_id).toBe('eos')
  })

  it('returns ForkEvent when block_num is less than last processed', () => {
    const fd = new ForkDetector('telos')
    fd.check(300, 'id300')
    const ev = fd.check(299, 'id299')
    expect(ev).not.toBeNull()
    expect(ev?.forked_from_block).toBe(300)
  })

  it('fork event has a deterministic event_id', () => {
    const fd1 = new ForkDetector('eos')
    fd1.check(100, 'a')
    const ev1 = fd1.check(99, 'b')

    const fd2 = new ForkDetector('eos')
    fd2.check(100, 'a')
    const ev2 = fd2.check(99, 'b')

    expect(ev1?.event_id).toBe(ev2?.event_id)
  })

  it('resets counter after fork so next block is treated normally', () => {
    const fd = new ForkDetector('eos')
    fd.check(200, 'id200')
    fd.check(199, 'id199')  // fork here
    // now last is 199
    expect(fd.check(200, 'id200v2')).toBeNull()
  })
})

describe('ForkDetector — reset()', () => {
  it('reset() clears history so next block is treated as first', () => {
    const fd = new ForkDetector('eos')
    fd.check(500, 'id500')
    fd.reset()
    expect(fd.check(100, 'id100')).toBeNull()
  })
})
