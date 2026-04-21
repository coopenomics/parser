import { computeEventId } from '../events/eventId.js'
import type { ForkEvent } from '../types.js'

export class ForkDetector {
  private lastBlockNum = -1
  private chainId: string

  constructor(chainId: string) {
    this.chainId = chainId
  }

  /**
   * Called before processing each block.
   * Returns a ForkEvent if the incoming blockNum indicates a fork (≤ last processed),
   * then resets the counter. Returns null when no fork detected.
   */
  check(blockNum: number, blockId: string): ForkEvent | null {
    let event: ForkEvent | null = null

    if (this.lastBlockNum >= 0 && blockNum <= this.lastBlockNum) {
      const partial: Omit<ForkEvent, 'event_id'> = {
        kind: 'fork',
        chain_id: this.chainId,
        forked_from_block: this.lastBlockNum,
        new_head_block_id: blockId,
      }
      event = { ...partial, event_id: computeEventId(partial) }
    }

    this.lastBlockNum = blockNum
    return event
  }

  reset(): void {
    this.lastBlockNum = -1
  }
}
