import WebSocket from 'ws'
import { parseShipAbi, encodeRequest, decodeResult, decodeStatusResult } from './ShipProtocol.js'
import type { ShipAbi } from './ShipProtocol.js'
import { createBlockStream } from './BlockStream.js'
import { WharfkitDeserializer } from './deserializers/WharfkitDeserializer.js'
import { getChainInfo as rpcGetChainInfo, getRawAbi as rpcGetRawAbi } from './rpc.js'
import { ShipConnectionError } from './errors.js'
import type { ShipBlock, ShipClientOptions, GetBlocksOptions, ChainInfo, BlockPosition } from './types/ship.js'
import type { Deserializer } from './deserializers/Deserializer.js'

const HANDSHAKE_TIMEOUT_MS = 10_000

export class ShipClient {
  private ws: WebSocket | null = null
  private shipAbi: ShipAbi | null = null
  private chainId: string | null = null
  private lastIrreversible: BlockPosition | null = null
  readonly deserializer: Deserializer

  constructor(private readonly opts: ShipClientOptions) {
    this.deserializer = new WharfkitDeserializer()
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return

    await new Promise<void>((resolve, reject) => {
      const timeoutMs = this.opts.ship.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
      let resolved = false

      const done = (err?: unknown): void => {
        if (resolved) return
        resolved = true
        clearTimeout(timer)
        if (err) reject(err)
        else resolve()
      }

      const timer = setTimeout(() => {
        done(new ShipConnectionError(`SHiP connection/ABI timeout after ${timeoutMs}ms`))
        this.ws?.terminate()
      }, timeoutMs)

      this.ws = new WebSocket(this.opts.ship.url)
      this.ws.binaryType = 'nodebuffer'

      // Register message listener BEFORE 'open' fires to avoid missing early ABI message
      this.ws.once('message', (data: Buffer) => {
        try {
          this.shipAbi = parseShipAbi(data.toString('utf8'))
          done()
        } catch (err) {
          done(err)
        }
      })

      this.ws.once('error', (err: Error) => {
        done(new ShipConnectionError('SHiP WebSocket connection failed', err))
      })

      this.ws.once('close', (code: number) => {
        done(new ShipConnectionError(`SHiP connection closed unexpectedly (code ${code})`))
      })
    })
  }

  async handshake(): Promise<{ chainId: string; lastIrreversible: BlockPosition }> {
    if (!this.ws || !this.shipAbi) throw new ShipConnectionError('Call connect() first')
    if (this.chainId) {
      return { chainId: this.chainId, lastIrreversible: this.lastIrreversible! }
    }

    const ws = this.ws
    const abi = this.shipAbi

    const statusRequest = encodeRequest(['get_status_request_v0', {}], abi)
    ws.send(Buffer.from(statusRequest))

    const [, statusRaw] = await new Promise<[string, unknown]>((resolve, reject) => {
      const timeoutMs = this.opts.ship.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
      const timer = setTimeout(() => {
        reject(new ShipConnectionError('Timed out waiting for get_status_result_v0'))
      }, timeoutMs)

      ws.once('message', (data: Buffer) => {
        clearTimeout(timer)
        try {
          resolve(decodeResult(new Uint8Array(data), abi))
        } catch (err) {
          reject(err)
        }
      })

      ws.once('error', (err: Error) => {
        clearTimeout(timer)
        reject(new ShipConnectionError('Error during handshake', err))
      })
    })

    const status = decodeStatusResult(statusRaw)
    this.chainId = status.chainId
    this.lastIrreversible = status.lastIrreversible

    return { chainId: this.chainId, lastIrreversible: this.lastIrreversible }
  }

  async *streamBlocks(opts: GetBlocksOptions): AsyncGenerator<ShipBlock> {
    if (!this.ws || !this.shipAbi) throw new ShipConnectionError('Call connect() and handshake() first')
    yield* createBlockStream(this.ws, this.shipAbi, opts)
  }

  ack(numMessages: number): void {
    if (!this.ws || !this.shipAbi) throw new ShipConnectionError('Not connected')
    const bytes = encodeRequest(['get_blocks_ack_request_v0', { num_messages: numMessages }], this.shipAbi)
    this.ws.send(Buffer.from(bytes))
  }

  async getChainInfo(): Promise<ChainInfo> {
    if (!this.opts.chain) throw new Error('chain.url not configured')
    return rpcGetChainInfo(this.opts.chain.url)
  }

  async getRawAbi(accountName: string): Promise<Uint8Array> {
    if (!this.opts.chain) throw new Error('chain.url not configured')
    return rpcGetRawAbi(this.opts.chain.url, accountName)
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }
}
