import { describe, it, expect } from 'vitest'
import { createParserMetrics } from '../../src/metrics/parserMetrics.js'

describe('createParserMetrics', () => {
  it('creates all 10 expected metric instances', () => {
    const m = createParserMetrics('test_parser')
    expect(m.blocksProcessedTotal).toBeDefined()
    expect(m.indexingLagSeconds).toBeDefined()
    expect(m.eventsPublishedTotal).toBeDefined()
    expect(m.abiCacheHitsTotal).toBeDefined()
    expect(m.abiCacheMissesTotal).toBeDefined()
    expect(m.streamLength).toBeDefined()
    expect(m.xtrimmedEntriesTotal).toBeDefined()
    expect(m.blockProcessingDuration).toBeDefined()
    expect(m.workerPoolQueueDepth).toBeDefined()
    expect(m.blockProcessingErrors).toBeDefined()
  })

  it('registry contains exactly 10 metrics', async () => {
    const m = createParserMetrics('test_parser_count')
    const all = await m.registry.getMetricsAsJSON()
    expect(all.length).toBe(10)
  })

  it('blocksProcessedTotal increments', async () => {
    const m = createParserMetrics('test_parser_inc')
    m.blocksProcessedTotal.inc()
    m.blocksProcessedTotal.inc()
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_parser_inc_blocks_processed_total')
    expect(metric?.values[0]?.value).toBe(2)
  })

  it('eventsPublishedTotal supports kind label', async () => {
    const m = createParserMetrics('test_parser_labels')
    m.eventsPublishedTotal.inc({ kind: 'action' })
    m.eventsPublishedTotal.inc({ kind: 'delta' })
    m.eventsPublishedTotal.inc({ kind: 'action' })
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_parser_labels_events_published_total')
    const actions = metric?.values.find(v => v.labels['kind'] === 'action')
    expect(actions?.value).toBe(2)
  })

  it('indexingLagSeconds can be set to a float', async () => {
    const m = createParserMetrics('test_parser_lag')
    m.indexingLagSeconds.set(3.5)
    const all = await m.registry.getMetricsAsJSON()
    const metric = all.find(x => x.name === 'test_parser_lag_indexing_lag_seconds')
    expect(metric?.values[0]?.value).toBe(3.5)
  })
})
