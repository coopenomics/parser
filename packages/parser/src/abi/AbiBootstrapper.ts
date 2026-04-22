/**
 * Загрузчик первичного ABI для неизвестных контрактов.
 *
 * Жизненный цикл ABI:
 * 1. Первая встреча с контрактом (observedContracts не содержит его):
 *    → смотрим в AbiStore (Redis ZSET).
 *    → если не найден — загружаем через chain RPC (getRawAbi) и сохраняем.
 * 2. Все последующие встречи: просто читаем из AbiStore (Redis cache hit).
 * 3. Runtime-обновления ABI (eosio::setabi или account-дельта) выполняются
 *    непосредственно в BlockProcessor и обходят этот класс.
 *
 * observedContracts — in-memory Set для оптимизации: если контракт уже
 * проходил через этот экземпляр, гарантированно был инициализирован в Redis.
 */

import type { ChainClient } from '../ports/ChainClient.js'
import { AbiNotFoundError } from '../errors.js'
import type { AbiStore } from './AbiStore.js'

export class AbiBootstrapper {
  /** Контракты, ABI которых уже гарантированно записан в Redis в этом сеансе. */
  private readonly observedContracts = new Set<string>()
  private readonly abiFallback: 'rpc-current' | 'fail'

  constructor(
    private readonly chainClient: ChainClient,
    private readonly abiStore: AbiStore,
    opts?: { abiFallback?: 'rpc-current' | 'fail' },
  ) {
    this.abiFallback = opts?.abiFallback ?? 'rpc-current'
  }

  /**
   * Гарантирует наличие ABI для контракта в кэше перед декодированием события.
   *
   * Быстрый путь: контракт уже в observedContracts → сразу идём в Redis.
   * Медленный путь: первая встреча → проверяем Redis → если пусто, скачиваем с RPC.
   *
   * @param contract — имя аккаунта-контракта (например 'eosio.token').
   * @param blockNum — номер блока, для которого нужна ABI (для поиска версии).
   * @returns Байты ABI или null если ABI недоступен и abiFallback='rpc-current'.
   * @throws AbiNotFoundError если abiFallback='fail' и ABI не найден.
   */
  async ensureAbi(contract: string, blockNum: number): Promise<Uint8Array | null> {
    // Быстрый путь: контракт уже встречался — ABI точно есть в Redis
    if (this.observedContracts.has(contract)) {
      return this.abiStore.getAbi(contract, blockNum)
    }

    // Медленный путь: проверяем Redis (вдруг ABI добавлен ранее или другим процессом)
    const stored = await this.abiStore.getAbi(contract, blockNum)
    if (stored) {
      this.observedContracts.add(contract)
      return stored
    }

    // Первая встреча, ABI в Redis не найден — bootstrap через chain RPC
    this.observedContracts.add(contract)
    try {
      const abiBytes = await this.chainClient.getRawAbi(contract)
      await this.abiStore.storeAbi(contract, blockNum, abiBytes)
      return abiBytes
    } catch {
      if (this.abiFallback === 'fail') {
        throw new AbiNotFoundError(contract, blockNum, this.abiFallback)
      }
      // rpc-current: игнорируем ошибку, возвращаем null — декодирование даст {}
      return null
    }
  }
}
