import pino from 'pino'

const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  '*.password',
  '*.token',
  '*.secret',
  '*.authorization',
  'redis.password',
  'redis.url',
]

export type Logger = pino.Logger

export interface LoggerOptions {
  level?: string
  pretty?: boolean
  chain_id?: string
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env['LOG_LEVEL'] ?? 'info')
  const pretty = opts.pretty ?? (process.env['NODE_ENV'] === 'development')

  const base: Record<string, string> = {}
  if (opts.chain_id) base['chain_id'] = opts.chain_id

  const transport =
    pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined

  const logger = pino(
    {
      level,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      base,
    },
    transport ? pino.transport(transport) : pino.destination(1),
  )

  return logger
}

export const rootLogger: Logger = createLogger()
