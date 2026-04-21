/**
 * Prometheus-метрики для клиентской стороны парсера (ParserClient / RedisConsumer).
 *
 * Клиентские метрики отражают состояние подписок, а не самого парсера.
 * Каждая метрика имеет label sub_id — для разделения по подпискам в Grafana.
 *
 * Архитектурное решение: отдельный Registry от парсерских метрик позволяет:
 *   - Запускать клиент и парсер в одном процессе без коллизий имён.
 *   - Тестировать клиентские метрики изолированно.
 *   - Скрейпить метрики клиента отдельным Prometheus job (если клиент — отдельный сервис).
 *
 * Использование: createClientMetrics() → передаётся в ParserClient конструктор.
 */

import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client'

/**
 * Интерфейс клиентских метрик.
 * Хранится в ParserClient и передаётся в RedisConsumer и FailureTracker.
 */
export interface ClientMetrics {
  readonly registry: Registry
  /** Счётчик ошибок в пользовательском handler по (sub_id, kind).
   *  Растущее значение → handler падает, события могут уйти в dead-letter. */
  handlerErrorsTotal: Counter<'sub_id' | 'kind'>
  /** Гистограмма времени выполнения handler по (sub_id, kind).
   *  Медленный handler блокирует потребление новых сообщений. */
  handlerDurationSeconds: Histogram<'sub_id' | 'kind'>
  /** Состояние distributed lock по (sub_id, role).
   *  1 = активный лидер, 0 = ожидание/acquiring.
   *  Позволяет видеть в Grafana: сколько инстансов борются за лидерство. */
  subscriptionLockState: Gauge<'sub_id' | 'role'>
  /** Счётчик событий, упавших в dead-letter stream по sub_id.
   *  Ненулевое значение требует внимания оператора (replay-dead-letter). */
  deadLettersTotal: Counter<'sub_id'>
  /** Счётчик прочитанных сообщений из стрима по sub_id (XREADGROUP).
   *  Растёт при нормальной работе — отражает throughput потребления. */
  messagesConsumedTotal: Counter<'sub_id'>
  /** Счётчик подтверждённых сообщений (XACK) по sub_id.
   *  Должен быть близок к messagesConsumedTotal. Большой разрыв → PEL копится. */
  messageAcknowledgedTotal: Counter<'sub_id'>
  /** Текущий размер PEL (pending entry list) по sub_id.
   *  Растущий PEL → сообщения читаются но не подтверждаются (handler зависает или падает). */
  consumerPendingMessages: Gauge<'sub_id'>
  /** Счётчик событий прошедших через фильтр подписки по (sub_id, kind).
   *  Позволяет оценить эффективность фильтрации: отношение к messagesConsumedTotal. */
  filterMatchesTotal: Counter<'sub_id' | 'kind'>
}

/**
 * Создаёт набор клиентских метрик в изолированном Registry.
 *
 * @param prefix — префикс имён метрик. По умолчанию 'parser2_client'.
 */
export function createClientMetrics(prefix = 'parser2_client'): ClientMetrics {
  const registry = new Registry()

  const handlerErrorsTotal = new Counter<'sub_id' | 'kind'>({
    name: `${prefix}_handler_errors_total`,
    help: 'Total errors thrown by subscription event handlers',
    labelNames: ['sub_id', 'kind'],
    registers: [registry],
  })

  // Buckets: 1ms–1s — типичный диапазон для обработчиков (DB запрос, HTTP call)
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
