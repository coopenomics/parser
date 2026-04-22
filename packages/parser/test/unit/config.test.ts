import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseConfig } from '../../src/config/index.js'
import { ConfigValidationError, ConfigSecurityError } from '../../src/errors.js'

describe('parseConfig — valid config', () => {
  it('parses minimal valid config', () => {
    const cfg = parseConfig({ ship: { url: 'ws://localhost:8080' }, redis: { url: 'redis://localhost:6379' } })
    expect(cfg.ship.url).toBe('ws://localhost:8080')
    expect(cfg.redis.url).toBe('redis://localhost:6379')
  })

  it('parses full config with all sections', () => {
    const cfg = parseConfig({
      ship: { url: 'ws://localhost:8080', timeoutMs: 5000 },
      chain: { url: 'https://rpc.example.com', id: 'abc123' },
      redis: { url: 'redis://localhost:6379', password: 'secret', keyPrefix: 'test:' },
      workerPool: { maxThreads: 4 },
      abiFallback: 'fail',
      xtrim: { intervalMs: 30000, enabled: true },
      reconnect: { maxAttempts: 5, backoffSeconds: [1, 2, 5] },
      deserializer: 'wharfkit',
      logger: { level: 'debug', pretty: true },
      health: { enabled: true, port: 9090, lagThresholdSeconds: 30 },
      metrics: { enabled: true, port: 9100 },
    })
    expect(cfg.workerPool?.maxThreads).toBe(4)
    expect(cfg.abiFallback).toBe('fail')
    expect(cfg.chain?.id).toBe('abc123')
  })
})

describe('parseConfig — validation errors', () => {
  it('throws ConfigValidationError when ship.url missing', () => {
    expect(() => parseConfig({ redis: { url: 'redis://localhost:6379' } })).toThrow(ConfigValidationError)
  })

  it('throws ConfigValidationError when redis.url missing', () => {
    expect(() => parseConfig({ ship: { url: 'ws://localhost:8080' } })).toThrow(ConfigValidationError)
  })

  it('throws ConfigValidationError for invalid abiFallback value', () => {
    expect(() => parseConfig({
      ship: { url: 'ws://localhost:8080' },
      redis: { url: 'redis://localhost:6379' },
      abiFallback: 'invalid',
    })).toThrow(ConfigValidationError)
  })

  it('includes human-readable message', () => {
    try {
      parseConfig({ ship: { url: 'ws://localhost' } })
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError)
      expect((e as ConfigValidationError).message).toContain('validation failed')
    }
  })
})

describe('parseConfig — security check', () => {
  it('throws ConfigSecurityError for plain redis password in URL', () => {
    expect(() => parseConfig({
      ship: { url: 'ws://localhost:8080' },
      redis: { url: 'redis://:supersecret@localhost:6379' },
    })).toThrow(ConfigSecurityError)
  })
})

describe('parseConfig — env interpolation', () => {
  beforeEach(() => {
    process.env['TEST_REDIS_URL'] = 'redis://localhost:6379'
    process.env['TEST_SHIP_URL'] = 'ws://localhost:8080'
  })

  afterEach(() => {
    delete process.env['TEST_REDIS_URL']
    delete process.env['TEST_SHIP_URL']
  })

  it('interpolates env vars in string fields', () => {
    const cfg = parseConfig({
      ship: { url: '${TEST_SHIP_URL}' },
      redis: { url: '${TEST_REDIS_URL}' },
    })
    expect(cfg.ship.url).toBe('ws://localhost:8080')
    expect(cfg.redis.url).toBe('redis://localhost:6379')
  })

  it('leaves placeholder as-is when env var missing', () => {
    const cfg = parseConfig({
      ship: { url: 'ws://localhost:8080' },
      redis: { url: '${MISSING_VAR_XYZ}' },
    })
    expect(cfg.redis.url).toBe('${MISSING_VAR_XYZ}')
  })
})
