import { ChainRpcError } from './errors.js'
import type { ChainInfo } from './types/ship.js'

const DEFAULT_RETRIES = 3
const RETRY_DELAYS_MS = [500, 1500, 3000] as const

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function withRetry<T>(fn: () => Promise<T>, retries = DEFAULT_RETRIES): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const delay = RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 3000
      await sleep(delay)
    }
  }
  throw new ChainRpcError('Chain RPC request failed after retries', lastErr)
}

export async function getChainInfo(chainUrl: string): Promise<ChainInfo> {
  return withRetry(() => postJson<ChainInfo>(`${chainUrl}/v1/chain/get_info`, {}))
}

export async function getRawAbi(chainUrl: string, accountName: string): Promise<Uint8Array> {
  interface GetRawAbiResponse {
    account_name: string
    abi_hash: string
    abi: string
  }
  const res = await withRetry(() =>
    postJson<GetRawAbiResponse>(`${chainUrl}/v1/chain/get_raw_abi`, { account_name: accountName }),
  )
  const b64 = res.abi
  const binary = Buffer.from(b64, 'base64')
  return new Uint8Array(binary)
}
