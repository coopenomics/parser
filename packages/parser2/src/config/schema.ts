/**
 * JSON Schema для конфигурационного файла парсера.
 *
 * Используется как:
 *   1. Документация: описывает допустимые поля, типы и значения по умолчанию.
 *   2. Источник для внешних валидаторов (AJV, Ajv) если нужна строгая проверка.
 *   3. IDE подсказки при редактировании YAML (через $schema или LSP).
 *
 * Все поля верхнего уровня кроме ship и redis — опциональны.
 * additionalProperties: false → неизвестные поля вызывают ошибку валидации.
 *
 * Связь с ParserOptions в config/index.ts: поля совпадают.
 * configSchema — статическая декларация, validate() в index.ts — runtime-проверка.
 */

export const configSchema = {
  type: 'object',
  required: ['ship', 'redis'],
  additionalProperties: false,
  properties: {
    /** WebSocket URL SHiP нода. Пример: ws://nodeos:8080/ */
    ship: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        /** Таймаут соединения в мс. По умолчанию 10000. */
        timeoutMs: { type: 'number', default: 10000 },
      },
      additionalProperties: false,
    },
    /** Chain API для ABI fallback. Опционален — нужен только при abiFallback: rpc-current. */
    chain: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        /** Идентификатор цепи (используется как часть Redis ключей). */
        id: { type: 'string' },
      },
      additionalProperties: false,
    },
    /** Redis подключение. */
    redis: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        /** Пароль (если не в URL). Рекомендуется использовать ${REDIS_PASSWORD}. */
        password: { type: 'string' },
        /** Префикс для всех ключей (namespace при shared Redis). */
        keyPrefix: { type: 'string' },
      },
      additionalProperties: false,
    },
    /** Piscina worker pool для ABI десериализации. */
    workerPool: {
      type: 'object',
      properties: {
        /** Максимум worker-потоков. По умолчанию 2. */
        maxThreads: { type: 'number', default: 2 },
      },
      additionalProperties: false,
    },
    /**
     * Поведение при отсутствии ABI для контракта:
     *   rpc-current — запросить текущий ABI через Chain API (требует chain.url).
     *   fail        — выбросить ошибку (strict mode).
     */
    abiFallback: {
      type: 'string',
      enum: ['rpc-current', 'fail'],
      default: 'rpc-current',
    },
    /** XtrimSupervisor: автоматическая обрезка устаревших записей стрима. */
    xtrim: {
      type: 'object',
      properties: {
        /** Интервал проверки в мс. По умолчанию 60000 (1 минута). */
        intervalMs: { type: 'number', default: 60000 },
        /** Включить/отключить автообрезку. По умолчанию true. */
        enabled: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    /** ReconnectSupervisor: поведение при разрыве SHiP соединения. */
    reconnect: {
      type: 'object',
      properties: {
        /** Максимум попыток переподключения. При превышении — process.exit(1). */
        maxAttempts: { type: 'number', default: 10 },
        /**
         * Таблица задержек между попытками в секундах.
         * Индекс = номер попытки - 1 (с clamp'ом на последний элемент).
         * По умолчанию: [1, 2, 5, 15, 60] — экспоненциальный backoff до 1 мин.
         */
        backoffSeconds: {
          type: 'array',
          items: { type: 'number' },
          default: [1, 2, 5, 15, 60],
        },
      },
      additionalProperties: false,
    },
    /**
     * Движок десериализации ABI-данных из SHiP:
     *   wharfkit — @wharfkit/antelope (pure JS, работает везде).
     *   abieos   — нативный C++ bindings (быстрее, но требует компиляции).
     */
    deserializer: {
      type: 'string',
      enum: ['wharfkit', 'abieos'],
      default: 'wharfkit',
    },
    /** Pino структурированный логгер. */
    logger: {
      type: 'object',
      properties: {
        /** Минимальный уровень логирования. */
        level: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'], default: 'info' },
        /** Включить pino-pretty форматирование (только для разработки, тормозит production). */
        pretty: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    /** HTTP /health endpoint для Kubernetes liveness/readiness probe. */
    health: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: false },
        port: { type: 'number', default: 9090 },
        /** Порог lag в секундах: при превышении /health вернёт 503 degraded. */
        lagThresholdSeconds: { type: 'number', default: 30 },
      },
      additionalProperties: false,
    },
    /** HTTP /metrics endpoint для Prometheus scraping. */
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
