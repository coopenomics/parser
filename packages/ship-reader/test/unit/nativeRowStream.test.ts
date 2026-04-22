/**
 * Тесты NativeRowStream — фильтрация и стриминг нативных дельт.
 *
 * streamNativeDeltas отбрасывает contract_row и прочее НЕ из списка нативных
 * таблиц, пропускает только чисто системные типы (permission, account и т.д.)
 * и декодирует их через WharfkitDeserializer.
 */

import { describe, it, expect, vi } from 'vitest'
import { filterNativeDeltas, streamNativeDeltas } from '../../src/NativeRowStream.js'
import type { ShipDelta } from '../../src/types/ship.js'
import type { WharfkitDeserializer } from '../../src/deserializers/WharfkitDeserializer.js'
import type { NativeDeltaEvent } from '../../src/native-tables/index.js'

function makeDelta(override: Partial<ShipDelta> = {}): ShipDelta {
  return {
    name: 'permission',
    present: true,
    rowRaw: new Uint8Array([0x01]),
    ...override,
  }
}

function makeDeserializer(): WharfkitDeserializer {
  return {
    deserializeNativeDelta: vi.fn((delta: ShipDelta): NativeDeltaEvent => ({
      table: delta.name,
      present: delta.present,
      data: {},
      lookup_key: 'mock-key',
    })),
    deserializeAction: vi.fn(),
    deserializeContractRow: vi.fn(),
    name: 'wharfkit',
  } as unknown as WharfkitDeserializer
}

describe('NativeRowStream — filterNativeDeltas', () => {
  it('returns only native table deltas', () => {
    const deltas = [
      makeDelta({ name: 'permission' }),
      makeDelta({ name: 'contract_row' }), // native but may be filtered — actually IS native
      makeDelta({ name: 'account' }),
      makeDelta({ name: 'not_a_native_table' }),
    ]
    const result = filterNativeDeltas(deltas)
    // contract_row is technically in NATIVE_TABLE_NAMES, so kept
    expect(result).toHaveLength(3)
    expect(result.map(d => d.name)).toEqual(['permission', 'contract_row', 'account'])
  })

  it('returns empty array when none are native', () => {
    const deltas = [
      makeDelta({ name: 'foo' }),
      makeDelta({ name: 'bar' }),
    ]
    expect(filterNativeDeltas(deltas)).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(filterNativeDeltas([])).toEqual([])
  })

  it('does not mutate input', () => {
    const deltas: ShipDelta[] = [
      makeDelta({ name: 'permission' }),
      makeDelta({ name: 'fake' }),
    ]
    const snapshot = [...deltas]
    filterNativeDeltas(deltas)
    expect(deltas).toEqual(snapshot)
  })
})

describe('NativeRowStream — streamNativeDeltas', () => {
  it('yields a NativeDeltaEvent for each native delta', () => {
    const deser = makeDeserializer()
    const deltas = [
      makeDelta({ name: 'permission' }),
      makeDelta({ name: 'account' }),
    ]
    const events = Array.from(streamNativeDeltas(deltas, deser))
    expect(events).toHaveLength(2)
    expect(events[0]!.table).toBe('permission')
    expect(events[1]!.table).toBe('account')
    expect(deser.deserializeNativeDelta).toHaveBeenCalledTimes(2)
  })

  it('skips non-native deltas without calling the deserializer', () => {
    const deser = makeDeserializer()
    const deltas = [
      makeDelta({ name: 'not_native' }),
      makeDelta({ name: 'also_fake' }),
    ]
    const events = Array.from(streamNativeDeltas(deltas, deser))
    expect(events).toHaveLength(0)
    expect(deser.deserializeNativeDelta).not.toHaveBeenCalled()
  })

  it('is lazy: pulling only 1 item does not process the rest', () => {
    const deser = makeDeserializer()
    const deltas = [
      makeDelta({ name: 'permission' }),
      makeDelta({ name: 'account' }),
      makeDelta({ name: 'resource_limits' }),
    ]
    const gen = streamNativeDeltas(deltas, deser)
    const first = gen.next()
    expect(first.done).toBe(false)
    expect((first.value as NativeDeltaEvent).table).toBe('permission')
    // После одного pull должен быть только 1 вызов
    expect(deser.deserializeNativeDelta).toHaveBeenCalledTimes(1)
  })

  it('propagates errors from the deserializer (no silent swallow)', () => {
    const deser = makeDeserializer()
    ;(deser.deserializeNativeDelta as ReturnType<typeof vi.fn>)
      .mockImplementation(() => { throw new Error('bad row') })

    const deltas = [makeDelta({ name: 'permission' })]
    expect(() => Array.from(streamNativeDeltas(deltas, deser))).toThrow('bad row')
  })

  it('preserves present=false on deletion rows', () => {
    const deser = makeDeserializer()
    const deltas = [makeDelta({ name: 'permission', present: false })]
    const events = Array.from(streamNativeDeltas(deltas, deser))
    expect(events[0]!.present).toBe(false)
  })
})
