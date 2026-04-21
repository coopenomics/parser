export const configSchema = {
  type: 'object',
  required: ['ship', 'redis'],
  additionalProperties: false,
  properties: {
    ship: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        timeoutMs: { type: 'number', default: 10000 },
      },
      additionalProperties: false,
    },
    chain: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        id: { type: 'string' },
      },
      additionalProperties: false,
    },
    redis: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        password: { type: 'string' },
        keyPrefix: { type: 'string' },
      },
      additionalProperties: false,
    },
    workerPool: {
      type: 'object',
      properties: {
        maxThreads: { type: 'number', default: 2 },
      },
      additionalProperties: false,
    },
    abiFallback: {
      type: 'string',
      enum: ['rpc-current', 'fail'],
      default: 'rpc-current',
    },
    xtrim: {
      type: 'object',
      properties: {
        intervalMs: { type: 'number', default: 60000 },
        enabled: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    reconnect: {
      type: 'object',
      properties: {
        maxAttempts: { type: 'number', default: 10 },
        backoffSeconds: {
          type: 'array',
          items: { type: 'number' },
          default: [1, 2, 5, 15, 60],
        },
      },
      additionalProperties: false,
    },
    deserializer: {
      type: 'string',
      enum: ['wharfkit', 'abieos'],
      default: 'wharfkit',
    },
    logger: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'], default: 'info' },
        pretty: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    health: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        port: { type: 'number', default: 9090 },
        lagThresholdSeconds: { type: 'number', default: 30 },
      },
      additionalProperties: false,
    },
    metrics: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        port: { type: 'number', default: 9100 },
      },
      additionalProperties: false,
    },
  },
} as const
