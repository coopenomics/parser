import type { ParserOptions } from '../config/index.js'
import { fromConfigFile, parseConfig } from '../config/index.js'
import { ShipReaderAdapter } from '../adapters/ShipReaderAdapter.js'
import { IoRedisStore } from '../adapters/IoRedisStore.js'
import { WorkerPool } from '../workers/WorkerPool.js'
import { BlockProcessor } from './BlockProcessor.js'
import type { XtrimSupervisorOpts } from './XtrimSupervisor.js'
import { XtrimSupervisor } from './XtrimSupervisor.js'
import { RedisKeys } from '../redis/keys.js'
import { ChainIdMismatchError } from '../errors.js'
import { AbiStore } from '../abi/AbiStore.js'
import { AbiBootstrapper } from '../abi/AbiBootstrapper.js'
import type { ParserEvent } from '../types.js'

export class Parser {
  private opts: ParserOptions
  private chainClient: ShipReaderAdapter | null = null
  private redis: IoRedisStore | null = null
  private workerPool: WorkerPool | null = null
  private blockProcessor: BlockProcessor | null = null
  private xtrimSupervisor: XtrimSupervisor | null = null
  private running = false
  private stopSignal = false

  constructor(opts: ParserOptions) {
    this.opts = opts
  }

  static fromConfigFile(filePath: string): Parser {
    return new Parser(fromConfigFile(filePath))
  }

  static fromConfig(raw: unknown): Parser {
    return new Parser(parseConfig(raw))
  }

  async start(): Promise<void> {
    this.stopSignal = false
    this.running = true

    if (!this.opts.noSignalHandlers) {
      const shutdown = () => void this.stop()
      process.once('SIGTERM', shutdown)
      process.once('SIGINT', shutdown)
    }

    this.redis = new IoRedisStore(this.opts.redis)
    await this.redis.connect()

    await this.checkRedisPersistence()

    this.workerPool = new WorkerPool(this.opts.workerPool?.maxThreads ?? 2)

    const shipOpts: { url: string; timeoutMs?: number; chainUrl?: string } = {
      url: this.opts.ship.url,
    }
    if (this.opts.ship.timeoutMs !== undefined) shipOpts.timeoutMs = this.opts.ship.timeoutMs
    if (this.opts.chain?.url !== undefined) shipOpts.chainUrl = this.opts.chain.url

    this.chainClient = new ShipReaderAdapter(shipOpts)

    const { chainId } = await this.chainClient.connect()

    if (this.opts.chain?.id && this.opts.chain.id !== chainId) {
      throw new ChainIdMismatchError(this.opts.chain.id, chainId)
    }

    const abiFallback = this.opts.abiFallback ?? 'rpc-current'
    const abiStore = new AbiStore(this.redis)
    const abiBootstrapper = new AbiBootstrapper(this.chainClient, abiStore, { abiFallback })

    this.blockProcessor = new BlockProcessor({
      chainId,
      workerPool: this.workerPool,
      abiBootstrapper,
      abiStore,
      chainClient: this.chainClient,
    })

    const syncKey = RedisKeys.syncHash(chainId)
    const eventsStream = RedisKeys.eventsStream(chainId)

    const lastBlockNum = await this.redis.hget(syncKey, 'block_num')
    const lastBlockId = await this.redis.hget(syncKey, 'block_id')

    const havePositions =
      lastBlockNum && lastBlockId
        ? [{ blockNum: Number(lastBlockNum), blockId: lastBlockId }]
        : []

    const xtrimOpts: XtrimSupervisorOpts = {
      redis: this.redis,
      stream: eventsStream,
    }
    if (this.opts.xtrim?.intervalMs !== undefined) xtrimOpts.intervalMs = this.opts.xtrim.intervalMs
    this.xtrimSupervisor = new XtrimSupervisor(xtrimOpts)

    if (this.opts.xtrim?.enabled !== false) {
      this.xtrimSupervisor.start()
    }

    const streamOpts = {
      startBlock: havePositions[0]?.blockNum ?? 0,
      havePositions,
    }

    for await (const block of this.chainClient.streamBlocks(streamOpts)) {
      if (this.stopSignal) break

      const events: ParserEvent[] = await this.blockProcessor.process(block)

      for (const event of events) {
        await this.redis.xadd(eventsStream, this.eventToFields(event))
      }

      await this.redis.hset(syncKey, {
        block_num: String(block.thisBlock.blockNum),
        block_id: block.thisBlock.blockId,
        last_updated: new Date().toISOString(),
      })

      this.chainClient.ack(1)
    }
  }

  private eventToFields(event: ParserEvent): Record<string, string> {
    return { data: JSON.stringify(event) }
  }

  async stop(): Promise<void> {
    this.stopSignal = true

    if (this.blockProcessor) {
      await this.blockProcessor.onIdle()
    }

    if (this.chainClient) {
      await this.chainClient.close()
      this.chainClient = null
    }

    if (this.workerPool) {
      await this.workerPool.destroy()
      this.workerPool = null
    }

    if (this.xtrimSupervisor) {
      this.xtrimSupervisor.stop()
      this.xtrimSupervisor = null
    }

    if (this.redis) {
      await this.redis.quit()
      this.redis = null
    }

    this.running = false
  }

  get isRunning(): boolean {
    return this.running
  }

  private async checkRedisPersistence(): Promise<void> {
    const redis = this.redis!
    try {
      const aofResult = await redis.hget('__parser2_check__', '__noop__')
      void aofResult
    } catch {
      // non-fatal check failure
    }
  }
}
