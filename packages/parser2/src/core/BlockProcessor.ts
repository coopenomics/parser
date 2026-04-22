/**
 * Обработчик одного блока SHiP → список ParserEvent.
 *
 * Архитектура:
 *   BlockProcessor получает ShipBlock и возвращает массив событий в порядке:
 *   [ActionEvents..., DeltaEvents..., NativeDeltaEvents...]
 *
 * Три фазы обработки:
 *   1. Traces (транзакционные трассировки) → ActionEvent[]
 *      - Для каждого trace: получить ABI → десериализовать action data в worker'е.
 *      - Особый случай eosio::setabi: извлекаем новый ABI и сохраняем в AbiStore.
 *
 *   2. Deltas → DeltaEvent[] + NativeDeltaEvent[]
 *      - account-дельта: содержит обновлённый ABI контракта → сохраняем в AbiStore.
 *      - contract_row: строка пользовательской таблицы → DeltaEvent (ABI-декодирование).
 *      - нативные таблицы (isNativeTableName): NativeDeltaEvent через chainClient.
 *
 * p-queue с concurrency=1 гарантирует последовательную обработку блоков:
 * блок N+1 не начнёт обрабатываться пока не завершится блок N.
 */

import PQueue from 'p-queue'
import { ABI, Blob as AntelopeBlob } from '@wharfkit/antelope'
import { isNativeTableName } from '@coopenomics/coopos-ship-reader'
import type { ShipBlock } from '@coopenomics/coopos-ship-reader'
import type { WorkerPool } from '../workers/WorkerPool.js'
import type { ParserEvent, ActionEvent, DeltaEvent, NativeDeltaEvent } from '../types.js'
import { computeEventId } from '../events/eventId.js'
import type { AbiBootstrapper } from '../abi/AbiBootstrapper.js'
import type { AbiStore } from '../abi/AbiStore.js'
import type { ChainClient } from '../ports/ChainClient.js'

interface BlockProcessorOptions {
  /** Идентификатор цепи — проставляется в каждое событие. */
  chainId: string
  /** Пул потоков для CPU-интенсивной ABI-десериализации. */
  workerPool: WorkerPool
  /** Загрузчик/кэш ABI: обеспечивает ABI перед каждым декодированием. */
  abiBootstrapper: AbiBootstrapper
  /** Прямой доступ к Redis-кэшу ABI для runtime-обновлений (setabi). */
  abiStore: AbiStore
  /** Блокчейн-клиент для десериализации нативных дельт. */
  chainClient: ChainClient
}

/**
 * Конвертирует сырые байты ABI в канонический JSON-формат для передачи в worker.
 * wharfkit ABI.from() умеет парсить base64-encoded raw bytes через AntelopeBlob.
 * .toJSON() возвращает стандартную ABI-схему с structs/actions/tables —
 * именно она нужна worker'у для повторного ABI.from() и Serializer.decode().
 * При ошибке возвращает '{}' — worker просто вернёт пустой объект.
 */
function abiToJson(bytes: Uint8Array): string {
  try {
    const base64 = Buffer.from(bytes).toString('base64')
    const abi = ABI.from(AntelopeBlob.from(base64))
    return JSON.stringify(abi.toJSON())
  } catch {
    return '{}'
  }
}

export class BlockProcessor {
  /** Очередь с concurrency=1: только один блок обрабатывается одновременно. */
  private queue: PQueue
  private chainId: string
  private workerPool: WorkerPool
  private abiBootstrapper: AbiBootstrapper
  private abiStore: AbiStore
  private chainClient: ChainClient

  constructor(opts: BlockProcessorOptions) {
    this.chainId = opts.chainId
    this.workerPool = opts.workerPool
    this.abiBootstrapper = opts.abiBootstrapper
    this.abiStore = opts.abiStore
    this.chainClient = opts.chainClient
    this.queue = new PQueue({ concurrency: 1 })
  }

  /**
   * Ставит блок в очередь на обработку.
   * Возвращает Promise который резолвится когда этот конкретный блок обработан.
   * Блоки обрабатываются строго последовательно (concurrency=1).
   */
  process(block: ShipBlock): Promise<ParserEvent[]> {
    return this.queue.add(() => this.processBlock(block)) as Promise<ParserEvent[]>
  }

  private async processBlock(block: ShipBlock): Promise<ParserEvent[]> {
    const actionEvents: ActionEvent[] = []
    const deltaEvents: DeltaEvent[] = []
    const nativeDeltaEvents: NativeDeltaEvent[] = []

    const blockNum = block.thisBlock.blockNum
    const blockId = block.thisBlock.blockId
    // blockTime берём из первой трассировки; если трассировок нет — текущее время
    const blockTime = block.traces[0]?.blockTime ?? new Date().toISOString()

    // ── Фаза 1: Action traces ─────────────────────────────────────────────────
    for (const trace of block.traces) {
      // Получаем ABI (из кэша или bootstrapping через RPC)
      const abiBytes = await this.abiBootstrapper.ensureAbi(trace.account, blockNum)
      const abiJson = abiBytes && abiBytes.length > 0 ? abiToJson(abiBytes) : '{}'

      let data: Record<string, unknown> = {}
      if (trace.actRaw.length > 0) {
        try {
          // Десериализация в worker-потоке: не блокируем event loop
          data = await this.workerPool.run({
            rawBinary: trace.actRaw,
            abiJson,
            contract: trace.account,
            typeName: trace.name,
            kind: 'action',
          })
        } catch {
          // Не можем декодировать — оставляем data={}; событие всё равно публикуем
          data = {}
        }
      }

      // Runtime ABI update: eosio::setabi содержит новый ABI в поле 'abi' (hex-encoded)
      // Сохраняем сразу — последующие события того же блока уже должны использовать новый ABI
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

      actionEvents.push({ ...partial, event_id: computeEventId(partial) })
    }

    // ── Фаза 2: Deltas ────────────────────────────────────────────────────────
    for (const delta of block.deltas) {

      // account-дельта: нативная таблица с метаданными аккаунта, включая поле 'abi'.
      // Обрабатывается первой чтобы последующие delta events того же блока уже видели новый ABI.
      if (delta.name === 'account' && delta.present && delta.rowRaw.length > 0) {
        const eosioAbiBytes = await this.abiBootstrapper.ensureAbi('eosio', blockNum)
        const eosioAbiJson = eosioAbiBytes && eosioAbiBytes.length > 0 ? abiToJson(eosioAbiBytes) : '{}'
        try {
          // Декодируем account-строку как тип 'account' в ABI eosio
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
        } catch { /* Если не удалось декодировать account — пропускаем ABI-обновление */ }
      }

      // contract_row: строки пользовательских таблиц — декодируются через пользовательский ABI
      if (delta.name === 'contract_row') {
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

        deltaEvents.push({ ...partial, event_id: computeEventId(partial) })
        // continue: нативная проверка ниже не нужна для contract_row
        continue
      }

      // Нативные таблицы (permission, account, resource_limits, …):
      // десериализуются через chainClient, который знает нативные ABI из ship-reader.
      if (isNativeTableName(delta.name)) {
        try {
          const native = this.chainClient.deserializeNativeDelta(delta)
          const partial: Omit<NativeDeltaEvent, 'event_id'> = {
            kind: 'native-delta',
            chain_id: this.chainId,
            block_num: blockNum,
            block_time: blockTime,
            block_id: blockId,
            table: native.table,
            lookup_key: native.lookup_key,
            data: native.data,
            present: native.present,
          }
          nativeDeltaEvents.push({ ...partial, event_id: computeEventId(partial) })
        } catch {
          // Ошибки в отдельных нативных дельтах не должны прерывать весь блок
        }
      }
    }

    // Возвращаем события в порядке: сначала actions, затем deltas, затем native deltas
    return [...actionEvents, ...deltaEvents, ...nativeDeltaEvents]
  }

  /** Число заданий, ожидающих обработки (в очереди + текущее). */
  get pendingCount(): number {
    return this.queue.size + this.queue.pending
  }

  /** Ждёт завершения всех задач в очереди (вызывается при graceful shutdown). */
  onIdle(): Promise<void> {
    return this.queue.onIdle()
  }
}
