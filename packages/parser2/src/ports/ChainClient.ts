/**
 * Порт блокчейн-клиента — абстракция над SHiP WebSocket-соединением.
 *
 * Позволяет подменять реализацию в тестах (mock) не затрагивая
 * бизнес-логику BlockProcessor и Parser.
 * Единственная реализация — ShipReaderAdapter (adapters/ShipReaderAdapter.ts).
 */

import type { ShipBlock, ChainInfo, ShipDelta, GetBlocksOptions } from '@coopenomics/coopos-ship-reader'
import type { NativeDeltaEvent as ShipNativeDeltaEvent } from '@coopenomics/coopos-ship-reader'

export interface ChainClient {
  /**
   * Устанавливает WebSocket-соединение с SHiP-нодой и выполняет рукопожатие.
   * @returns chainId — hex-идентификатор блокчейна из genesis.json.
   */
  connect(): Promise<{ chainId: string }>

  /**
   * Возвращает AsyncIterable блоков начиная с позиции opts.startBlock.
   * Метод блокирующий по своей природе — итерация останавливается только
   * при закрытии соединения или брейке цикла.
   */
  streamBlocks(opts: GetBlocksOptions): AsyncIterable<ShipBlock>

  /**
   * Отправляет ACK-подтверждение SHiP-ноде: «я обработал n блоков, присылай следующие».
   * Без ACK нода прекратит отправку новых блоков (flow control).
   */
  ack(n: number): void

  /** Закрывает WebSocket-соединение. */
  close(): Promise<void>

  /** Запрашивает chain_id и last_irreversible через chain RPC (get_info). */
  getChainInfo(): Promise<ChainInfo>

  /**
   * Загружает сырые байты ABI контракта через chain RPC (get_raw_abi).
   * Вызывается только при первом появлении контракта (bootstrap), дальше
   * ABI берётся из Redis-кэша (AbiStore).
   */
  getRawAbi(contract: string): Promise<Uint8Array>

  /**
   * Десериализует нативную SHiP-дельту (permission, account и т.д.)
   * в типизированный объект.
   * Делегируется ship-reader'у, который знает структуру нативных таблиц.
   */
  deserializeNativeDelta(delta: ShipDelta): ShipNativeDeltaEvent
}
