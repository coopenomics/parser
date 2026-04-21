import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'

export interface ClientMetrics {
  readonly registry: Registry
  handlerErrorsTotal: Counter<'sub_id' | 'kind'>
  handlerDurationSeconds: Histogram<'sub_id' | 'kind'>
  subscriptionLockState: Gauge<'sub_id' | 'role'>
  deadLettersTotal: Counter<'sub_id'>
  messagesConsumedTotal: Counter<'sub_id'>
  messageAcknowledgedTotal: Counter<'sub_id'>
  consumerPendingMessages: Gauge<'sub_id'>
  filterMatchesTotal: Counter<'sub_id' | 'kind'>
}

export function createClientMetrics(prefix = 'parser2_client'): ClientMetrics {
  const registry = new Registry()

  const handlerErrorsTotal = new Counter<'sub_id' | 'kind'>({
    name: `${prefix}_handler_errors_total`,
    help: 'Total errors thrown by subscription event handlers',
    labelNames: ['sub_id', 'kind'],
    registers: [registry],
  })

  const handlerDurationSeconds = new Histogram<'sub_id' | 'kind'>({
    name: `${prefix}_handler_duration_seconds`,
    help: 'Duration of subscription handler execution in seconds',
    labelNames: ['sub_id', 'kind'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    registers: [registry],
  })

  const subscriptionLockState = new Gauge<'sub_id' | 'role'>({
    name: `${prefix}_subscription_lock_state`,
    help: 'Lock state gauge: 1=active, 0=standby/acquiring',
    labelNames: ['sub_id', 'role'],
    registers: [registry],
  })

  const deadLettersTotal = new Counter<'sub_id'>({
    name: `${prefix}_dead_letters_total`,
    help: 'Total messages routed to dead-letter stream',
    labelNames: ['sub_id'],
    registers: [registry],
  })

  const messagesConsumedTotal = new Counter<'sub_id'>({
    name: `${prefix}_messages_consumed_total`,
    help: 'Total messages read from the events stream',
    labelNames: ['sub_id'],
    registers: [registry],
  })

  const messageAcknowledgedTotal = new Counter<'sub_id'>({
    name: `${prefix}_messages_acknowledged_total`,
    help: 'Total messages acknowledged (XACK)',
    labelNames: ['sub_id'],
    registers: [registry],
  })

  const consumerPendingMessages = new Gauge<'sub_id'>({
    name: `${prefix}_consumer_pending_messages`,
    help: 'Current number of pending (unacknowledged) messages for this consumer',
    labelNames: ['sub_id'],
    registers: [registry],
  })

  const filterMatchesTotal = new Counter<'sub_id' | 'kind'>({
    name: `${prefix}_filter_matches_total`,
    help: 'Total events that matched subscription filters',
    labelNames: ['sub_id', 'kind'],
    registers: [registry],
  })

  return {
    registry,
    handlerErrorsTotal,
    handlerDurationSeconds,
    subscriptionLockState,
    deadLettersTotal,
    messagesConsumedTotal,
    messageAcknowledgedTotal,
    consumerPendingMessages,
    filterMatchesTotal,
  }
}
