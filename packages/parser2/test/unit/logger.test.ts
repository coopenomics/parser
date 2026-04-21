import { describe, it, expect } from 'vitest'
import { createLogger } from '../../src/logger.js'

describe('createLogger', () => {
  it('returns a pino logger with the requested level', () => {
    const logger = createLogger({ level: 'warn' })
    expect(logger.level).toBe('warn')
  })

  it('defaults to "info" level when none provided', () => {
    const logger = createLogger()
    expect(logger.level).toBe('info')
  })

  it('includes chain_id in logger bindings when provided', () => {
    const logger = createLogger({ chain_id: 'eos-mainnet' })
    const bindings = logger.bindings()
    expect(bindings['chain_id']).toBe('eos-mainnet')
  })

  it('creates child logger with additional fields', () => {
    const logger = createLogger({ level: 'debug' })
    const child = logger.child({ block_num: 42 })
    expect(child.level).toBe('debug')
  })
})
