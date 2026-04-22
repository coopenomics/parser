import type { ABI } from '@wharfkit/antelope'
import type { Action, Delta, ShipTrace, ShipDelta } from '../types/ship.js'
import type { NativeDeltaEvent } from '../native-tables/index.js'

export interface Deserializer {
  deserializeAction<T = Record<string, unknown>>(trace: ShipTrace, abi: ABI): Action<T>
  deserializeContractRow<T = Record<string, unknown>>(delta: ShipDelta, abi: ABI): Delta<T>
  deserializeNativeDelta<T = Record<string, unknown>>(delta: ShipDelta): NativeDeltaEvent<T>
  readonly name: 'wharfkit'
}
