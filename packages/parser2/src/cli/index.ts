import { Command } from 'commander'
import { fromConfigFile } from '../config/index.js'
import { ConfigValidationError, ConfigSecurityError } from '../errors.js'

const program = new Command()

program
  .name('parser')
  .description('@coopenomics/parser2 — universal EOSIO/Antelope blockchain indexer')
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
