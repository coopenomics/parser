import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws'
import { ShipClient } from '../../src/ShipClient.js'
import { ShipConnectionError } from '../../src/errors.js'

const MOCK_SHIP_ABI = JSON.stringify({
  version: 'eosio::abi/1.0',
  types: [],
  structs: [
    { name: 'block_position', base: '', fields: [{ name: 'block_num', type: 'uint32' }, { name: 'block_id', type: 'checksum256' }] },
    { name: 'get_status_request_v0', base: '', fields: [] },
    { name: 'get_status_result_v0', base: '', fields: [
      { name: 'head', type: 'block_position' },
      { name: 'last_irreversible', type: 'block_position' },
      { name: 'trace_begin_block', type: 'uint32' },
      { name: 'trace_end_block', type: 'uint32' },
      { name: 'chain_state_begin_block', type: 'uint32' },
      { name: 'chain_state_end_block', type: 'uint32' },
      { name: 'chain_id', type: 'checksum256?' },
    ]},
    { name: 'get_blocks_request_v0', base: '', fields: [
      { name: 'start_block_num', type: 'uint32' }, { name: 'end_block_num', type: 'uint32' },
      { name: 'max_messages_in_flight', type: 'uint32' }, { name: 'have_positions', type: 'block_position[]' },
      { name: 'irreversible_only', type: 'bool' }, { name: 'fetch_block', type: 'bool' },
      { name: 'fetch_traces', type: 'bool' }, { name: 'fetch_deltas', type: 'bool' },
    ]},
    { name: 'get_blocks_ack_request_v0', base: '', fields: [{ name: 'num_messages', type: 'uint32' }] },
    { name: 'get_blocks_result_v0', base: '', fields: [
      { name: 'head', type: 'block_position' }, { name: 'last_irreversible', type: 'block_position' },
      { name: 'this_block', type: 'block_position?' }, { name: 'prev_block', type: 'block_position?' },
      { name: 'block', type: 'bytes?' }, { name: 'traces', type: 'bytes?' }, { name: 'deltas', type: 'bytes?' },
    ]},
  ],
  actions: [],
  tables: [],
  variants: [
    { name: 'request', types: ['get_status_request_v0', 'get_blocks_request_v0', 'get_blocks_ack_request_v0'] },
    { name: 'result', types: ['get_status_result_v0', 'get_blocks_result_v0'] },
  ],
})

let portCounter = 19100

async function createServer(): Promise<{ server: WebSocketServer; port: number }> {
  const port = portCounter++
  const server = await new Promise<WebSocketServer>((resolve) => {
    const wss = new WebSocketServer({ port, host: '127.0.0.1' }, () => resolve(wss))
  })
  return { server, port }
}

async function closeServer(server: WebSocketServer): Promise<void> {
  server.clients.forEach(c => c.terminate())
  await new Promise<void>(resolve => server.close(() => resolve()))
}

describe('ShipClient — connect & handshake', () => {
  let server: WebSocketServer
  let port: number

  beforeEach(async () => {
    const s = await createServer()
    server = s.server
    port = s.port
  })

  afterEach(async () => {
    await closeServer(server)
  })

  it('connects and receives ABI on first message', async () => {
    server.on('connection', (ws) => ws.send(MOCK_SHIP_ABI))
    const client = new ShipClient({ ship: { url: `ws://127.0.0.1:${port}`, timeoutMs: 3000 } })
    await client.connect()
    client.close()
  }, 10000)

  it('throws ShipConnectionError on timeout waiting for ABI', async () => {
    // server connects but never sends ABI
    const client = new ShipClient({ ship: { url: `ws://127.0.0.1:${port}`, timeoutMs: 200 } })
    await expect(client.connect()).rejects.toBeInstanceOf(ShipConnectionError)
  }, 5000)

  it('connect() is idempotent when already open', async () => {
    server.on('connection', (ws) => ws.send(MOCK_SHIP_ABI))
    const client = new ShipClient({ ship: { url: `ws://127.0.0.1:${port}`, timeoutMs: 3000 } })
    await client.connect()
    await client.connect() // no-op
    client.close()
  }, 10000)

  it('throws ShipConnectionError when status request times out', async () => {
    server.on('connection', (ws) => {
      ws.send(MOCK_SHIP_ABI)
      // never responds to status request
    })
    const client = new ShipClient({ ship: { url: `ws://127.0.0.1:${port}`, timeoutMs: 200 } })
    await client.connect()
    await expect(client.handshake()).rejects.toBeInstanceOf(ShipConnectionError)
    client.close()
  }, 5000)

  it('throws ShipProtocolError on invalid ABI payload', async () => {
    server.on('connection', (ws) => ws.send('not-json{{'))
    const client = new ShipClient({ ship: { url: `ws://127.0.0.1:${port}`, timeoutMs: 3000 } })
    await expect(client.connect()).rejects.toThrow()
    client.close()
  }, 10000)
})

describe('ShipClient — RPC helpers (mocked fetch)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getChainInfo calls correct endpoint', async () => {
    const mockChainInfo = {
      chain_id: 'a'.repeat(64),
      head_block_num: 100,
      head_block_id: 'b'.repeat(64),
      head_block_time: '2024-01-01T00:00:00.000',
      last_irreversible_block_num: 90,
      last_irreversible_block_id: 'c'.repeat(64),
    }
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockChainInfo),
    } as Response)

    const client = new ShipClient({
      ship: { url: 'ws://localhost:8080' },
      chain: { url: 'https://rpc.example.com' },
    })
    const info = await client.getChainInfo()
    expect(info.chain_id).toBe(mockChainInfo.chain_id)
    expect(fetch).toHaveBeenCalledWith(
      'https://rpc.example.com/v1/chain/get_info',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('getRawAbi decodes base64 response', async () => {
    const abi = Buffer.from('{"version":"eosio::abi/1.0"}').toString('base64')
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ account_name: 'eosio', abi_hash: 'aa', abi }),
    } as Response)

    const client = new ShipClient({
      ship: { url: 'ws://localhost:8080' },
      chain: { url: 'https://rpc.example.com' },
    })
    const raw = await client.getRawAbi('eosio')
    expect(raw).toBeInstanceOf(Uint8Array)
    expect(raw.length).toBeGreaterThan(0)
  })
})
