import type { ShipBlock, ChainInfo, ShipDelta, GetBlocksOptions } from '@coopenomics/coopos-ship-reader'
import type { NativeDeltaEvent as ShipNativeDeltaEvent } from '@coopenomics/coopos-ship-reader'

export interface ChainClient {
  connect(): Promise<{ chainId: string }>
  streamBlocks(opts: GetBlocksOptions): AsyncIterable<ShipBlock>
  ack(n: number): void
  close(): Promise<void>
  getChainInfo(): Promise<ChainInfo>
  getRawAbi(contract: string): Promise<Uint8Array>
  deserializeNativeDelta(delta: ShipDelta): ShipNativeDeltaEvent
}
