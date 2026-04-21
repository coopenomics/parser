import WebSocket from 'ws'
import type { ShipAbi } from './ShipProtocol.js'
import { encodeRequest, decodeResult, decodeBlocksResult } from './ShipProtocol.js'
import type { ShipBlock, GetBlocksOptions } from './types/ship.js'
import { ShipConnectionError } from './errors.js'

const MAX_MESSAGES_IN_FLIGHT_DEFAULT = 10

export async function* createBlockStream(
  ws: WebSocket,
  abi: ShipAbi,
  opts: GetBlocksOptions,
): AsyncGenerator<ShipBlock> {
  const maxFlight = opts.maxMessagesInFlight ?? MAX_MESSAGES_IN_FLIGHT_DEFAULT

  const request: [string, Record<string, unknown>] = [
    'get_blocks_request_v0',
    {
      start_block_num: opts.startBlock,
      end_block_num: opts.endBlock ?? 0xffffffff,
      max_messages_in_flight: maxFlight,
      have_positions: (opts.havePositions ?? []).map(p => ({
        block_num: p.blockNum,
        block_id: p.blockId,
      })),
      irreversible_only: opts.irreversibleOnly ?? false,
      fetch_block: opts.fetchBlock ?? true,
      fetch_traces: opts.fetchTraces ?? true,
      fetch_deltas: opts.fetchDeltas ?? true,
    },
  ]

  ws.send(Buffer.from(encodeRequest(request, abi)))

  const queue: Array<{ data: Buffer; resolve: () => void }> = []
  let waitResolve: (() => void) | null = null
  let closed = false
  let closeError: Error | null = null

  ws.on('message', (data: Buffer) => {
    if (waitResolve) {
      const r = waitResolve
      waitResolve = null
      queue.push({ data, resolve: () => {} })
      r()
    } else {
      queue.push({ data, resolve: () => {} })
    }
  })

  ws.on('close', (code: number, reason: Buffer) => {
    closed = true
    const msg = reason.length > 0 ? reason.toString() : `code ${code}`
    closeError = new ShipConnectionError(`SHiP WebSocket closed: ${msg}`)
    if (waitResolve) {
      waitResolve()
      waitResolve = null
    }
  })

  ws.on('error', (err: Error) => {
    closed = true
    closeError = new ShipConnectionError('SHiP WebSocket error', err)
    if (waitResolve) {
      waitResolve()
      waitResolve = null
    }
  })

  async function nextMessage(): Promise<Buffer | null> {
    while (queue.length === 0) {
      if (closed) return null
      await new Promise<void>(res => {
        waitResolve = res
      })
    }
    const item = queue.shift()
    return item?.data ?? null
  }

  let blockNum = opts.startBlock
  let blockTime = new Date().toISOString()

  while (true) {
    const msg = await nextMessage()
    if (msg === null) {
      if (closeError) throw closeError
      return
    }

    const [type, raw] = decodeResult(new Uint8Array(msg), abi)
    if (type !== 'get_blocks_result_v0') continue

    const block = decodeBlocksResult(raw, abi, blockNum, '', blockTime)
    blockNum = block.thisBlock.blockNum

    yield block

    ws.send(
      Buffer.from(
        encodeRequest(['get_blocks_ack_request_v0', { num_messages: 1 }], abi),
      ),
    )
  }
}
