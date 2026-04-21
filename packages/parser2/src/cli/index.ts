/**
 * CLI точка входа для @coopenomics/parser.
 *
 * Инструмент командной строки `parser` предоставляет набор операционных команд
 * для управления парсером без его перезапуска:
 *
 *   validate <config>         — проверить YAML конфиг без запуска парсера
 *   list-subscriptions        — показать зарегистрированные подписки и их статус
 *   reset-subscription        — перемотать consumer group на конкретный блок
 *   abi-prune                 — удалить устаревшие версии ABI из Redis
 *   list-dead-letters         — показать содержимое dead-letter stream(ов)
 *   replay-dead-letter        — переиграть события из dead-letter обратно в live stream
 *
 * Каждая команда, требующая Redis, принимает --config <file> для подключения.
 * Redis-соединение открывается и закрывается внутри команды (connect → quit).
 *
 * Паттерн обработки ошибок: catch → console.error → process.exit(1).
 * finally-блок гарантирует закрытие Redis-соединения даже при ошибке.
 */

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

/**
 * Команда `validate`: проверяет YAML конфиг без запуска парсера.
 *
 * Выходные коды:
 *   0 — конфиг валиден
 *   1 — ошибка валидации (неверная схема, пропущены обязательные поля)
 *   2 — ошибка безопасности (секреты хардкодированы вместо env-переменных)
 *
 * В stdout выводит (опционально) redacted конфиг — URL с заменёнными паролями.
 * Это позволяет операторам убедиться что env-подстановка сработала корректно.
 */
program
  .command('validate <config-file>')
  .description('Validate config file without starting the parser')
  .option('--json', 'Output result as JSON')
  .action((configFile: string, opts: { json?: boolean }) => {
    try {
      const config = fromConfigFile(configFile)

      // Redacted конфиг: скрываем пароли в URL для безопасного вывода
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

/**
 * Команда `list-subscriptions`: показывает все зарегистрированные подписки.
 * Читает из parser2:subs HASH и объединяет с данными XINFO GROUPS.
 * Полезна для мониторинга: видно pending, lag и last-delivered-id каждой группы.
 */
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

/**
 * Команда `reset-subscription`: перематывает позицию consumer group.
 * Используется для повторной обработки блоков после потери данных или при отладке.
 * --to-block 0/latest → '$' (пропустить всё, получать только новые события).
 * --to-block <N>       → перемотать на конкретный блок в стриме.
 * --dry-run            → показать XGROUP SETID команду без выполнения.
 */
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

/**
 * Команда `abi-prune`: удаляет устаревшие версии ABI из Redis ZSET.
 * Без периодической очистки активные контракты накапливают сотни версий.
 * --older-than <block> → удалить версии с block_num < этого значения.
 * --all-contracts      → SCAN по parser2:abi:* и применить к каждому контракту.
 * --dry-run            → показать количество версий для удаления без изменений.
 */
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

/**
 * Команда `list-dead-letters`: инспектирует dead-letter stream(ы).
 * Dead-letter stream: ce:parser2:<chainId>:dead:<subId>
 * Содержит события которые handler не смог обработать 3 раза подряд.
 * --all    → сканировать все dead-letter стримы для цепи (SCAN dead:*).
 * --limit  → максимум записей за вызов (пагинация через --from).
 * --from   → entry ID для начала XRANGE (исключительный старт следующей страницы).
 */
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

/**
 * Команда `replay-dead-letter`: переигрывает события из dead-letter обратно в live stream.
 * Операция: XADD live-stream → XDEL dead-stream → HDEL failures-hash.
 * HDEL failures-hash важен: без него при первой же следующей ошибке событие снова
 * уйдёт в dead-letter (счётчик уже был = 3 = FAILURE_THRESHOLD).
 * --event-id <id> → найти и переиграть конкретное событие (XRANGE с поиском).
 * --all           → переиграть все события из dead-letter stream подписки.
 * --dry-run       → показать что будет сделано без изменений Redis.
 */
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

/**
 * Redact-функция: скрывает пароль в Redis URL для безопасного вывода.
 * redis://:password@host → redis://:***@host
 * Использует URL-парсер — не регулярку — чтобы корректно обработать edge cases.
 */
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
