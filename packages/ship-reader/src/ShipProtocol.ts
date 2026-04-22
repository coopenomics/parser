import { ABI, Serializer, Bytes } from '@wharfkit/antelope'
import { ShipProtocolError } from './errors.js'
import type { BlockPosition, ShipBlock, ShipTrace, ShipDelta, ActionReceipt, ActionAuthorization } from './types/ship.js'

export type ShipAbi = ABI

export function parseShipAbi(text: string): ShipAbi {
  try {
    const def = JSON.parse(text) as Record<string, unknown>
    return ABI.from(def)
  } catch (err) {
    throw new ShipProtocolError('Failed to parse SHiP ABI from server', err)
  }
}

export function encodeRequest(variant: [string, unknown], abi: ShipAbi): Uint8Array {
  const bytes = Serializer.encode({ object: variant, type: 'request', abi })
  return bytes.array
}

export function decodeResult(data: Uint8Array, abi: ShipAbi): [string, unknown] {
  try {
    const decoded = Serializer.decode({ data, type: 'result', abi })
    return decoded as [string, unknown]
  } catch (err) {
    throw new ShipProtocolError('Failed to decode SHiP result message', err)
  }
}

interface RawStatusResult {
  chain_id: string
  head: RawBlockPos
  last_irreversible: RawBlockPos
}

interface RawBlockPos {
  block_num: number
  block_id: string
}

interface RawBlocksResult {
  head: RawBlockPos
  last_irreversible: RawBlockPos
  this_block: RawBlockPos | null
  prev_block: RawBlockPos | null
  traces: Bytes | null
  deltas: Bytes | null
}

interface RawTransactionTrace {
  id: string
  action_traces: RawActionTrace[]
}

interface RawActionTrace {
  act: {
    account: string
    name: string
    authorization: Array<{ actor: string; permission: string }>
    data: Bytes
  }
  receipt: RawActionReceipt | null
  action_ordinal: number
  global_sequence: string
}

interface RawActionReceipt {
  receiver: string
  act_digest: string
  global_sequence: string
  recv_sequence: string
  code_sequence: number
  abi_sequence: number
}

interface RawTableDelta {
  name: string
  rows: Array<{ present: boolean; data: Bytes }>
}

interface RawContractRow {
  code: string
  scope: string
  table: string
  primary_key: string
  payer: string
  value: Bytes
}

function decodeVector<T>(data: Bytes | null, type: string, abi: ShipAbi): T[] {
  if (!data || data.length === 0) return []
  try {
    return Serializer.decode({ data: data.array, type: `${type}[]`, abi }) as T[]
  } catch {
    return []
  }
}

export function decodeStatusResult(raw: unknown): { chainId: string; head: BlockPosition; lastIrreversible: BlockPosition } {
  const r = raw as RawStatusResult
  return {
    chainId: r.chain_id,
    head: { blockNum: r.head.block_num, blockId: r.head.block_id },
    lastIrreversible: { blockNum: r.last_irreversible.block_num, blockId: r.last_irreversible.block_id },
  }
}

export function decodeBlocksResult(raw: unknown, abi: ShipAbi, blockNum: number, blockId: string, blockTime: string): ShipBlock {
  const r = raw as RawBlocksResult

  const head: BlockPosition = { blockNum: r.head.block_num, blockId: r.head.block_id }
  const lastIrreversible: BlockPosition = { blockNum: r.last_irreversible.block_num, blockId: r.last_irreversible.block_id }
  const thisBlock: BlockPosition = r.this_block
    ? { blockNum: r.this_block.block_num, blockId: r.this_block.block_id }
    : { blockNum: blockNum, blockId: blockId }
  const prevBlock: BlockPosition | null = r.prev_block
    ? { blockNum: r.prev_block.block_num, blockId: r.prev_block.block_id }
    : null

  const txTraces = decodeVector<[string, RawTransactionTrace]>(r.traces, 'transaction_trace', abi)
  const tableDeltaVariants = decodeVector<[string, RawTableDelta]>(r.deltas, 'table_delta', abi)

  const traces: ShipTrace[] = []
  for (const txVariant of txTraces) {
    const tx = txVariant[1]
    if (!tx) continue
    for (const atVariant of tx.action_traces ?? []) {
      const at = Array.isArray(atVariant) ? (atVariant[1] as RawActionTrace) : (atVariant as RawActionTrace)
      if (!at?.act) continue

      const authorization: ActionAuthorization[] = (at.act.authorization ?? []).map(a => ({
        actor: a.actor,
        permission: a.permission,
      }))

      // at.receipt может быть variant-tuple [variantName, data] (wharfkit decode variant)
      // или уже развёрнутым объектом. Обрабатываем оба случая.
      const receiptData = Array.isArray(at.receipt)
        ? (at.receipt[1] as RawActionTrace['receipt'])
        : at.receipt
      const receipt: ActionReceipt | null = receiptData
        ? ({
            receiver: receiptData.receiver,
            actDigest: receiptData.act_digest,
            globalSequence: BigInt(receiptData.global_sequence),
            recvSequence: BigInt(receiptData.recv_sequence),
            codeSequence: receiptData.code_sequence,
            abiSequence: receiptData.abi_sequence,
          } as ActionReceipt)
        : null

      traces.push({
        account: at.act.account,
        name: at.act.name,
        authorization,
        actRaw: at.act.data instanceof Bytes ? at.act.data.array : Uint8Array.from([]),
        actionOrdinal: at.action_ordinal,
        globalSequence: BigInt(at.global_sequence),
        receipt,
        blockNum: thisBlock.blockNum,
        blockId: thisBlock.blockId,
        blockTime,
        transactionId: tx.id,
      })
    }
  }

  const deltas: ShipDelta[] = []
  for (const dtVariant of tableDeltaVariants) {
    const dt = dtVariant[1]
    if (!dt) continue
    for (const row of dt.rows ?? []) {
      if (dt.name === 'contract_row') {
        try {
          const rowDecoded = Serializer.decode({ data: row.data.array, type: 'contract_row', abi }) as [string, RawContractRow]
          const cr = Array.isArray(rowDecoded) ? rowDecoded[1] : (rowDecoded as unknown as RawContractRow)
          if (!cr) continue
          deltas.push({
            name: 'contract_row',
            present: row.present,
            rowRaw: cr.value instanceof Bytes ? cr.value.array : Uint8Array.from([]),
            code: cr.code,
            scope: cr.scope,
            table: cr.table,
            primaryKey: cr.primary_key,
          })
        } catch {
          // skip malformed row
        }
      } else {
        deltas.push({
          name: dt.name,
          present: row.present,
          rowRaw: row.data instanceof Bytes ? row.data.array : Uint8Array.from([]),
        })
      }
    }
  }

  return { thisBlock, head, lastIrreversible, prevBlock, traces, deltas }
}
