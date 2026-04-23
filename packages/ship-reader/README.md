# @coopenomics/coopos-ship-reader

Clean-room SHiP WebSocket client for EOSIO/Antelope blockchains. Streams blockchain blocks, deserializes actions and deltas via `@wharfkit/antelope`, with support for all 24 native system table delta types.

Primary consumer: [`@coopenomics/parser2`](https://github.com/coopenomics/parser2).

## Installation

```bash
pnpm add @coopenomics/coopos-ship-reader
```

## Quickstart

```typescript
import { ShipClient } from '@coopenomics/coopos-ship-reader'

const client = new ShipClient({
  ship: { url: 'ws://nodeos-ship:8080' },
  chain: { url: 'https://rpc.coopenomics.world' },
})

await client.connect()
const { chainId } = await client.handshake()
console.log('chain:', chainId)

for await (const block of client.streamBlocks({ startBlock: 1, fetchTraces: true, fetchDeltas: true })) {
  console.log('block', block.thisBlock.blockNum, '— traces:', block.traces.length)
  // deserialize actions with contract ABI
  // const action = client.deserializer.deserializeAction(trace, contractAbi)
}
```

## Performance

Deserialization uses `@wharfkit/antelope` (pure JS, cross-platform).

Throughput on real-world payloads (Ubuntu 24.04, Node 22):

| Scenario                              | Throughput  |
|---------------------------------------|-------------|
| transfer (short memo)                 | ~22k ops/s  |
| transfer (256-char memo)              | ~21k ops/s  |
| updateauth (nested struct)            | ~9.5k ops/s |
| contract_row (accounts)               | ~34k ops/s  |

Baseline for regression tracking — run locally:

```bash
pnpm --filter @coopenomics/coopos-ship-reader bench
```

## License

MIT. See [NOTICE](./NOTICE) for third-party attributions.
