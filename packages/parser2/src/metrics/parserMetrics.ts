import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'

export interface ParserMetrics {
  readonly registry: Registry
  blocksProcessedTotal: Counter
  indexingLagSeconds: Gauge
  eventsPublishedTotal: Counter<'kind'>
  abiCacheHitsTotal: Counter
  abiCacheMissesTotal: Counter
  streamLength: Gauge
  xtrimmedEntriesTotal: Counter
  blockProcessingDuration: Histogram
  workerPoolQueueDepth: Gauge
  blockProcessingErrors: Counter
}

export function createParserMetrics(prefix = 'parser2'): ParserMetrics {
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
