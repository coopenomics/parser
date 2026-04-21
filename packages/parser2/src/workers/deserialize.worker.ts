import { isMainThread } from 'node:worker_threads'
import { ABI, Serializer, type ABISerializable } from '@wharfkit/antelope'
import { createHash } from 'node:crypto'

if (isMainThread) {
  throw new Error('This file must be run in a worker thread')
}

interface WorkerTask {
  rawBinary: Uint8Array
  abiJson: string
  contract: string
  typeName: string
  kind: 'action' | 'delta'
}

const abiCache = new Map<string, ABI>()

function getAbi(abiJson: string): ABI {
  const hash = createHash('sha256').update(abiJson).digest('hex')
  let parsed = abiCache.get(hash)
  if (!parsed) {
    parsed = ABI.from(JSON.parse(abiJson) as object)
    abiCache.set(hash, parsed)
  }
  return parsed
}

export default function deserialize(task: WorkerTask): Record<string, unknown> {
  const abi = getAbi(task.abiJson)
  const raw = Serializer.decode({ data: task.rawBinary, type: task.typeName, abi })
  return Serializer.objectify(raw as ABISerializable) as Record<string, unknown>
}
