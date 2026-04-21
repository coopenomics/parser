import { describe, it, expect, afterEach } from 'vitest'
import { HttpServer } from '../../src/observability/HttpServer.js'
import { Registry, Counter } from 'prom-client'

let server: HttpServer | null = null

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
})

function makeRegistry(): Registry {
  const reg = new Registry()
  const counter = new Counter({ name: 'test_counter', help: 'test', registers: [reg] })
  counter.inc(7)
  return reg
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  const body = await res.text()
  return { status: res.status, body }
}

describe('HttpServer — /health', () => {
  it('returns 200 and status ok when lag is within threshold', async () => {
    server = new HttpServer({ port: 19090, getLag: () => 5, lagThresholdSeconds: 60, metricsRegistry: makeRegistry() })
    await server.start()
    const { status, body } = await get(19090, '/health')
    expect(status).toBe(200)
    const parsed = JSON.parse(body) as { status: string }
    expect(parsed.status).toBe('ok')
  })

  it('returns 503 and status degraded when lag exceeds threshold', async () => {
    server = new HttpServer({ port: 19091, getLag: () => 120, lagThresholdSeconds: 60, metricsRegistry: makeRegistry() })
    await server.start()
    const { status, body } = await get(19091, '/health')
    expect(status).toBe(503)
    const parsed = JSON.parse(body) as { status: string }
    expect(parsed.status).toBe('degraded')
  })
})

describe('HttpServer — /metrics', () => {
  it('returns 200 and prometheus text format', async () => {
    const registry = makeRegistry()
    server = new HttpServer({ port: 19092, getLag: () => 0, lagThresholdSeconds: 60, metricsRegistry: registry })
    await server.start()
    const { status, body } = await get(19092, '/metrics')
    expect(status).toBe(200)
    expect(body).toContain('test_counter')
    expect(body).toContain('7')
  })
})

describe('HttpServer — 404', () => {
  it('returns 404 for unknown routes', async () => {
    server = new HttpServer({ port: 19093, getLag: () => 0, lagThresholdSeconds: 60, metricsRegistry: makeRegistry() })
    await server.start()
    const { status } = await get(19093, '/unknown')
    expect(status).toBe(404)
  })
})
