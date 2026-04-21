/**
 * Минималистичный HTTP-сервер для операционной наблюдаемости.
 *
 * Эндпоинты:
 *   GET /health  → JSON { status, indexingLagSeconds, lagThresholdSeconds }
 *                  200 OK если lag ≤ lagThresholdSeconds, 503 Service Unavailable иначе.
 *                  Полезно для Kubernetes liveness/readiness probe.
 *
 *   GET /metrics → Prometheus text format (Content-Type: text/plain; version=0.0.4).
 *                  Использует переданный metricsRegistry — обычно парсерские метрики.
 *
 * getLag — callback который возвращает текущее отставание в секундах.
 * Вызывающий код (Parser) обновляет это значение после обработки каждого блока.
 *
 * Использование:
 *   const server = new HttpServer({ port: 9090, getLag: () => lagGauge.value, metricsRegistry: reg })
 *   await server.start()
 *   // при shutdown:
 *   await server.stop()
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Registry } from 'prom-client'

/** Тело ответа /health. */
export interface HealthStatus {
  status: 'ok' | 'degraded'
  /** Текущее отставание в секундах на момент запроса. */
  indexingLagSeconds: number
  /** Порог, выше которого статус становится 'degraded'. */
  lagThresholdSeconds: number
}

export interface HttpServerOptions {
  /** Порт HTTP-сервера. По умолчанию 9090. */
  port?: number
  /** Порог lag в секундах для статуса degraded. По умолчанию 60. */
  lagThresholdSeconds?: number
  /** Функция возвращающая актуальное значение отставания. */
  getLag: () => number
  /** Реестр Prometheus-метрик для /metrics эндпоинта. */
  metricsRegistry: Registry
}

export class HttpServer {
  private server: ReturnType<typeof createServer>
  private port: number
  private lagThresholdSeconds: number
  private getLag: () => number
  private metricsRegistry: Registry

  constructor(opts: HttpServerOptions) {
    this.port = opts.port ?? 9090
    this.lagThresholdSeconds = opts.lagThresholdSeconds ?? 60
    this.getLag = opts.getLag
    this.metricsRegistry = opts.metricsRegistry
    this.server = createServer((req, res) => void this.handle(req, res))
  }

  /** Запускает HTTP-сервер, разрешает Promise после успешного bind. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => resolve())
      this.server.once('error', reject)
    })
  }

  /**
   * Останавливает сервер и ждёт закрытия всех соединений.
   * Вызывается при graceful shutdown парсера.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()))
    })
  }

  /** Диспетчеризация HTTP-запросов по URL. */
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/'

    if (url === '/health' || url === '/health/') {
      const lagSeconds = this.getLag()
      const degraded = lagSeconds > this.lagThresholdSeconds
      const body: HealthStatus = {
        status: degraded ? 'degraded' : 'ok',
        indexingLagSeconds: lagSeconds,
        lagThresholdSeconds: this.lagThresholdSeconds,
      }
      // 503 при деградации: Kubernetes readiness probe снимет pod из балансировщика
      res.writeHead(degraded ? 503 : 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }

    if (url === '/metrics' || url === '/metrics/') {
      try {
        const content = await this.metricsRegistry.metrics()
        // Content-Type включает версию формата: text/plain; version=0.0.4; charset=utf-8
        res.writeHead(200, { 'Content-Type': this.metricsRegistry.contentType })
        res.end(content)
      } catch (err) {
        res.writeHead(500)
        res.end('Internal error')
      }
      return
    }

    res.writeHead(404)
    res.end('Not found')
  }
}
