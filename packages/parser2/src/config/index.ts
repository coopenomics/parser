/**
 * Загрузка и валидация конфигурации парсера.
 *
 * Поддерживаемые форматы: YAML файл (fromConfigFile) или уже разобранный объект (parseConfig).
 *
 * Конвейер обработки:
 *   1. Чтение YAML → parseYaml → raw object.
 *   2. interpolateDeep: рекурсивно заменяет ${VAR} → process.env[VAR].
 *      Если переменная не задана — оставляем плейсхолдер (не ломаем конфиг, но validate упадёт
 *      если это обязательное поле).
 *   3. validate: проверяет обязательные поля (ship.url, redis.url) и enum-значения.
 *   4. checkPlainSecrets: запрещает хардкодированные пароли в Redis URL.
 *      redis://:hardcoded-pass@host → ConfigSecurityError.
 *      redis://${REDIS_PASSWORD}@host → OK (это плейсхолдер, не секрет).
 *
 * Почему env-интерполяция важна: операторы хранят конфиг в git без секретов,
 * инжектируя их через переменные среды в Kubernetes / Docker. Формат ${VAR} — стандарт.
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { configSchema } from './schema.js'
import { ConfigValidationError, ConfigSecurityError } from '../errors.js'

/**
 * Все настройки парсера в одном объекте.
 * Передаётся в конструктор Parser и ParserClient.
 * Все поля кроме ship и redis — опциональны (имеют дефолты в соответствующих модулях).
 */
export interface ParserOptions {
  /** SHiP WebSocket соединение. timeoutMs по умолчанию 10000. */
  ship: { url: string; timeoutMs?: number }
  /** Chain API для ABI fallback (abiFallback: 'rpc-current'). Опционален. */
  chain?: { url?: string; id?: string }
  /** Redis подключение. keyPrefix добавляет namespace к ключам (полезно при shared Redis). */
  redis: { url: string; password?: string; keyPrefix?: string }
  /** Piscina worker pool для десериализации. maxThreads по умолчанию = CPU count / 2. */
  workerPool?: { maxThreads?: number }
  /** Поведение при отсутствии ABI: 'rpc-current' = попробовать Chain API, 'fail' = ошибка. */
  abiFallback?: 'rpc-current' | 'fail'
  /** XtrimSupervisor: интервал проверки и включение/отключение автообрезки стрима. */
  xtrim?: { intervalMs?: number; enabled?: boolean }
  /** ReconnectSupervisor: максимум попыток и backoff-таблица в секундах. */
  reconnect?: { maxAttempts?: number; backoffSeconds?: number[] }
  /** Десериализатор ABI-данных. Единственный вариант — 'wharfkit'. */
  deserializer?: 'wharfkit'
  /** Pino logger настройки. pretty=true включает pino-pretty (для разработки). */
  logger?: { level?: string; pretty?: boolean }
  /** HTTP /health endpoint. Kubernetes liveness/readiness probe. */
  health?: { enabled?: boolean; port?: number; lagThresholdSeconds?: number }
  /** HTTP /metrics endpoint для Prometheus. */
  metrics?: { enabled?: boolean; port?: number }
  /** Обрабатывать только irreversible блоки (block_num <= lastIrreversible). */
  irreversibleOnly?: boolean
  /** Не устанавливать SIGTERM/SIGINT обработчики. Используется в тестах. */
  noSignalHandlers?: boolean
}

// configSchema экспортируется для внешних валидаторов (AJV, Ajv) и документации
void configSchema

/**
 * Паттерн для детекции хардкодированных паролей в Redis URL.
 * Срабатывает на: redis://:password@host или redis://user:pass@host
 * НЕ срабатывает на: redis://:${REDIS_PASSWORD}@host (env-переменная — ОК).
 * [^$\s]* — не-$, не-пробел → означает отсутствие $ в начале пароля.
 */
const PLAIN_SECRET_RE = /redis:\/\/[^$\s]*:[^@$\s]+@/i

/**
 * Заменяет одну ${VAR} подстановку в строке.
 * Если переменная не задана — возвращает исходный плейсхолдер (не падаем).
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return process.env[varName] ?? `\${${varName}}`
  })
}

/**
 * Рекурсивно обходит структуру данных и заменяет ${VAR} в строках.
 * Работает со строками, массивами и объектами.
 * Числа, булевы, null — возвращает без изменений.
 */
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

/** Type guard: проверяет что значение является непустым объектом (не массивом). */
function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Ручная валидация конфига (без AJV).
 * Проверяет только обязательные инварианты: ship.url, redis.url, enum-значения.
 * Выбрасывает ConfigValidationError с описанием всех нарушений.
 */
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
  if (deserializer !== undefined && deserializer !== 'wharfkit') {
    errors.push('deserializer must be "wharfkit"')
  }
  if (errors.length > 0) {
    throw new ConfigValidationError(`Config validation failed: ${errors.join('; ')}`)
  }
  return true
}

/**
 * Проверяет что секреты не хардкодированы в Redis URL.
 * Хардкодированные секреты: попадут в git, логи, env dumps → критичная утечка.
 * Правило: используй ${REDIS_PASSWORD} вместо прямого пароля.
 */
function checkPlainSecrets(opts: ParserOptions): void {
  if (PLAIN_SECRET_RE.test(opts.redis.url)) {
    throw new ConfigSecurityError(
      'Secrets must be injected via env variables, not hardcoded in config',
    )
  }
}

/**
 * Парсит и валидирует конфиг из уже разобранного объекта (результат parseYaml или тест).
 * Применяет env-интерполяцию, валидацию, проверку безопасности.
 */
export function parseConfig(raw: unknown): ParserOptions {
  const interpolated = interpolateDeep(raw)
  validate(interpolated)
  const opts = interpolated as ParserOptions
  checkPlainSecrets(opts)
  return opts
}

/**
 * Читает YAML файл по пути и возвращает валидированные ParserOptions.
 * Основная точка входа для CLI команд и пользовательского кода.
 * Выбрасывает ConfigValidationError/ConfigSecurityError/Error при любых проблемах.
 */
export function fromConfigFile(filePath: string): ParserOptions {
  const text = readFileSync(filePath, 'utf8')
  const raw = parseYaml(text) as unknown
  return parseConfig(raw)
}
