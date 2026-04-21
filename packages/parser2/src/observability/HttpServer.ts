import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Registry } from 'prom-client'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  indexingLagSeconds: number
  lagThresholdSeconds: number
}

export interface HttpServerOptions {
  port?: number
  lagThresholdSeconds?: number
  getLag: () => number
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

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => resolve())
      this.server.once('error', reject)
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()))
    })
  }

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
      res.writeHead(degraded ? 503 : 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }

    if (url === '/metrics' || url === '/metrics/') {
      try {
        const content = await this.metricsRegistry.metrics()
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
