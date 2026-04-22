/**
 * Тесты RedisKeys — единого реестра ключей.
 *
 * Ключи намеренно проверяются на точный формат: любой дрифт сломает
 * обратную совместимость со старыми Redis снимками и миграциями.
 */

import { describe, it, expect } from 'vitest'
import { RedisKeys } from '../../src/redis/keys.js'

describe('RedisKeys — event streams', () => {
  it('eventsStream embeds chainId in ce:parser:<chainId>:events', () => {
    expect(RedisKeys.eventsStream('eos-mainnet')).toBe('ce:parser:eos-mainnet:events')
    expect(RedisKeys.eventsStream('telos-test')).toBe('ce:parser:telos-test:events')
  })

  it('deadLetterStream includes both chainId and subId', () => {
    expect(RedisKeys.deadLetterStream('eos', 'verifier'))
      .toBe('ce:parser:eos:dead:verifier')
  })

  it('reparseStream includes chainId and jobId', () => {
    expect(RedisKeys.reparseStream('eos', 'job-42'))
      .toBe('ce:parser:eos:reparse:job-42')
  })
})

describe('RedisKeys — ABI and sync', () => {
  it('abiZset is namespaced by contract name', () => {
    expect(RedisKeys.abiZset('eosio.token')).toBe('parser:abi:eosio.token')
    expect(RedisKeys.abiZset('eosio')).toBe('parser:abi:eosio')
  })

  it('syncHash is keyed by chainId only', () => {
    expect(RedisKeys.syncHash('eos-mainnet')).toBe('parser:sync:eos-mainnet')
  })
})

describe('RedisKeys — subscriptions', () => {
  it('subsHash is a global registry (no params)', () => {
    expect(RedisKeys.subsHash()).toBe('parser:subs')
  })

  it('subFailuresHash is keyed by subId', () => {
    expect(RedisKeys.subFailuresHash('verifier')).toBe('parser:sub:verifier:failures')
  })

  it('subLock is keyed by subId', () => {
    expect(RedisKeys.subLock('verifier')).toBe('parser:sub:verifier:lock')
  })

  it('reparseJobHash is keyed by jobId', () => {
    expect(RedisKeys.reparseJobHash('job-42')).toBe('parser:reparse:job-42')
  })
})

describe('RedisKeys — prefix namespacing invariants', () => {
  it('all stream keys start with ce:parser:', () => {
    expect(RedisKeys.eventsStream('x')).toMatch(/^ce:parser:/)
    expect(RedisKeys.deadLetterStream('x', 's')).toMatch(/^ce:parser:/)
    expect(RedisKeys.reparseStream('x', 'j')).toMatch(/^ce:parser:/)
  })

  it('all non-stream keys start with parser:', () => {
    expect(RedisKeys.abiZset('x')).toMatch(/^parser:/)
    expect(RedisKeys.syncHash('x')).toMatch(/^parser:/)
    expect(RedisKeys.subsHash()).toMatch(/^parser:/)
    expect(RedisKeys.subFailuresHash('x')).toMatch(/^parser:/)
    expect(RedisKeys.subLock('x')).toMatch(/^parser:/)
    expect(RedisKeys.reparseJobHash('x')).toMatch(/^parser:/)
  })

  it('keys for different chains are disjoint (no collision)', () => {
    const a = RedisKeys.eventsStream('eos')
    const b = RedisKeys.eventsStream('telos')
    expect(a).not.toBe(b)
  })
})
