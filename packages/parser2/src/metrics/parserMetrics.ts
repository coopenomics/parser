/**
 * Prometheus-метрики для парсера (серверная сторона: SHiP → Redis).
 *
 * Все метрики регистрируются в изолированном Registry — не в default глобальном.
 * Это важно для тестов (каждый тест создаёт свой registry) и для случаев
 * когда парсер запускается вместе с другими Prometheus-экспортёрами в процессе.
 *
 * Использование: createParserMetrics() → объект с counter/gauge/histogram полями.
 * Parser главный класс передаёт их в BlockProcessor, XtrimSupervisor и HttpServer.
 *
 * Метрики можно наблюдать через GET /metrics (если health.enabled + metrics.enabled).
 */

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'

/**
 * Интерфейс парсерских метрик.
 * Хранится как поле Parser класса и передаётся в подкомпоненты.
 */
export interface ParserMetrics {
  readonly registry: Registry
  /** Счётчик обработанных блоков. Растёт монотонно. Используется для расчёта throughput. */
  blocksProcessedTotal: Counter
  /** Текущее отставание: (head_block_time - current_block_time) в секундах.
   *  0 = в реальном времени. Большие значения → парсер не успевает. */
  indexingLagSeconds: Gauge
  /** Счётчик опубликованных событий по видам (action/delta/native-delta/fork).
   *  Позволяет видеть объём трафика каждого типа данных. */
  eventsPublishedTotal: Counter<'kind'>
  /** Счётчик попаданий в кэш ABI (worker pool нашёл ABI без запроса к Redis/Chain). */
  abiCacheHitsTotal: Counter
  /** Счётчик промахов кэша ABI (пришлось читать из Redis или запрашивать Chain API). */
  abiCacheMissesTotal: Counter
  /** Текущая длина Redis events stream. Растущее значение → XTRIM не справляется или отключён. */
  streamLength: Gauge
  /** Счётчик удалённых записей XTRIM. Помогает оценить объём хранимых данных. */
  xtrimmedEntriesTotal: Counter
  /** Гистограмма времени обработки одного блока (секунды).
   *  Buckets: 1ms–5s. Всплески → медленный ABI декодинг или Redis перегружен. */
  blockProcessingDuration: Histogram
  /** Текущая глубина очереди Piscina worker pool.
   *  Растущая очередь → worker pool не успевает за темпом блоков. */
  workerPoolQueueDepth: Gauge
  /** Счётчик ошибок обработки блоков (исключения в BlockProcessor).
   *  В норме должен быть близок к 0. */
  blockProcessingErrors: Counter
}

/**
 * Создаёт набор парсерских метрик в изолированном Registry.
 *
 * @param prefix — префикс имён метрик. По умолчанию 'parser'.
 *   Меняется в тестах и при запуске нескольких инстансов.
 */
export function createParserMetrics(prefix = 'parser'): ParserMetrics {
  const registry = new Registry()

  const blocksProcessedTotal = new Counter({
    name: `${prefix}_blocks_processed_total`,
    help: 'Total number of blocks processed by the parser',
    registers: [registry],
  })

  const indexingLagSeconds = new Gauge({
    name: `${prefix}_indexing_lag_seconds`,
    help: 'Lag between head block time and current block time in seconds',
    registers: [registry],
  })

  const eventsPublishedTotal = new Counter<'kind'>({
    name: `${prefix}_events_published_total`,
    help: 'Total events published to Redis stream',
    labelNames: ['kind'],
    registers: [registry],
  })

  const abiCacheHitsTotal = new Counter({
    name: `${prefix}_abi_cache_hits_total`,
    help: 'Number of ABI cache hits',
    registers: [registry],
  })

  const abiCacheMissesTotal = new Counter({
    name: `${prefix}_abi_cache_misses_total`,
    help: 'Number of ABI cache misses (fetched from chain)',
    registers: [registry],
  })

  const streamLength = new Gauge({
    name: `${prefix}_stream_length`,
    help: 'Current length of the Redis events stream',
    registers: [registry],
  })

  const xtrimmedEntriesTotal = new Counter({
    name: `${prefix}_xtrimmed_entries_total`,
    help: 'Total number of entries removed by XTRIM',
    registers: [registry],
  })

  // Buckets подобраны для типичного диапазона: 1ms (быстрый кэш) → 5s (медленный ABI fetch)
  const blockProcessingDuration = new Histogram({
    name: `${prefix}_block_processing_duration_seconds`,
    help: 'Duration of block processing in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
  })

  const workerPoolQueueDepth = new Gauge({
    name: `${prefix}_worker_pool_queue_depth`,
    help: 'Current number of tasks queued in the Piscina worker pool',
    registers: [registry],
  })

  const blockProcessingErrors = new Counter({
    name: `${prefix}_block_processing_errors_total`,
    help: 'Total number of block processing errors',
    registers: [registry],
  })

  return {
    registry,
    blocksProcessedTotal,
    indexingLagSeconds,
    eventsPublishedTotal,
    abiCacheHitsTotal,
    abiCacheMissesTotal,
    streamLength,
    xtrimmedEntriesTotal,
    blockProcessingDuration,
    workerPoolQueueDepth,
    blockProcessingErrors,
  }
}
