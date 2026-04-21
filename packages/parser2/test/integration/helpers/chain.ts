/**
 * Минималистичный помощник для деплоя контрактов и выполнения транзакций
 * в тестовой EOSIO/Antelope ноде через Chain API.
 *
 * Использует @wharfkit/antelope для сериализации транзакций и подписи.
 * Не требует установки cleos или дополнительных зависимостей.
 *
 * Последовательность инициализации блокчейна для integration-тестов:
 *   1. preactivate() — активирует протокольную фичу PREACTIVATE_FEATURE
 *   2. createAccount() — создаёт системные аккаунты
 *   3. deployContract('eosio', 'eosio.boot') — деплоим eosio.boot
 *   4. activateFeatures() — активируем все LEAP фичи через eosio.boot::activate
 *   5. deployContract('eosio.token', 'eosio.token') — деплоим токен
 *   6. Создаём токен, выпускаем, переводим
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APIClient,
  FetchProvider,
  PrivateKey,
  Transaction,
  SignedTransaction,
  Action,
  PermissionLevel,
  ABI,
  Serializer,
  Bytes,
  Name,
  Checksum256,
} from '@wharfkit/antelope'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTRACTS_DIR = join(__dirname, '../contracts')

/** Хэш фичи PREACTIVATE_FEATURE (первый шаг перед деплоем eosio.boot). */
const PREACTIVATE_HASH = '0ec7e080177b2c02b278d5088611686b49d739925a92d9bfcacd7fc6b74053bd'

/** Все LEAP фичи которые нужно активировать после деплоя eosio.boot. */
const FEATURES = [
  'c3a6138c5061cf291310887c0b5c71fcaffeab90d5deb50d3b9e687cead45071', // ACTION_RETURN_VALUE
  'd528b9f6e9693f45ed277af93474fd473ce7d831dae2180cca35d907bd10cb40', // CONFIGURABLE_WASM_LIMITS2
  '5443fcf88330c586bc0e5f3dee10e7f63c76c00249c87fe4fbf7f38c082006b4', // BLOCKCHAIN_PARAMETERS
  'f0af56d2c5a48d60a4a5b5c903edfb7db3a736a94ed589d0b797df33ff9d3e1d', // GET_SENDER
  '2652f5f96006294109b3dd0bbde63693f55324af452b799ee137a81a905eed25', // FORWARD_SETCODE
  '8ba52fe7a3956c5cd3a656a3174b931d3bb2abb45578befc59f283ecd816a405', // ONLY_BILL_FIRST_AUTHORIZER
  'ad9e3d8f650687709fd68f4b90b41f7d825a365b02c23a636cef88ac2ac00c43', // RESTRICT_ACTION_TO_SELF
  '68dcaa34c0517d19666e6b33add67351d8c5f69e999ca1e37931bc410a297428', // DISALLOW_EMPTY_PRODUCER_SCHEDULE
  'e0fb64b1085cc5538970158d05a009c24e276fb94e1a0bf6a528b48fbc4ff526', // FIX_LINKAUTH_RESTRICTION
  'ef43112c6543b88db2283a2e077278c315ae2c84719a8b25f25cc88565fbea99', // REPLACE_DEFERRED
  '4a90c00d55454dc5b059055ca213579c6ea856967712a56017487886a4d4cc0f', // NO_DUPLICATE_DEFERRED_ID
  '1a99a59d87e06e09ec5b028a9cbb7749b4a5ad8819004365d02dc4379a8b7241', // ONLY_LINK_TO_EXISTING_PERMISSION
  '4e7bf348da00a945489b2a681749eb56f5de00b900014e137ddae39f48f69d67', // RAM_RESTRICTIONS
  '4fca8bd82bbd181e714e283f83e1b45d95ca5af40fb89ad3977b653c448f78c2', // WEBAUTHN_KEY
  '299dcb6af692324b899b39f16d5a530a33062804e41f09dc97e9f156b4476707', // WTMSIG_BLOCK_SIGNATURES
  'bcd2a26394b36614fd4894241d3c451ab0f6fd110958c3423073621a70826e99', // GET_CODE_HASH
  '35c2186cc36f7bb4aeaf4487b36e57039ccf45a9136aa856a5d569ecca55ef2b', // GET_BLOCK_NUM
  '6bcb40a24e49c26d0a60513b6aeb8551d264e4717f306b81a37a5afb3b47cedc', // CRYPTO_PRIMITIVES
]

export class ChainHelper {
  private client: APIClient
  private privKey: PrivateKey
  private chainUrl: string

  constructor(chainUrl: string, privateKeyWif: string) {
    this.chainUrl = chainUrl
    this.client = new APIClient({ provider: new FetchProvider(chainUrl) })
    this.privKey = PrivateKey.from(privateKeyWif)
  }

  /** Возвращает публичный ключ (EOS-формат) для создания аккаунтов. */
  get publicKey(): string {
    return this.privKey.toPublic().toString()
  }

  /**
   * Активирует фичу PREACTIVATE_FEATURE через producer API.
   * Это первый шаг: без неё нельзя задеплоить eosio.boot.
   * Использует прямой POST к /v1/producer/schedule_protocol_feature_activations.
   */
  async preactivate(): Promise<void> {
    const res = await fetch(`${this.chainUrl}/v1/producer/schedule_protocol_feature_activations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol_features_to_activate: [PREACTIVATE_HASH] }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`preactivate failed: ${text}`)
    }
    // Даём ноде один блок (~500ms) чтобы фича активировалась
    await sleep(1000)
  }

  /**
   * Создаёт аккаунт под управлением eosio (genesis privileged account).
   * Использует встроенный eosio::newaccount action (до деплоя системного контракта).
   */
  async createAccount(creator: string, name: string): Promise<void> {
    const pubKey = this.publicKey
    await this.pushActions([
      {
        account: 'eosio',
        name: 'newaccount',
        auth: `${creator}@active`,
        data: {
          creator,
          name,
          owner: { threshold: 1, keys: [{ key: pubKey, weight: 1 }], accounts: [], waits: [] },
          active: { threshold: 1, keys: [{ key: pubKey, weight: 1 }], accounts: [], waits: [] },
        },
      },
    ])
  }

  /**
   * Деплоит контракт: XADD setcode + setabi транзакции.
   * @param account — аккаунт на который деплоим
   * @param contractName — имя поддиректории в test/integration/contracts/
   */
  async deployContract(account: string, contractName: string): Promise<void> {
    const wasmPath = join(CONTRACTS_DIR, contractName, `${contractName}.wasm`)
    const abiPath = join(CONTRACTS_DIR, contractName, `${contractName}.abi`)

    const wasmHex = readFileSync(wasmPath).toString('hex')
    const abiJson = JSON.parse(readFileSync(abiPath, 'utf8')) as object

    // Сериализуем ABI в бинарный формат используя wharfkit ABI encoder
    const abiObj = ABI.from(abiJson)
    const abiBytes = Serializer.encode({ object: abiObj }).hexString

    await this.pushActions([
      {
        account: 'eosio',
        name: 'setcode',
        auth: `${account}@active`,
        data: { account, vmtype: 0, vmversion: 0, code: wasmHex },
      },
      {
        account: 'eosio',
        name: 'setabi',
        auth: `${account}@active`,
        data: { account, abi: abiBytes },
      },
    ])

    // Небольшая пауза чтобы контракт стал доступен
    await sleep(500)
  }

  /**
   * Активирует все LEAP протокольные фичи через eosio.boot::activate.
   * Вызывается после деплоя eosio.boot на eosio.
   */
  async activateFeatures(): Promise<void> {
    // Активируем по одной — некоторые зависят от предыдущих
    for (const hash of FEATURES) {
      try {
        await this.pushActions([
          {
            account: 'eosio',
            name: 'activate',
            auth: 'eosio@active',
            data: { feature_digest: hash },
          },
        ])
      } catch {
        // Фича уже может быть активирована — игнорируем
      }
    }
    await sleep(500)
  }

  /**
   * Выполняет произвольный набор actions в одной транзакции.
   * Используется для eosio.token::create, issue, transfer и т.д.
   */
  async pushActions(actions: Array<{
    account: string
    name: string
    auth: string
    data: Record<string, unknown>
  }>): Promise<void> {
    // Получаем tapos из chain info
    const info = await this.client.v1.chain.get_info()
    const header = info.getTransactionHeader(60) // expiration = now + 60s

    // Строим Action объекты с данными как bytes через JSON API endpoint
    // Используем get_required_keys + serialize через API для надёжности
    const serializedActions: Action[] = []
    for (const a of actions) {
      const [authAccount, authPerm] = a.auth.split('@')
      const action = Action.from({
        account: Name.from(a.account),
        name: Name.from(a.name),
        authorization: [PermissionLevel.from({ actor: authAccount ?? a.account, permission: authPerm ?? 'active' })],
        // Данные кодируем через API endpoint abi_json_to_bin
        data: await this.abiJsonToBin(a.account, a.name, a.data),
      })
      serializedActions.push(action)
    }

    const tx = Transaction.from({
      ...header,
      actions: serializedActions,
    })

    // Подписываем: digest = sha256(chain_id || packed_tx || sha256(""))
    const chainIdBytes = Bytes.from(info.chain_id.array)
    const packedTx = Serializer.encode({ object: tx })
    const contextFreeDataHash = Bytes.from(new Uint8Array(32)) // sha256("") = 32 нулевых байт
    const signingBytes = Bytes.from([
      ...chainIdBytes.array,
      ...packedTx.array,
      ...contextFreeDataHash.array,
    ])
    const signature = this.privKey.signDigest(Checksum256.hash(signingBytes))

    const signed = SignedTransaction.from({ ...tx, signatures: [signature] })

    // Отправляем
    await this.client.v1.chain.push_transaction(signed)
  }

  /**
   * Сериализует action data в hex через Chain API /v1/chain/abi_json_to_bin.
   * Это надёжнее чем ручная сериализация — нода сама знает ABI.
   */
  private async abiJsonToBin(
    code: string,
    action: string,
    args: Record<string, unknown>,
  ): Promise<Bytes> {
    const res = await fetch(`${this.chainUrl}/v1/chain/abi_json_to_bin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, action, args }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`abi_json_to_bin(${code}::${action}) failed: ${text}`)
    }
    const { binargs } = await res.json() as { binargs: string }
    return Bytes.from(binargs, 'hex')
  }
}

/** Утилита: ждём пока Chain API станет доступным. */
export async function waitForChain(chainUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${chainUrl}/v1/chain/get_info`)
      if (res.ok) return
    } catch { /* нода ещё не запустилась */ }
    await sleep(1000)
  }
  throw new Error(`Chain API at ${chainUrl} not ready after ${timeoutMs}ms`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
