import type { ChainClient } from '../ports/ChainClient.js'
import { AbiNotFoundError } from '../errors.js'
import type { AbiStore } from './AbiStore.js'

export class AbiBootstrapper {
  private readonly observedContracts = new Set<string>()
  private readonly abiFallback: 'rpc-current' | 'fail'

  constructor(
    private readonly chainClient: ChainClient,
    private readonly abiStore: AbiStore,
    opts?: { abiFallback?: 'rpc-current' | 'fail' },
  ) {
    this.abiFallback = opts?.abiFallback ?? 'rpc-current'
  }

  async ensureAbi(contract: string, blockNum: number): Promise<Uint8Array | null> {
    if (this.observedContracts.has(contract)) {
      return this.abiStore.getAbi(contract, blockNum)
    }

    const stored = await this.abiStore.getAbi(contract, blockNum)
    if (stored) {
      this.observedContracts.add(contract)
      return stored
    }

    // First observation, not in ZSET — bootstrap via RPC
    this.observedContracts.add(contract)
    try {
      const abiBytes = await this.chainClient.getRawAbi(contract)
      await this.abiStore.storeAbi(contract, blockNum, abiBytes)
      return abiBytes
    } catch {
      if (this.abiFallback === 'fail') {
        throw new AbiNotFoundError(contract, blockNum, this.abiFallback)
      }
      return null
    }
  }
}
