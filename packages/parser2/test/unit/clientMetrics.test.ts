import { describe, it, expect } from 'vitest'
import { createClientMetrics } from '../../src/metrics/clientMetrics.js'

describe('createClientMetrics', () => {
  it('creates all 8 expected metric instances', () => {
    const m = createClientMetrics('test_client')
    expect(m.handlerErrorsTotal).toBeDefined()
    expect(m.handlerDurationSeconds).toBeDefined()
    expect(m.subscriptionLockState).toBeDefined()
    expect(m.deadLettersTotal).toBeDefined()
    expect(m.messagesConsumedTotal).toBeDefined()
    expect(m.messageAcknowledgedTotal).toBeDefined()
    expect(m.consumerPendingMessages).toBeDefined()
    expect(m.filterMatchesTotal).toBeDefined()
  })

  it('registry contains exactly 8 metrics', async () => {
    const m = createClientMetrics('test_client_count')
    const all = await m.registry.getMetricsAsJSON()
    expect(all.length).toBe(8)
  })

  it('handlerErrorsTotal supports sub_id and kind labels', async () => {
    const m = createClientMetrics('test_client_err')
    m.handlerErrorsTotal.inc({ sub_id: 'verifier', kind: 'action' })
    m.handlerErrorsTotal.inc({ sub_id: 'verifier', kind: 'action' })
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_client_err_handler_errors_total')
    const entry = metric?.values.find(v => v.labels['sub_id'] === 'verifier' && v.labels['kind'] === 'action')
    expect(entry?.value).toBe(2)
  })

  it('subscriptionLockState supports sub_id and role labels', async () => {
    const m = createClientMetrics('test_client_lock')
    m.subscriptionLockState.set({ sub_id: 'sub1', role: 'active' }, 1)
    m.subscriptionLockState.set({ sub_id: 'sub1', role: 'standby' }, 0)
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_client_lock_subscription_lock_state')
    const active = metric?.values.find(v => v.labels['role'] === 'active')
    expect(active?.value).toBe(1)
  })

  it('deadLettersTotal tracks per sub_id', async () => {
    const m = createClientMetrics('test_client_dl')
    m.deadLettersTotal.inc({ sub_id: 'verifier' })
    m.deadLettersTotal.inc({ sub_id: 'verifier' })
    m.deadLettersTotal.inc({ sub_id: 'indexer' })
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_client_dl_dead_letters_total')
    const verifier = metric?.values.find(v => v.labels['sub_id'] === 'verifier')
    expect(verifier?.value).toBe(2)
  })
})
