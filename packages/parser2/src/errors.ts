export class ConfigValidationError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ConfigValidationError'
    this.cause = cause
  }
}

export class ConfigSecurityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigSecurityError'
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not implemented`)
    this.name = 'NotImplementedError'
  }
}

export class ChainIdMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Chain ID mismatch: expected ${expected}, got ${actual}`)
    this.name = 'ChainIdMismatchError'
  }
}
