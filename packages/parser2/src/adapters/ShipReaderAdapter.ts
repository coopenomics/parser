/**
 * Адаптер SHiP-клиента — реализует порт ChainClient через ShipClient из ship-reader.
 *
 * Роль: изолирует бизнес-логику (BlockProcessor, Parser) от деталей
 * WebSocket-протокола SHiP и специфики @coopenomics/coopos-ship-reader.
 *
 * Жизненный цикл:
 *   1. new ShipReaderAdapter(opts) — конструируем клиент
 *   2. connect() — WebSocket handshake, получаем chainId
 *   3. streamBlocks(opts) — начинаем принимать блоки
 *   4. ack(1) — после каждого блока подтверждаем получение
 *   5. close() — завершаем соединение
 */

import { ShipClient } from '@coopenomics/coopos-ship-reader'
import type {
  ShipBlock,
  ChainInfo,
  ShipDelta,
  GetBlocksOptions,
  NativeDeltaEvent as ShipNativeDeltaEvent,
} from '@coopenomics/coopos-ship-reader'
import type { ChainClient } from '../ports/ChainClient.js'

export class ShipReaderAdapter implements ChainClient {
  private client: ShipClient

  /**
   * @param opts.url — WebSocket URL SHiP-ноды, например ws://localhost:29999.
   * @param opts.timeoutMs — таймаут WebSocket-подключения.
   * @param opts.chainUrl — HTTP URL chain API (для getRawAbi / getChainInfo).
   */
  constructor(opts: { url: string; timeoutMs?: number; chainUrl?: string }) {
    const shipCfg: { url: string; timeoutMs?: number } = { url: opts.url }
    if (opts.timeoutMs !== undefined) shipCfg.timeoutMs = opts.timeoutMs

    // chain-конфиг необязателен: без него getRawAbi и getChainInfo недоступны
    if (opts.chainUrl !== undefined) {
      this.client = new ShipClient({ ship: shipCfg, chain: { url: opts.chainUrl } })
    } else {
      this.client = new ShipClient({ ship: shipCfg })
    }
  }

  /**
   * Устанавливает WebSocket-соединение и выполняет SHiP-рукопожатие.
   * Рукопожатие возвращает chainId — hex-хэш genesis.json.
   */
  async connect(): Promise<{ chainId: string }> {
    await this.client.connect()
    const { chainId } = await this.client.handshake()
    return { chainId }
  }

  /** Начинает асинхронный поток блоков от указанной позиции. */
  streamBlocks(opts: GetBlocksOptions): AsyncIterable<ShipBlock> {
    return this.client.streamBlocks(opts)
  }

  /**
   * ACK n блоков: сигнализирует SHiP-ноде что мы готовы принять ещё.
   * SHiP использует оконное управление потоком: без ACK нода замолчит.
   */
  ack(n: number): void {
    this.client.ack(n)
  }

  /** Закрывает WebSocket. */
  async close(): Promise<void> {
    this.client.close()
  }

  /** GET /v1/chain/get_info — возвращает head block, last irreversible и т.д. */
  getChainInfo(): Promise<ChainInfo> {
    return this.client.getChainInfo()
  }

  /** GET /v1/chain/get_raw_abi — загружает сырые байты ABI для bootstrap. */
  getRawAbi(contract: string): Promise<Uint8Array> {
    return this.client.getRawAbi(contract)
  }

  /**
   * Десериализует нативную SHiP-дельту в типизированный объект.
   * Делегируется встроенному deserializer'у ship-reader, который
   * содержит hardcoded-схемы нативных таблиц (permission, account, …).
   */
  deserializeNativeDelta(delta: ShipDelta): ShipNativeDeltaEvent {
    return this.client.deserializer.deserializeNativeDelta(delta)
  }
}
