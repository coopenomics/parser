export class ShipConnectionError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ShipConnectionError'
    this.cause = cause
  }
}

export class ShipProtocolError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ShipProtocolError'
    this.cause = cause
  }
}

export class DeserializationError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'DeserializationError'
    this.cause = cause
  }
}

export class ChainRpcError extends Error {
  override readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ChainRpcError'
    this.cause = cause
  }
}

export class UnknownNativeTableError extends Error {
  constructor(public readonly table: string) {
    super(`Unknown native delta table: "${table}"`)
    this.name = 'UnknownNativeTableError'
  }
}
