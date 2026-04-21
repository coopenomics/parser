/**
 * Доменные ошибки пакета.
 *
 * Каждый класс расширяет Error и устанавливает `name`, чтобы стек-трейсы
 * содержали читаемое имя вместо просто "Error".
 */

/** Конфигурационный YAML не прошёл структурную валидацию. */
export class ConfigValidationError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ConfigValidationError'
    this.cause = cause
  }
}

/**
 * Секреты обнаружены прямо в конфигурационном файле (например пароль Redis
 * захардкожен в URL). Правильный способ — переменные окружения ${VAR}.
 */
export class ConfigSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigSecurityError'
  }
}

/** Метод интерфейса объявлен, но не реализован в данном адаптере. */
export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`)
    this.name = 'NotImplementedError'
  }
}

/**
 * Chain ID в конфиге не совпал с реальным ID цепи, полученным из SHiP-рукопожатия.
 * Защищает от случайного подключения к неверной ноде.
 */
export class ChainIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Chain ID mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ChainIdMismatchError'
  }
}

/**
 * ABI для указанного контракта не найден ни в Redis-кэше, ни по RPC,
 * а конфигурация abiFallback='fail' запрещает продолжение без него.
 */
export class AbiNotFoundError extends Error {
  constructor(contract: string, blockNum: number, abiFallback: string) {
    super(`ABI for ${contract} not found at block ${blockNum}, abiFallback=${abiFallback}`)
    this.name = 'AbiNotFoundError'
  }
}
