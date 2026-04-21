/**
 * Фабрика структурированного логгера на базе Pino.
 *
 * Возможности:
 *   - JSON-формат (по умолчанию) — удобен для Loki, CloudWatch, ELK.
 *   - pino-pretty — красивый вывод при NODE_ENV=development или pretty=true.
 *   - Redaction: поля password/token/secret/authorization заменяются '[REDACTED]'.
 *   - Корреляционное поле chain_id: все логи одного парсера помечены chain_id.
 *
 * Использование:
 *   const log = createLogger({ level: 'debug', chain_id: 'eos-mainnet' })
 *   log.info({ block_num: 400_000_000 }, 'Block processed')
 *
 *   Дочерний логгер (наследует уровень и base):
 *   const childLog = log.child({ component: 'BlockProcessor' })
 */

import pino from 'pino'

/**
 * Пути для redaction чувствительных данных.
 * Pino заменит значения по этим путям на '[REDACTED]' перед записью в лог.
 * Паттерны *.password и т.д. покрывают вложенные объекты.
 */
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
  'redis.url', // Redis URL может содержать пароль в строке подключения
]

export type Logger = pino.Logger

export interface LoggerOptions {
  /** Минимальный уровень: 'trace'|'debug'|'info'|'warn'|'error'|'fatal'. По умолчанию 'info'. */
  level?: string
  /** Включить pino-pretty (цветной вывод). По умолчанию true при NODE_ENV=development. */
  pretty?: boolean
  /** Если задан — добавляется в base поля всех сообщений. */
  chain_id?: string
}

/**
 * Создаёт новый логгер с указанными параметрами.
 * Уровень можно переопределить через переменную окружения LOG_LEVEL.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env['LOG_LEVEL'] ?? 'info')
  const pretty = opts.pretty ?? (process.env['NODE_ENV'] === 'development')

  // base — поля присутствующие в каждом log-сообщении
  const base: Record<string, string> = {}
  if (opts.chain_id) base['chain_id'] = opts.chain_id

  // transport: pino-pretty только если запрошен, иначе stdout (fd=1)
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

/** Дефолтный корневой логгер без chain_id — для быстрого старта. */
export const rootLogger: Logger = createLogger()
