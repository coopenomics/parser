import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { configSchema } from './schema.js'
import { ConfigValidationError, ConfigSecurityError } from '../errors.js'

export interface ParserOptions {
  ship: { url: string; timeoutMs?: number }
  chain?: { url?: string; id?: string }
  redis: { url: string; password?: string; keyPrefix?: string }
  workerPool?: { maxThreads?: number }
  abiFallback?: 'rpc-current' | 'fail'
  xtrim?: { intervalMs?: number; enabled?: boolean }
  reconnect?: { maxAttempts?: number; backoffSeconds?: number[] }
  deserializer?: 'wharfkit' | 'abieos'
  logger?: { level?: string; pretty?: boolean }
  health?: { enabled?: boolean; port?: number; lagThresholdSeconds?: number }
  metrics?: { enabled?: boolean; port?: number }
  noSignalHandlers?: boolean
}

// Keep configSchema imported for future use with external validators
void configSchema

// Matches redis URLs with embedded credentials (not env placeholders)
const PLAIN_SECRET_RE = /redis:\/\/[^$\s]*:[^@$\s]+@/i

function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return process.env[varName] ?? `\${${varName}}`
  })
}

function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj)
  if (Array.isArray(obj)) return obj.map(interpolateDeep)
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = interpolateDeep(v)
    }
    return result
  }
  return obj
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function validate(raw: unknown): raw is ParserOptions {
  const errors: string[] = []
  if (!isObject(raw)) {
    errors.push('(root) must be an object')
    throw new ConfigValidationError(`Config validation failed: ${errors.join('; ')}`)
  }
  if (!isObject(raw['ship']) || typeof (raw['ship'] as Record<string, unknown>)['url'] !== 'string') {
    errors.push('ship.url is required and must be a string')
  }
  if (!isObject(raw['redis']) || typeof (raw['redis'] as Record<string, unknown>)['url'] !== 'string') {
    errors.push('redis.url is required and must be a string')
  }
  const abiFallback = raw['abiFallback']
  if (abiFallback !== undefined && abiFallback !== 'rpc-current' && abiFallback !== 'fail') {
    errors.push('abiFallback must be "rpc-current" or "fail"')
  }
  const deserializer = raw['deserializer']
  if (deserializer !== undefined && deserializer !== 'wharfkit' && deserializer !== 'abieos') {
    errors.push('deserializer must be "wharfkit" or "abieos"')
  }
  if (errors.length > 0) {
    throw new ConfigValidationError(`Config validation failed: ${errors.join('; ')}`)
  }
  return true
}

function checkPlainSecrets(opts: ParserOptions): void {
  if (PLAIN_SECRET_RE.test(opts.redis.url)) {
    throw new ConfigSecurityError(
      'Secrets must be injected via env variables, not hardcoded in config',
    )
  }
}

export function parseConfig(raw: unknown): ParserOptions {
  const interpolated = interpolateDeep(raw)
  validate(interpolated)
  const opts = interpolated as ParserOptions
  checkPlainSecrets(opts)
  return opts
}

export function fromConfigFile(filePath: string): ParserOptions {
  const text = readFileSync(filePath, 'utf8')
  const raw = parseYaml(text) as unknown
  return parseConfig(raw)
}
