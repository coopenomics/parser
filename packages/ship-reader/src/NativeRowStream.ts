import type { ShipDelta } from './types/ship.js'
import type { NativeDeltaEvent } from './native-tables/index.js'
import { isNativeTableName } from './native-tables/index.js'
import type { WharfkitDeserializer } from './deserializers/WharfkitDeserializer.js'

export function filterNativeDeltas(deltas: readonly ShipDelta[]): ShipDelta[] {
  return deltas.filter(d => isNativeTableName(d.name))
}

export function* streamNativeDeltas(
  deltas: readonly ShipDelta[],
  deserializer: WharfkitDeserializer,
): Generator<NativeDeltaEvent> {
  for (const delta of deltas) {
    if (!isNativeTableName(delta.name)) continue
    yield deserializer.deserializeNativeDelta(delta)
  }
}
