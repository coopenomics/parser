import PQueue from 'p-queue'
import { ABI, Blob as AntelopeBlob } from '@wharfkit/antelope'
import type { ShipBlock } from '@coopenomics/coopos-ship-reader'
import type { WorkerPool } from '../workers/WorkerPool.js'
import type { ParserEvent, ActionEvent, DeltaEvent } from '../types.js'
import { computeEventId } from '../events/eventId.js'
import type { AbiBootstrapper } from '../abi/AbiBootstrapper.js'
import type { AbiStore } from '../abi/AbiStore.js'

interface BlockProcessorOptions {
  chainId: string
  workerPool: WorkerPool
  abiBootstrapper: AbiBootstrapper
  abiStore: AbiStore
}

function abiToJson(bytes: Uint8Array): string {
  try {
    const base64 = Buffer.from(bytes).toString('base64')
    const abi = ABI.from(AntelopeBlob.from(base64))
    return JSON.stringify(abi)
  } catch {
    return '{}'
  }
}

export class BlockProcessor {
  private queue: PQueue
  private chainId: string
  private workerPool: WorkerPool
  private abiBootstrapper: AbiBootstrapper
  private abiStore: AbiStore

  constructor(opts: BlockProcessorOptions) {
    this.chainId = opts.chainId
    this.workerPool = opts.workerPool
    this.abiBootstrapper = opts.abiBootstrapper
    this.abiStore = opts.abiStore
    this.queue = new PQueue({ concurrency: 1 })
  }

  process(block: ShipBlock): Promise<ParserEvent[]> {
    return this.queue.add(() => this.processBlock(block)) as Promise<ParserEvent[]>
  }

  private async processBlock(block: ShipBlock): Promise<ParserEvent[]> {
    const events: ParserEvent[] = []
    const blockNum = block.thisBlock.blockNum
    const blockId = block.thisBlock.blockId
    const blockTime = block.traces[0]?.blockTime ?? new Date().toISOString()

    for (const trace of block.traces) {
      const abiBytes = await this.abiBootstrapper.ensureAbi(trace.account, blockNum)
      const abiJson = abiBytes && abiBytes.length > 0 ? abiToJson(abiBytes) : '{}'

      let data: Record<string, unknown> = {}
      if (trace.actRaw.length > 0) {
        try {
          data = await this.workerPool.run({
            rawBinary: trace.actRaw,
            abiJson,
            contract: trace.account,
            typeName: trace.name,
            kind: 'action',
          })
        } catch {
          data = {}
        }
      }

      // Runtime ABI update: detect eosio::setabi and store new ABI in ZSET
      if (trace.account === 'eosio' && trace.name === 'setabi') {
        const contractName = data['account']
        const abiHex = data['abi']
        if (typeof contractName === 'string' && typeof abiHex === 'string' && abiHex.length > 0) {
          await this.abiStore.storeAbi(contractName, blockNum, Buffer.from(abiHex, 'hex'))
        }
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
      // Fallback ABI update path: account native delta carries new ABI bytes
      if (delta.name === 'account' && delta.present && delta.rowRaw.length > 0) {
        const eosioAbiBytes = await this.abiBootstrapper.ensureAbi('eosio', blockNum)
        const eosioAbiJson = eosioAbiBytes && eosioAbiBytes.length > 0 ? abiToJson(eosioAbiBytes) : '{}'
        try {
          const accountData = await this.workerPool.run({
            rawBinary: delta.rowRaw,
            abiJson: eosioAbiJson,
            contract: 'eosio',
            typeName: 'account',
            kind: 'delta',
          })
          const accountName = accountData['name']
          const abiHex = accountData['abi']
          if (typeof accountName === 'string' && typeof abiHex === 'string' && abiHex.length > 0) {
            await this.abiStore.storeAbi(accountName, blockNum, Buffer.from(abiHex, 'hex'))
          }
        } catch { /* ignore failed account delta decode */ }
        continue
      }

      if (delta.name !== 'contract_row') continue
      if (!delta.code || !delta.scope || !delta.table || !delta.primaryKey) continue

      const abiBytes = await this.abiBootstrapper.ensureAbi(delta.code, blockNum)
      const abiJson = abiBytes && abiBytes.length > 0 ? abiToJson(abiBytes) : '{}'

      let value: Record<string, unknown> = {}
      if (delta.rowRaw.length > 0) {
        try {
          value = await this.workerPool.run({
            rawBinary: delta.rowRaw,
            abiJson,
            contract: delta.code,
            typeName: delta.table,
            kind: 'delta',
          })
        } catch {
          value = {}
        }
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
