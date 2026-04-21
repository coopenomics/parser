import { ABI, Serializer } from '@wharfkit/antelope'
import { WharfkitDeserializer } from '../src/deserializers/WharfkitDeserializer.js'
import { createDeserializer } from '../src/deserializers/AbieosDeserializer.js'
import type { ShipTrace } from '../src/types/ship.js'

const abi = ABI.from({
  version: 'eosio::abi/1.0',
  types: [],
  structs: [{ name: 'transfer', base: '', fields: [{ name: 'from', type: 'name' }, { name: 'to', type: 'name' }, { name: 'memo', type: 'string' }] }],
  actions: [{ name: 'transfer', type: 'transfer', ricardian_contract: '' }],
  tables: [],
  variants: [],
})

const actRaw = Serializer.encode({ object: { from: 'alice', to: 'bob', memo: 'benchmark test memo string' }, type: 'transfer', abi }).array

function makeTrace(): ShipTrace {
  return {
    account: 'eosio.token',
    name: 'transfer',
    authorization: [{ actor: 'alice', permission: 'active' }],
    actRaw,
    actionOrdinal: 1,
    globalSequence: 100n,
    receipt: null,
    blockNum: 1,
    blockId: 'a'.repeat(64),
    blockTime: '2024-01-01T00:00:00.000',
    transactionId: 'b'.repeat(64),
  }
}

function bench(name: string, fn: () => void, n = 1000): void {
  const start = Date.now()
  for (let i = 0; i < n; i++) fn()
  const elapsed = Date.now() - start
  console.log(`${name}: ${n} iterations in ${elapsed}ms → ${Math.round(n / (elapsed / 1000))} ops/s`)
}

const wharfkit = new WharfkitDeserializer()
const abieos = createDeserializer('abieos')

console.log(`wharfkit deserializer: ${wharfkit.name}`)
console.log(`abieos deserializer: ${abieos.name}`)
console.log()

bench('wharfkit deserializeAction', () => {
  wharfkit.deserializeAction(makeTrace(), abi)
})

bench('abieos  deserializeAction', () => {
  abieos.deserializeAction(makeTrace(), abi)
})

console.log()
console.log('Target: abieos should be ≥ 3× faster than wharfkit (ADR-06)')
