import { describe, it, expect, vi } from 'vitest'
import { listDeadLetters } from '../../src/cli/commands/listDeadLetters.js'
import type { RedisStore } from '../../src/ports/RedisStore.js'

const ENTRY_DATA = JSON.stringify({ kind: 'action', event_id: 'mainnet:a:150000:abcd1234:9876543', block_num: 150000 })
const ENTRY_FIELDS = { data: ENTRY_DATA, failureCount: '3', lastError: 'TypeError: boom', subId: 'verifier' }

function makeMsg(id: string, fields: Record<string, string> = ENTRY_FIELDS) {
  return { id, fields }
}

function makeRedis(opts: {
  xlenResult?: number
  xrangeResult?: ReturnType<typeof makeMsg>[]
  scanResult?: string[]
} = {}): RedisStore {
  return {
    xadd: vi.fn(), xtrim: vi.fn(), xgroupCreate: vi.fn(), xgroupSetId: vi.fn(),
    xinfoGroups: vi.fn(), xreadGroup: vi.fn(),
    xrange: vi.fn().mockResolvedValue(opts.xrangeResult ?? []),
    xrevrange: vi.fn(), xack: vi.fn(),
    xlen: vi.fn().mockResolvedValue(opts.xlenResult ?? 0),
    xdel: vi.fn(),
    zadd: vi.fn(), zrangeByscoreRev: vi.fn(), zrangeByScore: vi.fn(), zcount: vi.fn(),
    zremRangeByScore: vi.fn(), zcard: vi.fn(),
    hset: vi.fn(), hget: vi.fn(), hgetAll: vi.fn(), hincrby: vi.fn(), hdel: vi.fn(),
    setNx: vi.fn(), pexpire: vi.fn(), luaDel: vi.fn(), expire: vi.fn(),
    scan: vi.fn().mockResolvedValue(opts.scanResult ?? []),
    quit: vi.fn(),
  } as unknown as RedisStore
}

describe('listDeadLetters — empty stream', () => {
  it('prints "No dead letters" when stream is empty', async () => {
    const redis = makeRedis({ xlenResult: 0, xrangeResult: [] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', 'verifier', false, 100, '-', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('No dead letters')
    } finally { spy.mockRestore() }
  })
})

describe('listDeadLetters — with entries', () => {
  it('shows table header when entries exist', async () => {
    const redis = makeRedis({
      xlenResult: 1,
      xrangeResult: [makeMsg('1714500000000-1')],
    })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', 'verifier', false, 100, '-', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('ENTRY ID')
      expect(output).toContain('EVENT ID')
      expect(output).toContain('FAIL#')
      expect(output).toContain('LAST ERROR')
    } finally { spy.mockRestore() }
  })

  it('shows event_id and kind from parsed data', async () => {
    const redis = makeRedis({
      xlenResult: 1,
      xrangeResult: [makeMsg('1714500000000-1')],
    })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', 'verifier', false, 100, '-', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('action')
      expect(output).toContain('TypeError: boom')
    } finally { spy.mockRestore() }
  })

  it('outputs JSON array when --json flag is set', async () => {
    const redis = makeRedis({
      xlenResult: 1,
      xrangeResult: [makeMsg('1714500000000-1')],
    })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', 'verifier', true, 100, '-', false)
      const raw = spy.mock.calls[0]?.[0] as string
      const parsed = JSON.parse(raw) as unknown[]
      expect(Array.isArray(parsed)).toBe(true)
      const entry = parsed[0] as Record<string, unknown>
      expect(entry['eventId']).toBe('mainnet:a:150000:abcd1234:9876543')
      expect(entry['kind']).toBe('action')
      expect(entry['failureCount']).toBe(3)
    } finally { spy.mockRestore() }
  })

  it('shows header with total count', async () => {
    const redis = makeRedis({
      xlenResult: 2,
      xrangeResult: [makeMsg('1714500000000-1'), makeMsg('1714500001000-0')],
    })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', 'verifier', false, 100, '-', false)
      const output = spy.mock.calls.flat().join('\n')
      expect(output).toContain('2 total')
    } finally { spy.mockRestore() }
  })
})

describe('listDeadLetters — --all flag', () => {
  it('prints "No dead-letter streams found" when scan returns empty', async () => {
    const redis = makeRedis({ scanResult: [] })
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', null, false, 100, '-', true)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('No dead-letter streams found'))
    } finally { spy.mockRestore() }
  })

  it('calls scan with correct pattern for --all', async () => {
    const redis = makeRedis({ scanResult: ['ce:parser:mainnet:dead:sub1'] })
    vi.spyOn(redis, 'xlen').mockResolvedValue(0)
    vi.spyOn(redis, 'xrange').mockResolvedValue([])
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await listDeadLetters(redis, 'mainnet', null, false, 100, '-', true)
      expect(redis.scan).toHaveBeenCalledWith(expect.stringContaining('mainnet'))
    } finally { spy.mockRestore() }
  })
})
