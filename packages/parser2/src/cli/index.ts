import { Command } from 'commander'
import { fromConfigFile } from '../config/index.js'
import { IoRedisStore } from '../adapters/IoRedisStore.js'
import { ConfigValidationError, ConfigSecurityError } from '../errors.js'
import { listSubscriptions } from './commands/listSubscriptions.js'
import { resetSubscription } from './commands/resetSubscription.js'
import { abiPrune } from './commands/abiPrune.js'
import { listDeadLetters } from './commands/listDeadLetters.js'
import { replayDeadLetter } from './commands/replayDeadLetter.js'

const program = new Command()

program
  .name('parser')
  .description('@coopenomics/parser — universal EOSIO/Antelope blockchain indexer')
  .version('0.1.0')

program
  .command('validate <config-file>')
  .description('Validate config file without starting the parser')
  .option('--json', 'Output result as JSON')
  .action((configFile: string, opts: { json?: boolean }) => {
    try {
      const config = fromConfigFile(configFile)

      const redacted = {
        ship: { url: redactUrl(config.ship.url) },
        chain: config.chain ? { url: config.chain.url ? redactUrl(config.chain.url) : undefined, id: config.chain.id } : undefined,
        redis: { url: redactUrl(config.redis.url) },
      }

      if (opts.json) {
        console.log(JSON.stringify({ valid: true, config: redacted }))
      } else {
        console.log('✓ Config valid')
        console.log(JSON.stringify(redacted, null, 2))
      }

      process.exit(0)
    } catch (err) {
      if (err instanceof ConfigSecurityError) {
        if (opts.json) {
          console.error(JSON.stringify({ valid: false, errors: [`SECURITY: ${err.message}`] }))
        } else {
          console.error(`SECURITY: secrets must not be hardcoded`)
          console.error(err.message)
        }
        process.exit(2)
      }

      if (err instanceof ConfigValidationError) {
        const message = err.message
        if (opts.json) {
          console.error(JSON.stringify({ valid: false, errors: [message] }))
        } else {
          console.error('✗ Config invalid:')
          console.error(message)
        }
        process.exit(1)
      }

      if (opts.json) {
        console.error(JSON.stringify({ valid: false, errors: [String(err)] }))
      } else {
        console.error('✗ Config invalid:')
        console.error(String(err))
      }
      process.exit(1)
    }
  })

program
  .command('list-subscriptions')
  .description('List registered subscriptions with consumer group stats')
  .requiredOption('--config <file>', 'Config file path')
  .option('--chain-id <id>', 'Override chain ID from config')
  .option('--json', 'Output as JSON')
  .action(async (opts: { config: string; chainId?: string; json?: boolean }) => {
    let redis: IoRedisStore | null = null
    try {
      const config = fromConfigFile(opts.config)
      const chainId = opts.chainId ?? config.chain?.id ?? 'default'
      redis = new IoRedisStore(config.redis)
      await redis.connect()
      await listSubscriptions(redis, chainId, opts.json ?? false)
      process.exit(0)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      await redis?.quit()
    }
  })

program
  .command('reset-subscription')
  .description('Rewind a subscription consumer group to a specific block')
  .requiredOption('--config <file>', 'Config file path')
  .requiredOption('--sub-id <id>', 'Subscription ID to reset')
  .requiredOption('--to-block <n>', 'Target block number (0 or "latest" = skip to end)')
  .option('--chain-id <id>', 'Override chain ID from config')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async (opts: { config: string; subId: string; toBlock: string; chainId?: string; dryRun?: boolean }) => {
    let redis: IoRedisStore | null = null
    try {
      const config = fromConfigFile(opts.config)
      const chainId = opts.chainId ?? config.chain?.id ?? 'default'
      redis = new IoRedisStore(config.redis)
      await redis.connect()
      await resetSubscription(redis, chainId, opts.subId, opts.toBlock, opts.dryRun ?? false)
      process.exit(0)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      await redis?.quit()
    }
  })

program
  .command('abi-prune')
  .description('Prune old ABI versions from a contract ZSET')
  .requiredOption('--config <file>', 'Config file path')
  .option('--contract <name>', 'Contract name to prune')
  .option('--older-than <block>', 'Remove versions older than this block number')
  .option('--dry-run', 'Show what would be done without executing')
  .option('--all-contracts', 'Apply prune to all contracts with ABI history')
  .action(async (opts: { config: string; contract?: string; olderThan?: string; dryRun?: boolean; allContracts?: boolean }) => {
    let redis: IoRedisStore | null = null
    try {
      const config = fromConfigFile(opts.config)
      redis = new IoRedisStore(config.redis)
      await redis.connect()
      const olderThan = opts.olderThan !== undefined ? Number(opts.olderThan) : 0
      if (isNaN(olderThan)) throw new Error(`Invalid --older-than value: ${opts.olderThan}`)
      await abiPrune(redis, opts.contract ?? null, olderThan, opts.dryRun ?? false, opts.allContracts ?? false)
      process.exit(0)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      await redis?.quit()
    }
  })

program
  .command('list-dead-letters')
  .description('Inspect dead-letter stream for a subscription')
  .requiredOption('--config <file>', 'Config file path')
  .option('--sub-id <id>', 'Subscription ID to inspect')
  .option('--chain-id <id>', 'Override chain ID from config')
  .option('--all', 'Inspect all dead-letter streams')
  .option('--json', 'Output as JSON')
  .option('--limit <n>', 'Max entries to show', '100')
  .option('--from <entryId>', 'Start from this entry ID (pagination)', '-')
  .action(async (opts: { config: string; subId?: string; chainId?: string; all?: boolean; json?: boolean; limit?: string; from?: string }) => {
    let redis: IoRedisStore | null = null
    try {
      const config = fromConfigFile(opts.config)
      const chainId = opts.chainId ?? config.chain?.id ?? 'default'
      redis = new IoRedisStore(config.redis)
      await redis.connect()
      await listDeadLetters(
        redis,
        chainId,
        opts.subId ?? null,
        opts.json ?? false,
        Number(opts.limit ?? 100),
        opts.from ?? '-',
        opts.all ?? false,
      )
      process.exit(0)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      await redis?.quit()
    }
  })

program
  .command('replay-dead-letter')
  .description('Replay a dead-letter event back into the live stream')
  .requiredOption('--config <file>', 'Config file path')
  .requiredOption('--sub-id <id>', 'Subscription ID')
  .option('--event-id <id>', 'Event ID to replay')
  .option('--all', 'Replay all dead-letter events for the subscription')
  .option('--chain-id <id>', 'Override chain ID from config')
  .option('--dry-run', 'Show what would be done without executing')
  .action(async (opts: { config: string; subId: string; eventId?: string; all?: boolean; chainId?: string; dryRun?: boolean }) => {
    let redis: IoRedisStore | null = null
    try {
      const config = fromConfigFile(opts.config)
      const chainId = opts.chainId ?? config.chain?.id ?? 'default'
      redis = new IoRedisStore(config.redis)
      await redis.connect()
      await replayDeadLetter(
        redis,
        chainId,
        opts.subId,
        opts.eventId ?? null,
        opts.all ?? false,
        opts.dryRun ?? false,
      )
      process.exit(0)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    } finally {
      await redis?.quit()
    }
  })

function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return url
  }
}

program.parse(process.argv)
