import { ShipClient } from '@coopenomics/coopos-ship-reader'
import type { ShipBlock, ChainInfo, GetBlocksOptions } from '@coopenomics/coopos-ship-reader'
import type { ChainClient } from '../ports/ChainClient.js'

export class ShipReaderAdapter implements ChainClient {
  private client: ShipClient

  constructor(opts: { url: string; timeoutMs?: number; chainUrl?: string }) {
    const shipCfg: { url: string; timeoutMs?: number } = { url: opts.url }
    if (opts.timeoutMs !== undefined) shipCfg.timeoutMs = opts.timeoutMs

    if (opts.chainUrl !== undefined) {
      this.client = new ShipClient({ ship: shipCfg, chain: { url: opts.chainUrl } })
    } else {
      this.client = new ShipClient({ ship: shipCfg })
    }
  }

  async connect(): Promise<{ chainId: string }> {
    await this.client.connect()
    const { chainId } = await this.client.handshake()
    return { chainId }
  }

  streamBlocks(opts: GetBlocksOptions): AsyncIterable<ShipBlock> {
    return this.client.streamBlocks(opts)
  }

  ack(n: number): void {
    this.client.ack(n)
  }

  async close(): Promise<void> {
    this.client.close()
  }

  getChainInfo(): Promise<ChainInfo> {
    return this.client.getChainInfo()
  }

  getRawAbi(contract: string): Promise<Uint8Array> {
    return this.client.getRawAbi(contract)
  }
}
