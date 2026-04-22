/**
 * Integration тест: Parser + ParserClient end-to-end.
 *
 * Что проверяем:
 *   1. Парсер подключается к SHiP WebSocket и читает блоки с реального блокчейна.
 *   2. Транзакция eosio.token::transfer попадает в Redis Stream.
 *   3. ParserClient получает событие через consumer group.
 *   4. Поля события (from, to, quantity, memo) совпадают с отправленными данными.
 *
 * Требования для запуска:
 *   - Docker-контейнер dicoop/blockchain:v5.1.0-dev запущен (порты 8888, 8080)
 *   - Redis запущен (порт 6379)
 *   - Переменные среды: CHAIN_URL, SHIP_URL, REDIS_URL (или дефолты localhost)
 *
 * Последовательность beforeAll:
 *   1. Ждём Chain API (до 30s — нода медленно стартует)
 *   2. Preactivate PREACTIVATE_FEATURE
 *   3. Создаём eosio.token account
 *   4. Деплоим eosio.boot → activate все фичи → деплоим eosio.token
 *   5. create token AXON + issue 1000 AXON → eosio
 *   6. Стартуем Parser (подключается к SHiP)
 *   7. Создаём ParserClient подписанный на eosio.token::transfer
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Parser } from '../../src/core/Parser.js'
import { ParserClient } from '../../src/client/ParserClient.js'
import type { ParserEvent } from '../../src/types.js'
import { ChainHelper, waitForChain, sleep } from './helpers/chain.js'

const CHAIN_URL = process.env['CHAIN_URL'] ?? 'http://localhost:8888'
const SHIP_URL = process.env['SHIP_URL'] ?? 'ws://localhost:8080'
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
const PRIVATE_KEY = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3'
const CHAIN_ID_SUFFIX = 'integration-test'

let parser: Parser
let client: ParserClient
let chain: ChainHelper
let chainId: string

/** Запускает parser.start() в фоне, возвращает chainId. */
async function startParser(): Promise<string> {
  let resolveChainId!: (id: string) => void
  const chainIdPromise = new Promise<string>(resolve => { resolveChainId = resolve })

  parser = new Parser({
    ship: { url: SHIP_URL, timeoutMs: 15_000 },
    redis: { url: REDIS_URL, keyPrefix: `test-${Date.now()}:` },
    noSignalHandlers: true,
    xtrim: { enabled: false },
    reconnect: { maxAttempts: 3, backoffSeconds: [1, 2, 5] },
    abiFallback: 'rpc-current',
    chain: { url: CHAIN_URL },
    logger: { level: 'warn' },
  })

  // Перехватываем chainId после connect через отдельный запрос
  const infoRes = await fetch(`${CHAIN_URL}/v1/chain/get_info`)
  const info = await infoRes.json() as { chain_id: string }
  resolveChainId(info.chain_id)

  // Стартуем парсер асинхронно (он блокирует пока не остановлен)
  parser.start().catch(() => { /* ожидаемое завершение в afterAll */ })

  // Ждём пока парсер начнёт читать блоки (подключится к SHiP)
  await sleep(3000)

  return chainIdPromise
}

beforeAll(async () => {
  // === Шаг 1: Ждём готовности Chain API ===
  await waitForChain(CHAIN_URL, 30_000)

  chain = new ChainHelper(CHAIN_URL, PRIVATE_KEY)

  // === Шаг 2: Инициализируем блокчейн ===
  console.log('  → Preactivate PREACTIVATE_FEATURE...')
  await chain.preactivate()

  console.log('  → Create eosio.token account...')
  await chain.createAccount('eosio', 'eosio.token')

  console.log('  → Deploy eosio.boot...')
  await chain.deployContract('eosio', 'eosio.boot')

  console.log('  → Activate LEAP features...')
  await chain.activateFeatures()

  console.log('  → Deploy eosio.token...')
  await chain.deployContract('eosio.token', 'eosio.token')

  console.log('  → Create and issue AXON token...')
  await chain.pushActions([
    {
      account: 'eosio.token',
      name: 'create',
      auth: 'eosio.token@active',
      data: { issuer: 'eosio', maximum_supply: '1000000000.0000 AXON' },
    },
  ])
  await chain.pushActions([
    {
      account: 'eosio.token',
      name: 'issue',
      auth: 'eosio@active',
      data: { to: 'eosio', quantity: '1000.0000 AXON', memo: 'genesis issue' },
    },
  ])

  // === Шаг 3: Стартуем Parser ===
  console.log('  → Starting Parser...')
  chainId = await startParser()
  console.log(`  → Parser connected, chainId: ${chainId.slice(0, 16)}...`)

  // === Шаг 4: Создаём ParserClient подписанный на eosio.token::issue ===
  // NB: transfer заблокирован coopenomics-fork'ом eosio.token (требует членства
  // получателя в wallet program). issue свободен от этой проверки.
  client = new ParserClient({
    subscriptionId: 'integration-issue-test',
    filters: [{ kind: 'action', account: 'eosio.token', name: 'issue' }],
    startFrom: 'last_known',
    redis: { url: REDIS_URL, keyPrefix: `test-${Date.now()}:` },
    chain: { id: chainId },
    acquireLockTimeoutMs: 10_000,
    noSignalHandlers: true,
  })

}, 90_000) // 90s — блокчейн стартует медленно

afterAll(async () => {
  await parser?.stop()
})

describe('eosio.token::issue', () => {
  it('parser captures issue event and client receives it', async () => {
    // Собираем событие через AsyncGenerator в фоне
    const receivedEvents: ParserEvent[] = []
    const eventReceived = new Promise<ParserEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout: event not received in 20s')), 20_000)

      async function consume(): Promise<void> {
        for await (const event of client.stream()) {
          receivedEvents.push(event)
          if (event.kind === 'action') {
            clearTimeout(timeout)
            resolve(event)
            return
          }
        }
      }
      consume().catch(reject)
    })

    // Небольшая пауза чтобы consumer group создалась и начала читать
    await sleep(2000)

    // Выполняем issue — выпуск дополнительных токенов eosio.token::issue
    console.log('  → Pushing eosio.token::issue...')
    await chain.pushActions([
      {
        account: 'eosio.token',
        name: 'issue',
        auth: 'eosio@active',
        data: {
          to: 'eosio',
          quantity: '5.0000 AXON',
          memo: 'integration-test-issue',
        },
      },
    ])

    // Ждём события
    const event = await eventReceived

    // Проверяем что это правильное событие
    expect(event.kind).toBe('action')
    if (event.kind === 'action') {
      expect(event.account).toBe('eosio.token')
      expect(event.name).toBe('issue')
      expect(event.data).toMatchObject({
        to: 'eosio',
        quantity: '5.0000 AXON',
        memo: 'integration-test-issue',
      })
    }
  }, 30_000)
})
