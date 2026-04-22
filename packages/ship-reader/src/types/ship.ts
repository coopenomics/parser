export interface BlockPosition {
  readonly blockNum: number
  readonly blockId: string
}

export interface ActionAuthorization {
  readonly actor: string
  readonly permission: string
}

export interface ActionReceipt {
  readonly receiver: string
  readonly actDigest: string
  readonly globalSequence: bigint
  readonly recvSequence: bigint
  readonly codeSequence: number
  readonly abiSequence: number
}

export interface ShipTrace {
  readonly account: string
  readonly name: string
  readonly authorization: readonly ActionAuthorization[]
  readonly actRaw: Uint8Array
  readonly actionOrdinal: number
  readonly globalSequence: bigint
  readonly receipt: ActionReceipt | null
  readonly blockNum: number
  readonly blockId: string
  readonly blockTime: string
  readonly transactionId: string
}

export interface ShipDelta {
  readonly name: string
  readonly present: boolean
  readonly rowRaw: Uint8Array
  readonly code?: string
  readonly scope?: string
  readonly table?: string
  readonly primaryKey?: string
}

export interface ShipBlock {
  readonly thisBlock: BlockPosition
  readonly head: BlockPosition
  readonly lastIrreversible: BlockPosition
  readonly prevBlock: BlockPosition | null
  readonly traces: readonly ShipTrace[]
  readonly deltas: readonly ShipDelta[]
}

export interface Action<T = Record<string, unknown>> {
  readonly account: string
  readonly name: string
  readonly authorization: readonly ActionAuthorization[]
  readonly data: T
  readonly actionOrdinal: number
  readonly globalSequence: bigint
  readonly receipt: ActionReceipt | null
}

export interface Delta<T = Record<string, unknown>> {
  readonly code: string
  readonly scope: string
  readonly table: string
  readonly primaryKey: string
  readonly present: boolean
  readonly value: T
}

export interface ChainInfo {
  readonly chain_id: string
  readonly head_block_num: number
  readonly head_block_id: string
  readonly head_block_time: string
  readonly last_irreversible_block_num: number
  readonly last_irreversible_block_id: string
  readonly server_version_string?: string
}

export interface GetBlocksOptions {
  readonly startBlock: number
  readonly endBlock?: number
  readonly maxMessagesInFlight?: number
  readonly havePositions?: readonly BlockPosition[]
  readonly irreversibleOnly?: boolean
  readonly fetchBlock?: boolean
  readonly fetchTraces?: boolean
  readonly fetchDeltas?: boolean
}

export interface ShipClientOptions {
  readonly ship: { readonly url: string; readonly timeoutMs?: number }
  readonly chain?: { readonly url: string }
}
