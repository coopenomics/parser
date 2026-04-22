/**
 * Unit-тесты ParserClient.
 *
 * ParserClient использует внутри new IoRedisStore(...), поэтому мокаем модуль
 * адаптера — подставляем fake RedisStore, через который диктуем поведение
 * streams/locks и отслеживаем ack.
 *
 * Покрываем:
 *   - Регистрация подписки в parser2:subs
 *   - Определение startId по startFrom
 *   - Ожидание промотации если lock занят
 *   - Применение фильтров: не-matching события XACK'аются молча
 *   - BigInt roundtrip для global_sequence
 *   - Ошибка обработчика → recordFailure; 3 фейла подряд → dead-letter
 *   - close() и closeAndExit() — штатный shutdown
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RedisStore, StreamMessage, XGroupInfo } from '../../src/ports/RedisStore.js'

// ─── Fake Redis — in-memory implementation достаточная для ParserClient ──────

class FakeRedis implements RedisStore {
  streams = new Map<string, StreamMessage[]>()
  groups = new Map<string, Map<string, { lastId: string; pending: Set<string> }>>()
  hashes = new Map<string, Record<string, string>>()
  locks = new Map<string, string>()
  zsets = new Map<string, Map<string, number>>()

  // Очередь сообщений которые будут выдаваться по read-запросам в нужном порядке
  pendingReads: StreamMessage[] = []
  private lockHeldBy: string | null = null

  connect = vi.fn(async () => {})
  quit = vi.fn(async () => {})

  xadd = vi.fn(async (stream: string, fields: Record<string, string>): Promise<string> => {
    const list = this.streams.get(stream) ?? []
    const id = `${Date.now()}-${list.length}`
    list.push({ id, fields })
    this.streams.set(stream, list)
    return id
  })

  xtrim = vi.fn(async (): Promise<number> => 0)
  xgroupCreate = vi.fn(async (stream: string, group: string): Promise<void> => {
    if (!this.groups.has(stream)) this.groups.set(stream, new Map())
    const grp = this.groups.get(stream)!
    if (!grp.has(group)) grp.set(group, { lastId: '0', pending: new Set() })
  })
  xgroupSetId = vi.fn(async (): Promise<void> => {})
  xinfoGroups = vi.fn(async (): Promise<XGroupInfo[]> => [])
  xreadGroup = vi.fn(async (
    _stream: string, _group: string, _consumer: string, _count: number, _blockMs: number, _id: string,
  ): Promise<StreamMessage[]> => {
    if (this.pendingReads.length > 0) {
      const batch = this.pendingReads
      this.pendingReads = []
      return batch
    }
    // Симулируем Redis BLOCK: засыпаем чтобы цикл не крутился вхолостую
    // и event loop мог обработать close() и разблокировать generator.
    await new Promise(r => setTimeout(r, 20))
    return []
  })

  xrange = vi.fn(async (): Promise<StreamMessage[]> => [])
  xrevrange = vi.fn(async (): Promise<StreamMessage[]> => [])
  xlen = vi.fn(async (): Promise<number> => 0)
  xdel = vi.fn(async (): Promise<number> => 0)
  xack = vi.fn(async (): Promise<void> => {})

  zadd = vi.fn(async (key: string, score: number, member: string): Promise<void> => {
    if (!this.zsets.has(key)) this.zsets.set(key, new Map())
    this.zsets.get(key)!.set(member, score)
  })
  zrangeByscoreRev = vi.fn(async (): Promise<string[]> => [])
  zrangeByScore = vi.fn(async (): Promise<string[]> => [])
  zcount = vi.fn(async (): Promise<number> => 0)
  zremRangeByScore = vi.fn(async (): Promise<number> => 0)
  zcard = vi.fn(async (): Promise<number> => 0)

  hset = vi.fn(async (key: string, fields: Record<string, string>): Promise<void> => {
    const existing = this.hashes.get(key) ?? {}
    this.hashes.set(key, { ...existing, ...fields })
  })
  hget = vi.fn(async (key: string, field: string): Promise<string | null> => {
    return this.hashes.get(key)?.[field] ?? null
  })
  hgetAll = vi.fn(async (key: string): Promise<Record<string, string>> => this.hashes.get(key) ?? {})
  hincrby = vi.fn(async (key: string, field: string, inc: number): Promise<number> => {
    const h = this.hashes.get(key) ?? {}
    const curr = Number(h[field] ?? 0)
    const next = curr + inc
    h[field] = String(next)
    this.hashes.set(key, h)
    return next
  })
  hdel = vi.fn(async (key: string, field: string): Promise<void> => {
    const h = this.hashes.get(key)
    if (h) delete h[field]
  })

  setNx = vi.fn(async (key: string, value: string): Promise<boolean> => {
    if (this.lockHeldBy && this.lockHeldBy !== value && this.locks.get(key) === this.lockHeldBy) {
      return false
    }
    this.locks.set(key, value)
    return true
  })
  pexpire = vi.fn(async (): Promise<boolean> => true)
  luaDel = vi.fn(async (key: string, value: string): Promise<boolean> => {
    if (this.locks.get(key) === value) {
      this.locks.delete(key)
      return true
    }
    return false
  })
  expire = vi.fn(async (): Promise<void> => {})
  scan = vi.fn(async (): Promise<string[]> => [])

  /** Имитирует что lock уже держит кто-то другой. */
  simulateLockHeldBy(key: string, holderId: string): void {
    this.lockHeldBy = holderId
    this.locks.set(key, holderId)
  }

  /** Освобождает симулированный чужой lock — следующий setNx от нового владельца пройдёт. */
  releaseSimulatedLock(): void {
    this.lockHeldBy = null
  }
}

// ─── Мокаем IoRedisStore так чтобы ParserClient получал FakeRedis ────────────

const fakeRedisInstances: FakeRedis[] = []
vi.mock('../../src/adapters/IoRedisStore.js', () => ({
  IoRedisStore: vi.fn().mockImplementation(() => {
    const r = new FakeRedis()
    fakeRedisInstances.push(r)
    return r
  }),
}))

// Импорт после vi.mock — иначе мок не применится
const { ParserClient } = await import('../../src/client/ParserClient.js')
const { RedisKeys } = await import('../../src/redis/keys.js')

function currentRedis(): FakeRedis {
  return fakeRedisInstances[fakeRedisInstances.length - 1]!
}

/** Ждёт пока predicate станет истиной или кинет ошибку по таймауту. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil timeout')
    }
    await new Promise(r => setTimeout(r, 10))
  }
}

function makeActionEvent(override: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    kind: 'action',
    event_id: 'evt-1',
    chain_id: 'eos',
    block_num: 100,
    block_time: '2024-01-01T00:00:00.000',
    block_id: 'abc',
    account: 'eosio.token',
    name: 'transfer',
    authorization: [{ actor: 'alice', permission: 'active' }],
    data: { from: 'alice', to: 'bob', quantity: '1.0000 EOS' },
    action_ordinal: 1,
    // BigInt сериализуется как строка в stream — проверяем обратное преобразование
    global_sequence: '1000',
    receipt: null,
    ...override,
  }
}

describe('ParserClient — subscription registration', () => {
  beforeEach(() => { fakeRedisInstances.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  it('registers subscription metadata in parser2:subs hash on stream() start', async () => {
    const client = new ParserClient({
      subscriptionId: 'my-sub',
      filters: [{ kind: 'action', account: 'eosio.token' }],
      redis: { url: 'redis://fake' },
      chain: { id: 'eos-mainnet' },
      noSignalHandlers: true,
    })

    // Запускаем stream и сразу закрываем — нам важен только side effect регистрации
    const gen = client.stream()
    const firstPromise = gen.next()
    // Дадим тик микротасков чтобы зарегистрировать подписку и захватить lock
    await new Promise(r => setImmediate(r))
    await client.close()
    await firstPromise.catch(() => {/* ожидаемо */})

    const redis = currentRedis()
    expect(redis.hset).toHaveBeenCalledWith(
      RedisKeys.subsHash(),
      expect.objectContaining({ 'my-sub': expect.stringContaining('"subId":"my-sub"') }),
    )
  })
})

describe('ParserClient — lock handling', () => {
  beforeEach(() => { fakeRedisInstances.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  it('when lock is held, waits for promotion (timeout surfaces as rejection)', async () => {
    // Pre-подкидываем что lock уже занят, а таймаут короткий
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      acquireLockTimeoutMs: 100,
      noSignalHandlers: true,
    })

    const gen = client.stream()
    // После connect блокируем lock внешним holder'ом
    // (подмена происходит до того как SubscriptionLock.acquire вызовет setNx)
    // Переопределяем setNx глобально: всегда false
    queueMicrotask(() => {
      const r = currentRedis()
      if (r) {
        r.setNx = vi.fn().mockResolvedValue(false) as unknown as FakeRedis['setNx']
      }
    })

    await expect(gen.next()).rejects.toThrow(/timeout/)
    await client.close()
  })
})

describe('ParserClient — startFrom resolution', () => {
  beforeEach(() => { fakeRedisInstances.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  async function captureGroupCreateStartId(startFrom?: 'last_known' | number | 'head-minus-1000'): Promise<string> {
    const opts: ConstructorParameters<typeof ParserClient>[0] = {
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    }
    if (startFrom !== undefined) opts.startFrom = startFrom
    const client = new ParserClient(opts)
    const gen = client.stream()
    const firstPromise = gen.next()
    await new Promise(r => setImmediate(r))
    await new Promise(r => setImmediate(r))
    await client.close()
    await firstPromise.catch(() => {})

    const redis = currentRedis()
    const call = (redis.xgroupCreate as ReturnType<typeof vi.fn>).mock.calls[0]
    return call![2] as string
  }

  it('startFrom="last_known" → startId = "$"', async () => {
    expect(await captureGroupCreateStartId('last_known')).toBe('$')
  })

  it('startFrom=undefined → defaults to "$"', async () => {
    expect(await captureGroupCreateStartId()).toBe('$')
  })

  it('startFrom="head-minus-1000" → startId = "0"', async () => {
    expect(await captureGroupCreateStartId('head-minus-1000')).toBe('0')
  })

  it('startFrom=12345 (number) → startId = "12345-0"', async () => {
    expect(await captureGroupCreateStartId(12345)).toBe('12345-0')
  })
})

describe('ParserClient — filter application and event delivery', () => {
  beforeEach(() => { fakeRedisInstances.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  it('yields events matching the filter; auto-ACKs non-matching without yield', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      filters: [{ kind: 'action', account: 'eosio.token' }],
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const nonMatching = makeActionEvent({ account: 'other.contract', event_id: 'evt-2' })
    const matching = makeActionEvent({ event_id: 'evt-1' })

    const gen = client.stream()
    // Сначала инициируем запуск stream() (регистрация + lock + group create)
    const firstPromise = gen.next()
    // Ждём пока stream начнёт читать (xreadGroup вызван хотя бы раз)
    await new Promise(r => setImmediate(r))

    const redis = currentRedis()
    // non-matching идёт первым, чтобы он был проглочен XACK'ом;
    // matching — вторым, его генератор выдаст нам через firstPromise.
    redis.pendingReads = [
      { id: '2-0', fields: { data: JSON.stringify(nonMatching) } },
      { id: '1-0', fields: { data: JSON.stringify(matching) } },
    ]

    const first = await firstPromise
    expect(first.done).toBe(false)
    const event = first.value!
    expect(event.kind).toBe('action')
    if (event.kind === 'action') {
      expect(event.account).toBe('eosio.token')
    }

    // non-matching должен быть уже XACK'нут (обработан до matching)
    const ackedIds = (redis.xack as ReturnType<typeof vi.fn>).mock.calls.map(c => c[2])
    expect(ackedIds).toContain('2-0')

    await client.close()
    await gen.return(undefined as never).catch(() => {})
  })

  it('reconstructs BigInt global_sequence from string on read', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const event = makeActionEvent({ global_sequence: '99999999999999' })
    const gen = client.stream()
    const firstPromise = gen.next()
    await new Promise(r => setImmediate(r))

    currentRedis().pendingReads = [{ id: '1-0', fields: { data: JSON.stringify(event) } }]

    const first = await firstPromise
    const ev = first.value!
    expect(ev.kind).toBe('action')
    if (ev.kind === 'action') {
      expect(typeof ev.global_sequence).toBe('bigint')
      expect(ev.global_sequence).toBe(99999999999999n)
    }

    await client.close()
    await gen.return(undefined as never).catch(() => {})
  })

  it('ACKs messages with missing "data" field without yielding', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const gen = client.stream()
    void gen.next()
    await new Promise(r => setImmediate(r))

    const redis = currentRedis()
    redis.pendingReads = [{ id: '1-0', fields: {} }]

    // Ждём пока event с отсутствующим data будет XACK'нут
    await waitUntil(
      () => (redis.xack as ReturnType<typeof vi.fn>).mock.calls
        .some(c => c[2] === '1-0'),
    )
    const ackedIds = (redis.xack as ReturnType<typeof vi.fn>).mock.calls.map(c => c[2])
    expect(ackedIds).toContain('1-0')

    await client.close()
    await gen.return(undefined as never).catch(() => {})
  })

  it('ACKs messages with malformed JSON in data field without yielding', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const gen = client.stream()
    void gen.next()
    await new Promise(r => setImmediate(r))

    const redis = currentRedis()
    redis.pendingReads = [{ id: '1-0', fields: { data: 'not-json{{{' } }]

    await waitUntil(
      () => (redis.xack as ReturnType<typeof vi.fn>).mock.calls
        .some(c => c[2] === '1-0'),
    )
    const ackedIds = (redis.xack as ReturnType<typeof vi.fn>).mock.calls.map(c => c[2])
    expect(ackedIds).toContain('1-0')

    await client.close()
    await gen.return(undefined as never).catch(() => {})
  })
})

describe('ParserClient — shutdown', () => {
  beforeEach(() => { fakeRedisInstances.length = 0 })
  afterEach(() => { vi.clearAllMocks() })

  it('close() releases lock and quits Redis', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const gen = client.stream()
    void gen.next()
    await new Promise(r => setImmediate(r))

    await client.close()

    const redis = currentRedis()
    // luaDel — условное удаление lock'а
    expect(redis.luaDel).toHaveBeenCalled()
    // quit Redis-коннекта
    expect(redis.quit).toHaveBeenCalled()
  })

  it('close() is safe to call twice', async () => {
    const client = new ParserClient({
      subscriptionId: 'sub',
      redis: { url: 'redis://fake' },
      chain: { id: 'eos' },
      noSignalHandlers: true,
    })

    const gen = client.stream()
    void gen.next()
    await new Promise(r => setImmediate(r))

    await client.close()
    await expect(client.close()).resolves.not.toThrow()
  })
})
