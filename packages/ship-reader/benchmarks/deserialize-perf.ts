/**
 * Бенчмарк throughput wharfkit-десериализатора.
 *
 * Что меряем:
 *   1. deserializeAction на коротком action'е (transfer с коротким memo)
 *   2. deserializeAction на объёмном action'е (transfer с 256-char memo)
 *   3. deserializeAction на nested struct (updateauth)
 *   4. deserializeContractRow на табличной строке (accounts)
 *   5. replay-сценарий (100 transfer'ов в батче)
 *
 * Запуск:
 *   pnpm --filter @coopenomics/coopos-ship-reader bench
 *
 * Цель: отслеживать регрессии перформанса между версиями wharfkit и
 * нашей ship-reader обёртки. Конкретные цифры зависят от Node/CPU,
 * но относительные изменения внутри одной среды показательны.
 */

import { ABI, Serializer } from '@wharfkit/antelope'
import { WharfkitDeserializer } from '../src/deserializers/WharfkitDeserializer.js'
import type { ShipTrace, ShipDelta } from '../src/types/ship.js'

// ─── ABI и fixtures ──────────────────────────────────────────────────────────

const tokenAbi = ABI.from({
  version: 'eosio::abi/1.1',
  types: [],
  structs: [
    { name: 'transfer', base: '', fields: [
      { name: 'from', type: 'name' },
      { name: 'to', type: 'name' },
      { name: 'quantity', type: 'asset' },
      { name: 'memo', type: 'string' },
    ] },
    // Struct специально назван 'accounts' (совпадает с таблицей), чтобы
    // WharfkitDeserializer мог декодировать row по имени таблицы напрямую.
    { name: 'accounts', base: '', fields: [
      { name: 'balance', type: 'asset' },
    ] },
    { name: 'updateauth', base: '', fields: [
      { name: 'account', type: 'name' },
      { name: 'permission', type: 'name' },
      { name: 'parent', type: 'name' },
      { name: 'auth', type: 'authority' },
    ] },
    { name: 'authority', base: '', fields: [
      { name: 'threshold', type: 'uint32' },
      { name: 'keys', type: 'key_weight[]' },
      { name: 'accounts', type: 'permission_level_weight[]' },
      { name: 'waits', type: 'wait_weight[]' },
    ] },
    { name: 'key_weight', base: '', fields: [
      { name: 'key', type: 'public_key' },
      { name: 'weight', type: 'uint16' },
    ] },
    { name: 'permission_level_weight', base: '', fields: [
      { name: 'permission', type: 'permission_level' },
      { name: 'weight', type: 'uint16' },
    ] },
    { name: 'permission_level', base: '', fields: [
      { name: 'actor', type: 'name' },
      { name: 'permission', type: 'name' },
    ] },
    { name: 'wait_weight', base: '', fields: [
      { name: 'wait_sec', type: 'uint32' },
      { name: 'weight', type: 'uint16' },
    ] },
  ],
  actions: [
    { name: 'transfer', type: 'transfer', ricardian_contract: '' },
    { name: 'updateauth', type: 'updateauth', ricardian_contract: '' },
  ],
  tables: [
    { name: 'accounts', type: 'accounts', index_type: 'i64', key_names: ['id'], key_types: ['uint64'] },
  ],
  variants: [],
})

const shortTransferRaw = Serializer.encode({
  object: { from: 'alice', to: 'bob', quantity: '1.0000 EOS', memo: 'hi' },
  type: 'transfer',
  abi: tokenAbi,
}).array

const bigTransferRaw = Serializer.encode({
  object: {
    from: 'veryveryhigh',
    to: 'anotherhigh1',
    quantity: '123456.7890 AXON',
    memo: 'A'.repeat(256),
  },
  type: 'transfer',
  abi: tokenAbi,
}).array

const updateAuthRaw = Serializer.encode({
  object: {
    account: 'alice',
    permission: 'active',
    parent: 'owner',
    auth: {
      threshold: 1,
      keys: [
        { key: 'EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV', weight: 1 },
      ],
      accounts: [
        { permission: { actor: 'alice', permission: 'owner' }, weight: 1 },
      ],
      waits: [{ wait_sec: 3600, weight: 1 }],
    },
  },
  type: 'updateauth',
  abi: tokenAbi,
}).array

const accountRowRaw = Serializer.encode({
  object: { balance: '1000.0000 EOS' },
  type: 'accounts',
  abi: tokenAbi,
}).array

function makeTrace(raw: Uint8Array, name: string): ShipTrace {
  return {
    account: 'eosio.token',
    name,
    authorization: [{ actor: 'alice', permission: 'active' }],
    actRaw: raw,
    actionOrdinal: 1,
    globalSequence: 100n,
    receipt: null,
    blockNum: 1,
    blockId: 'a'.repeat(64),
    blockTime: '2024-01-01T00:00:00.000',
    transactionId: 'b'.repeat(64),
  }
}

function makeDelta(raw: Uint8Array, table: string): ShipDelta {
  return {
    name: 'contract_row',
    present: true,
    rowRaw: raw,
    code: 'eosio.token',
    scope: 'alice',
    table,
    primaryKey: '1',
  }
}

// ─── Измерение ───────────────────────────────────────────────────────────────

interface BenchResult {
  scenario: string
  ops: number
  elapsedMs: number
  opsPerSec: number
  usPerOp: number
}

function bench(scenario: string, fn: () => void, iterations: number): BenchResult {
  // Warmup = 10% от итераций, минимум 500 — прогревает JIT перед замерами
  const warmup = Math.max(500, Math.floor(iterations / 10))
  for (let i = 0; i < warmup; i++) fn()

  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) fn()
  const end = process.hrtime.bigint()

  const elapsedNs = Number(end - start)
  return {
    scenario,
    ops: iterations,
    elapsedMs: elapsedNs / 1_000_000,
    opsPerSec: (iterations / elapsedNs) * 1_000_000_000,
    usPerOp: elapsedNs / iterations / 1000,
  }
}

function printTable(rows: BenchResult[]): void {
  console.log()
  console.log('Scenario                            │ Throughput           │ Latency')
  console.log('────────────────────────────────────┼──────────────────────┼──────────')
  for (const r of rows) {
    const tp = `${Math.round(r.opsPerSec).toLocaleString()} ops/s`
    const lat = `${r.usPerOp.toFixed(2)}µs / op`
    console.log(`${r.scenario.padEnd(36)}│ ${tp.padEnd(21)}│ ${lat}`)
  }
  console.log()
}

// ─── Прогон ──────────────────────────────────────────────────────────────────

const deser = new WharfkitDeserializer()

console.log(`Node: ${process.version}, platform: ${process.platform} ${process.arch}`)
console.log(`Deserializer: ${deser.name}`)

const N_SMALL = 50_000
const N_LARGE = 10_000
const N_REPLAY = 2_000
const BATCH = 100

const shortTrace = makeTrace(shortTransferRaw, 'transfer')
const bigTrace = makeTrace(bigTransferRaw, 'transfer')
const authTrace = makeTrace(updateAuthRaw, 'updateauth')
const rowDelta = makeDelta(accountRowRaw, 'accounts')

const results: BenchResult[] = [
  bench(`transfer (short memo)       × ${N_SMALL}`,
    () => { deser.deserializeAction(shortTrace, tokenAbi) }, N_SMALL),

  bench(`transfer (256-char memo)    × ${N_SMALL}`,
    () => { deser.deserializeAction(bigTrace, tokenAbi) }, N_SMALL),

  bench(`updateauth (nested struct)  × ${N_LARGE}`,
    () => { deser.deserializeAction(authTrace, tokenAbi) }, N_LARGE),

  bench(`contract_row accounts       × ${N_SMALL}`,
    () => { deser.deserializeContractRow(rowDelta, tokenAbi) }, N_SMALL),

  bench(`replay batch (100 transfers) × ${N_REPLAY}`,
    () => {
      for (let i = 0; i < BATCH; i++) deser.deserializeAction(shortTrace, tokenAbi)
    }, N_REPLAY),
]

printTable(results)
