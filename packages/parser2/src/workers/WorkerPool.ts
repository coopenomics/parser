import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface DeserializeTask {
  rawBinary: Uint8Array
  abiJson: string
  contract: string
  typeName: string
  kind: 'action' | 'delta'
}

interface PiscinaOptions {
  filename: string
  maxThreads?: number
}

// CJS/ESM interop — piscina has no "exports" field for NodeNext resolution
type PiscinaConstructor = new (opts: PiscinaOptions) => { run(task: unknown): Promise<unknown>; utilization: number; destroy(): Promise<void> }
const { default: PiscinaClass } = await import('piscina') as unknown as { default: PiscinaConstructor }

export class WorkerPool {
  private pool: InstanceType<PiscinaConstructor>

  constructor(maxThreads = 2) {
    this.pool = new PiscinaClass({
      filename: join(__dirname, 'deserialize.worker.cjs'),
      maxThreads,
    })
  }

  run(task: DeserializeTask): Promise<Record<string, unknown>> {
    return this.pool.run(task) as Promise<Record<string, unknown>>
  }

  get utilization(): number {
    return this.pool.utilization
  }

  destroy(): Promise<void> {
    return this.pool.destroy()
  }
}
