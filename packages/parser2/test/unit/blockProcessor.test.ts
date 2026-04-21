import { describe, it, expect, vi } from 'vitest'
import { BlockProcessor } from '../../src/core/BlockProcessor.js'
import type { WorkerPool } from '../../src/workers/WorkerPool.js'
import type { ShipBlock } from '@coopenomics/coopos-ship-reader'
import type { AbiBootstrapper } from '../../src/abi/AbiBootstrapper.js'
import type { AbiStore } from '../../src/abi/AbiStore.js'

function makeWorkerPool(returnValue: Record<string, unknown> = {}): WorkerPool {
  return {
    run: vi.fn().mockResolvedValue(returnValue),
    destroy: vi.fn().mockResolvedValue(undefined),
    utilization: 0,
  } as unknown as WorkerPool
}

function makeAbiBootstrapper(): AbiBootstrapper {
  return {
    ensureAbi: vi.fn().mockResolvedValue(null),
  } as unknown as AbiBootstrapper
}

function makeAbiStore(): AbiStore {
  return {
    getAbi: vi.fn().mockResolvedValue(null),
    storeAbi: vi.fn().mockResolvedValue(undefined),
  } as unknown as AbiStore
}

function makeBlock(blockNum = 1, numTraces = 0, numDeltas = 0): ShipBlock {
  const blockPosition = { blockNum, blockId: 'a'.repeat(64) }
  return {
    thisBlock: blockPosition,
    head: blockPosition,
    lastIrreversible: blockPosition,
    prevBlock: null,
    traces: Array.from({ length: numTraces }, (_, i) => ({
      account: 'eosio.token',
      name: 'transfer',
      authorization: [{ actor: 'alice', permission: 'active' }],
      actRaw: new Uint8Array([1, 2, 3]),
      actionOrdinal: i + 1,
      globalSequence: BigInt(100 + i),
      receipt: null,
      blockNum,
      blockId: 'a'.repeat(64),
      blockTime: '2024-01-01T00:00:00.000',
      transactionId: 'b'.repeat(64),
    })),
    deltas: Array.from({ length: numDeltas }, (_, i) => ({
      name: 'contract_row' as const,
      present: true,
      rowRaw: new Uint8Array([1, 2, 3]),
      code: 'eosio.token',
      scope: `scope${i}`,
      table: 'accounts',
      primaryKey: String(i),
    })),
  }
}

function makeBp(pool?: WorkerPool): BlockProcessor {
  return new BlockProcessor({
    chainId: 'test',
    workerPool: pool ?? makeWorkerPool(),
    abiBootstrapper: makeAbiBootstrapper(),
    abiStore: makeAbiStore(),
  })
}

describe('BlockProcessor — sequential execution', () => {
  it('processes two concurrent blocks sequentially', async () => {
    const pool = makeWorkerPool()
    const bp = makeBp(pool)

    const order: number[] = []
    const origRun = pool.run as ReturnType<typeof vi.fn>
    origRun.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10))
      return {}
    })

    const p1 = bp.process(makeBlock(1, 1)).then(() => order.push(1))
    const p2 = bp.process(makeBlock(2, 1)).then(() => order.push(2))

    await Promise.all([p1, p2])
    expect(order).toEqual([1, 2])
  }, 5000)

  it('returns empty array for block with no traces or deltas', async () => {
    const events = await makeBp().process(makeBlock(1, 0, 0))
    expect(events).toHaveLength(0)
  })
})

describe('BlockProcessor — event enrichment', () => {
  it('enriches 5 actions with event_id, kind, chain_id', async () => {
    const bp = new BlockProcessor({
      chainId: 'mychain',
      workerPool: makeWorkerPool(),
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore: makeAbiStore(),
    })
    const events = await bp.process(makeBlock(42, 5, 0))
    expect(events).toHaveLength(5)
    for (const e of events) {
      expect(e.kind).toBe('action')
      expect(e.event_id).toMatch(/^mychain:a:42:/)
      expect((e as { chain_id: string }).chain_id).toBe('mychain')
    }
  })

  it('enriches 3 deltas with event_id, kind, present:boolean', async () => {
    const bp = new BlockProcessor({
      chainId: 'mychain',
      workerPool: makeWorkerPool(),
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore: makeAbiStore(),
    })
    const events = await bp.process(makeBlock(10, 0, 3))
    expect(events).toHaveLength(3)
    for (const e of events) {
      expect(e.kind).toBe('delta')
      expect(e.event_id).toMatch(/^mychain:d:10:/)
      expect(typeof (e as { present: boolean }).present).toBe('boolean')
    }
  })

  it('processes 5 actions and 3 deltas in one block', async () => {
    const bp = new BlockProcessor({
      chainId: 'chain',
      workerPool: makeWorkerPool(),
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore: makeAbiStore(),
    })
    const events = await bp.process(makeBlock(1, 5, 3))
    expect(events).toHaveLength(8)
    expect(events.filter(e => e.kind === 'action')).toHaveLength(5)
    expect(events.filter(e => e.kind === 'delta')).toHaveLength(3)
  })
})

describe('BlockProcessor — ABI updates (Story 4.3)', () => {
  it('eosio::setabi action triggers storeAbi with correct score', async () => {
    const abiStore = makeAbiStore()
    const pool = makeWorkerPool({ account: 'somecontract', abi: 'deadbeef01' })
    const block: ShipBlock = {
      thisBlock: { blockNum: 500, blockId: 'c'.repeat(64) },
      head: { blockNum: 500, blockId: 'c'.repeat(64) },
      lastIrreversible: { blockNum: 500, blockId: 'c'.repeat(64) },
      prevBlock: null,
      traces: [{
        account: 'eosio',
        name: 'setabi',
        authorization: [],
        actRaw: new Uint8Array([1]),
        actionOrdinal: 1,
        globalSequence: BigInt(1),
        receipt: null,
        blockNum: 500,
        blockId: 'c'.repeat(64),
        blockTime: '2024-01-01T00:00:00.000',
        transactionId: 'd'.repeat(64),
      }],
      deltas: [],
    }
    const bp = new BlockProcessor({
      chainId: 'chain',
      workerPool: pool,
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore,
    })
    await bp.process(block)
    expect(abiStore.storeAbi).toHaveBeenCalledWith('somecontract', 500, expect.any(Buffer))
  })

  it('eosio::setabi with empty abi hex does NOT call storeAbi', async () => {
    const abiStore = makeAbiStore()
    const pool = makeWorkerPool({ account: 'somecontract', abi: '' })
    const block: ShipBlock = {
      thisBlock: { blockNum: 501, blockId: 'c'.repeat(64) },
      head: { blockNum: 501, blockId: 'c'.repeat(64) },
      lastIrreversible: { blockNum: 501, blockId: 'c'.repeat(64) },
      prevBlock: null,
      traces: [{
        account: 'eosio',
        name: 'setabi',
        authorization: [],
        actRaw: new Uint8Array([1]),
        actionOrdinal: 1,
        globalSequence: BigInt(2),
        receipt: null,
        blockNum: 501,
        blockId: 'c'.repeat(64),
        blockTime: '2024-01-01T00:00:00.000',
        transactionId: 'd'.repeat(64),
      }],
      deltas: [],
    }
    const bp = new BlockProcessor({
      chainId: 'chain',
      workerPool: pool,
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore,
    })
    await bp.process(block)
    expect(abiStore.storeAbi).not.toHaveBeenCalled()
  })

  it('account native-delta triggers storeAbi', async () => {
    const abiStore = makeAbiStore()
    const pool = makeWorkerPool({ name: 'mycontract', abi: 'cafebabe' })
    const block: ShipBlock = {
      thisBlock: { blockNum: 600, blockId: 'e'.repeat(64) },
      head: { blockNum: 600, blockId: 'e'.repeat(64) },
      lastIrreversible: { blockNum: 600, blockId: 'e'.repeat(64) },
      prevBlock: null,
      traces: [],
      deltas: [{
        name: 'account' as never,
        present: true,
        rowRaw: new Uint8Array([1, 2, 3]),
        code: '',
        scope: '',
        table: '',
        primaryKey: '',
      }],
    }
    const bp = new BlockProcessor({
      chainId: 'chain',
      workerPool: pool,
      abiBootstrapper: makeAbiBootstrapper(),
      abiStore,
    })
    await bp.process(block)
    expect(abiStore.storeAbi).toHaveBeenCalledWith('mycontract', 600, expect.any(Buffer))
  })
})
