import { describe, it, expect } from 'vitest'
import { ForkDetector } from '../../src/core/ForkDetector.js'

describe('ForkDetector — happy path (no fork)', () => {
  it('returns null for first block regardless of block number', () => {
    const fd = new ForkDetector('eos')
    expect(fd.check(100, 'id100')).toBeNull()
  })

  it('returns null for genesis (block 0)', () => {
    const fd = new ForkDetector('eos')
    expect(fd.check(0, 'genesis')).toBeNull()
  })

  it('returns null for monotonically increasing contiguous blocks', () => {
    const fd = new ForkDetector('eos')
    for (let n = 100; n <= 110; n++) {
      expect(fd.check(n, `id${n}`)).toBeNull()
    }
  })

  it('returns null for monotonically increasing sparse blocks (gaps allowed)', () => {
    // Gaps happen when Parser resumes after shutdown — SHiP may skip to current head
    const fd = new ForkDetector('eos')
    fd.check(100, 'id100')
    expect(fd.check(500, 'id500')).toBeNull()
    expect(fd.check(10_000, 'id10k')).toBeNull()
  })
})

describe('ForkDetector — fork detected', () => {
  it('returns ForkEvent when block_num equals last processed (replay of same height)', () => {
    const fd = new ForkDetector('eos')
    fd.check(200, 'id200')
    const ev = fd.check(200, 'id200b')
    expect(ev).not.toBeNull()
    expect(ev?.kind).toBe('fork')
    expect(ev?.forked_from_block).toBe(200)
    expect(ev?.new_head_block_id).toBe('id200b')
    expect(ev?.chain_id).toBe('eos')
  })

  it('returns ForkEvent when block_num is less than last processed (deeper rollback)', () => {
    const fd = new ForkDetector('telos')
    fd.check(300, 'id300')
    const ev = fd.check(299, 'id299')
    expect(ev).not.toBeNull()
    expect(ev?.forked_from_block).toBe(300)
    expect(ev?.new_head_block_id).toBe('id299')
    expect(ev?.chain_id).toBe('telos')
  })

  it('deep fork: rollback by 100 blocks still produces a single ForkEvent', () => {
    const fd = new ForkDetector('eos')
    fd.check(1000, 'id1000')
    const ev = fd.check(900, 'id900')
    expect(ev?.forked_from_block).toBe(1000)
  })

  it('detects two consecutive forks (fork, recover, fork again)', () => {
    const fd = new ForkDetector('eos')
    fd.check(100, 'a')
    const ev1 = fd.check(99, 'b')
    expect(ev1?.forked_from_block).toBe(100)
    // recover: new canonical chain advances past previous head
    expect(fd.check(101, 'c')).toBeNull()
    // second fork off that new chain
    const ev2 = fd.check(100, 'd')
    expect(ev2?.forked_from_block).toBe(101)
    expect(ev2?.new_head_block_id).toBe('d')
  })

  it('reset() + block ≤ previous head does NOT fire (history cleared)', () => {
    const fd = new ForkDetector('eos')
    fd.check(500, 'id500')
    fd.reset()
    // After reset, block 100 is "first" — not a fork even though < 500
    expect(fd.check(100, 'id100')).toBeNull()
  })
})

describe('ForkDetector — event_id determinism', () => {
  it('same (chain, forked_from_block, new_head_block_id) → same event_id', () => {
    const fd1 = new ForkDetector('eos')
    fd1.check(100, 'a')
    const ev1 = fd1.check(99, 'b')

    const fd2 = new ForkDetector('eos')
    fd2.check(100, 'a')
    const ev2 = fd2.check(99, 'b')

    expect(ev1?.event_id).toBe(ev2?.event_id)
  })

  it('different chain_id produces different event_id even with same block params', () => {
    const fdA = new ForkDetector('eos')
    fdA.check(100, 'a')
    const evA = fdA.check(99, 'b')

    const fdB = new ForkDetector('telos')
    fdB.check(100, 'a')
    const evB = fdB.check(99, 'b')

    expect(evA?.event_id).not.toBe(evB?.event_id)
  })

  it('different new_head_block_id produces different event_id', () => {
    const fd = new ForkDetector('eos')
    fd.check(100, 'head')
    const ev1 = fd.check(99, 'branchA')

    fd.reset()
    fd.check(100, 'head')
    const ev2 = fd.check(99, 'branchB')

    expect(ev1?.event_id).not.toBe(ev2?.event_id)
  })
})

describe('ForkDetector — state transitions', () => {
  it('after fork, lastBlockNum tracks the forked branch (not previous head)', () => {
    const fd = new ForkDetector('eos')
    fd.check(200, 'id200')
    fd.check(150, 'id150') // fork: now tracking from 150
    // 151 is a normal continuation of the new branch — should NOT fire
    expect(fd.check(151, 'id151')).toBeNull()
    // 150 replay on the new branch IS a fork (equals last)
    expect(fd.check(150, 'id150b')).not.toBeNull()
  })

  it('reset() inside a fork scenario: subsequent block treated as first', () => {
    const fd = new ForkDetector('eos')
    fd.check(200, 'a')
    fd.check(199, 'b') // fork
    fd.reset()
    // Even a much lower block is not a fork because history was cleared
    expect(fd.check(50, 'c')).toBeNull()
  })

  it('multiple reset() calls are idempotent', () => {
    const fd = new ForkDetector('eos')
    fd.reset()
    fd.reset()
    expect(fd.check(100, 'a')).toBeNull()
  })
})
