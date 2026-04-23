/**
 * verifier-like example
 *
 * Demonstrates running Parser (indexer) and ParserClient (consumer) in one
 * process.  The consumer subscribes to native `permission` table deltas and
 * prints every account-key change to stdout.
 *
 * See README.md for the 5-step startup guide.
 */

import { Parser, ParserClient } from '@coopenomics/parser2'
import type { NativeDeltaEvent, NativePermissionRow } from '@coopenomics/parser2'

// ── Configuration ────────────────────────────────────────────────────────────

const CHAIN_ID = process.env['CHAIN_ID'] ?? 'eos-mainnet'
const SHIP_URL = process.env['SHIP_URL'] ?? 'ws://localhost:29999'
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
const SUB_ID = process.env['SUB_ID'] ?? 'verifier'

// ── Parser (indexer side) ─────────────────────────────────────────────────────

const parser = Parser.fromConfig({
  ship: { url: SHIP_URL },
  redis: { url: REDIS_URL },
  chain: { id: CHAIN_ID },
  logger: { level: 'info' },
  noSignalHandlers: true,
})

// ── ParserClient (consumer side) ──────────────────────────────────────────────

const client = new ParserClient({
  redis: { url: REDIS_URL },
  chainId: CHAIN_ID,
  subId: SUB_ID,
  startFrom: 'last_known',
  filters: [{ kind: 'native-delta', table: 'permission' }],
})

// ── Permission handler ────────────────────────────────────────────────────────

async function handlePermissionDelta(event: NativeDeltaEvent<NativePermissionRow>): Promise<void> {
  const perm = event.data
  if (!event.present) {
    console.log(`[${event.block_num}] permission REMOVED: ${String(perm.owner)}@${String(perm.name)}`)
    return
  }
  console.log(
    `[${event.block_num}] permission UPSERT: ${String(perm.owner)}@${String(perm.name)}`,
    JSON.stringify(perm.auth),
  )
}

// ── Wiring ────────────────────────────────────────────────────────────────────

client.on('native-delta', async (event) => {
  if (event.table === 'permission') {
    await handlePermissionDelta(event as NativeDeltaEvent<NativePermissionRow>)
  }
})

client.on('error', (err) => {
  console.error('Consumer error:', err)
})

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Starting verifier-like example for chain: ${CHAIN_ID}`)

  const [, consumerResult] = await Promise.allSettled([
    parser.start(),
    client.start(),
  ])

  if (consumerResult.status === 'rejected') {
    console.error('Consumer exited with error:', consumerResult.reason)
    process.exitCode = 1
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.log('Shutting down…')
  await Promise.all([parser.stop(), client.stop()])
  process.exit(0)
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

void main()
