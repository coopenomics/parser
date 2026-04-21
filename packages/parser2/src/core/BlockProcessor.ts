import PQueue from 'p-queue'
import type { ShipBlock } from '@coopenomics/coopos-ship-reader'
import type { ChainClient } from '../ports/ChainClient.js'
import type { WorkerPool } from '../workers/WorkerPool.js'
import type { ParserEvent, ActionEvent, DeltaEvent } from '../types.js'
import { computeEventId } from '../events/eventId.js'

interface BlockProcessorOptions {
  chainId: string
  chainClient: ChainClient
  workerPool: WorkerPool
}

export class BlockProcessor {
  private queue: PQueue
  private chainId: string
  private workerPool: WorkerPool

  constructor(opts: BlockProcessorOptions) {
    this.chainId = opts.chainId
    this.workerPool = opts.workerPool
    this.queue = new PQueue({ concurrency: 1 })
  }

  process(block: ShipBlock): Promise<ParserEvent[]> {
    return this.queue.add(() => this.processBlock(block)) as Promise<ParserEvent[]>
  }

  private async processBlock(block: ShipBlock): Promise<ParserEvent[]> {
    const events: ParserEvent[] = []
    const blockNum = block.thisBlock.blockNum
    const blockId = block.thisBlock.blockId
    // blockTime comes from individual traces (each trace carries it)
    const blockTime = block.traces[0]?.blockTime ?? new Date().toISOString()

    for (const trace of block.traces) {
      let data: Record<string, unknown>

      if (trace.actRaw.length > 0) {
        try {
          data = await this.workerPool.run({
            rawBinary: trace.actRaw,
            abiJson: '{}',
            contract: trace.account,
            typeName: trace.name,
            kind: 'action',
          })
        } catch {
          data = {}
        }
      } else {
        data = {}
      }

      const partial: Omit<ActionEvent, 'event_id'> = {
        kind: 'action',
        chain_id: this.chainId,
        block_num: blockNum,
        block_time: blockTime,
        block_id: blockId,
        account: trace.account,
        name: trace.name,
        authorization: [...trace.authorization],
        data,
        action_ordinal: trace.actionOrdinal,
        global_sequence: trace.globalSequence,
        receipt: trace.receipt,
      }

      events.push({ ...partial, event_id: computeEventId(partial) })
    }

    for (const delta of block.deltas) {
      if (delta.name !== 'contract_row') continue
      if (!delta.code || !delta.scope || !delta.table || !delta.primaryKey) continue

      let value: Record<string, unknown>

      if (delta.rowRaw.length > 0) {
        try {
          value = await this.workerPool.run({
            rawBinary: delta.rowRaw,
            abiJson: '{}',
            contract: delta.code,
            typeName: delta.table,
            kind: 'delta',
          })
        } catch {
          value = {}
        }
      } else {
        value = {}
      }

      const partial: Omit<DeltaEvent, 'event_id'> = {
        kind: 'delta',
        chain_id: this.chainId,
        block_num: blockNum,
        block_time: blockTime,
        block_id: blockId,
        code: delta.code,
        scope: delta.scope,
        table: delta.table,
        primary_key: delta.primaryKey,
        value,
        present: delta.present,
      }

      events.push({ ...partial, event_id: computeEventId(partial) })
    }

    return events
  }

  get pendingCount(): number {
    return this.queue.size + this.queue.pending
  }

  onIdle(): Promise<void> {
    return this.queue.onIdle()
  }
}
