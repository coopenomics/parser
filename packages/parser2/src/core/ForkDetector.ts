/**
 * Детектор микрофорков блокчейна.
 *
 * Алгоритм прост: SHiP нода отправляет блоки последовательно.
 * При нормальной работе номер каждого следующего блока строго больше предыдущего.
 * Если пришёл блок с номером ≤ последнему обработанному — произошёл форк.
 *
 * При обнаружении форка:
 *   1. Создаём ForkEvent с forked_from_block = lastBlockNum.
 *   2. Устанавливаем lastBlockNum = новый blockNum (форкнутая ветка теперь актуальна).
 *   3. Возвращаем ForkEvent — он будет опубликован первым в пакете событий блока.
 *
 * Потребители должны откатить своё состояние для всех блоков > forked_from_block.
 * Паттерн отката: docs/disaster-recovery.md → Scenario 4.
 */

import { computeEventId } from '../events/eventId.js'
import type { ForkEvent } from '../types.js'

export class ForkDetector {
  /** -1 означает «ещё не видели ни одного блока». */
  private lastBlockNum = -1
  private chainId: string

  constructor(chainId: string) {
    this.chainId = chainId
  }

  /**
   * Проверяет, является ли входящий блок форком.
   * Должен вызываться один раз перед обработкой каждого блока.
   *
   * @returns ForkEvent если обнаружен форк, null при нормальной последовательности.
   */
  check(blockNum: number, blockId: string): ForkEvent | null {
    let event: ForkEvent | null = null

    // lastBlockNum >= 0: пропускаем первый блок (нет предыстории для сравнения)
    if (this.lastBlockNum >= 0 && blockNum <= this.lastBlockNum) {
      const partial: Omit<ForkEvent, 'event_id'> = {
        kind: 'fork',
        chain_id: this.chainId,
        forked_from_block: this.lastBlockNum,
        new_head_block_id: blockId,
      }
      event = { ...partial, event_id: computeEventId(partial) }
    }

    // Обновляем lastBlockNum независимо от наличия форка:
    // после форка track продолжается с нового blockNum
    this.lastBlockNum = blockNum
    return event
  }

  /**
   * Сбрасывает историю (вызывается при переподключении к SHiP-ноде,
   * чтобы не ложно детектировать форк при старте с произвольного блока).
   */
  reset(): void {
    this.lastBlockNum = -1
  }
}
