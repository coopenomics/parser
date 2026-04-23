/**
 * Тесты RedisKeys — единого реестра ключей.
 *
 * Ключи намеренно проверяются на точный формат: любой дрифт сломает
 * обратную совместимость со старыми Redis снимками и миграциями.
 */

import { describe, it, expect } from 'vitest'
import { RedisKeys } from '../../src/redis/keys.js'

describe('RedisKeys — event streams', () => {
  it('eventsStream embeds chainId in ce:parser2:<chainId>:events', () => {
    expect(RedisKeys.eventsStream('eos-mainnet')).toBe('ce:parser2:eos-mainnet:events')
    expect(RedisKeys.eventsStream('telos-test')).toBe('ce:parser2:telos-test:events')
  })

  it('deadLetterStream includes both chainId and subId', () => {
    expect(RedisKeys.deadLetterStream('eos', 'verifier'))
      .toBe('ce:parser2:eos:dead:verifier')
  })

  it('reparseStream includes chainId and jobId', () => {
    expect(RedisKeys.reparseStream('eos', 'job-42'))
      .toBe('ce:parser2:eos:reparse:job-42')
  })
})

describe('RedisKeys — ABI and sync', () => {
  it('abiZset is namespaced by contract name', () => {
    expect(RedisKeys.abiZset('eosio.token')).toBe('parser2:abi:eosio.token')
    expect(RedisKeys.abiZset('eosio')).toBe('parser2:abi:eosio')
  })

  it('syncHash is keyed by chainId only', () => {
    expect(RedisKeys.syncHash('eos-mainnet')).toBe('parser2:sync:eos-mainnet')
  })
})

describe('RedisKeys — subscriptions', () => {
  it('subsHash is a global registry (no params)', () => {
    expect(RedisKeys.subsHash()).toBe('parser2:subs')
  })

  it('subFailuresHash is keyed by subId', () => {
    expect(RedisKeys.subFailuresHash('verifier')).toBe('parser2:sub:verifier:failures')
  })

  it('subLock is keyed by subId', () => {
    expect(RedisKeys.subLock('verifier')).toBe('parser2:sub:verifier:lock')
  })

  it('reparseJobHash is keyed by jobId', () => {
    expect(RedisKeys.reparseJobHash('job-42')).toBe('parser2:reparse:job-42')
  })
})

describe('RedisKeys — prefix namespacing invariants', () => {
  it('all stream keys start with ce:parser2:', () => {
    expect(RedisKeys.eventsStream('x')).toMatch(/^ce:parser2:/)
    expect(RedisKeys.deadLetterStream('x', 's')).toMatch(/^ce:parser2:/)
    expect(RedisKeys.reparseStream('x', 'j')).toMatch(/^ce:parser2:/)
  })

  it('all non-stream keys start with parser2:', () => {
    expect(RedisKeys.abiZset('x')).toMatch(/^parser2:/)
    expect(RedisKeys.syncHash('x')).toMatch(/^parser2:/)
    expect(RedisKeys.subsHash()).toMatch(/^parser2:/)
    expect(RedisKeys.subFailuresHash('x')).toMatch(/^parser2:/)
    expect(RedisKeys.subLock('x')).toMatch(/^parser2:/)
    expect(RedisKeys.reparseJobHash('x')).toMatch(/^parser2:/)
  })

  it('keys for different chains are disjoint (no collision)', () => {
    const a = RedisKeys.eventsStream('eos')
    const b = RedisKeys.eventsStream('telos')
    expect(a).not.toBe(b)
  })
})
