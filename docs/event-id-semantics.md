# Event ID Semantics

Every `ParserEvent` carries a deterministic `event_id` string computed by `computeEventId()`.  The ID is:

- **Deterministic** — identical inputs always produce the same ID.
- **Stateless** — requires no database lookup; computed purely from the event payload.
- **Fork-safe** — two events from different forks at the same block number produce different IDs because the `block_id` (first 8 bytes / 16 hex chars) differs.
- **Human-readable** — structured as colon-separated segments for easy grep/log filtering.

## Formulas

### Action event (`kind: "action"`)

```
{chain_id}:a:{block_num}:{block_id[0..16]}:{global_sequence}
```

Example: `eos-mainnet:a:400000000:00017d7840ab12cd:1234567890`

| Segment | Source |
|---|---|
| `chain_id` | Config `chain.id` |
| `a` | Fixed kind prefix |
| `block_num` | `ShipBlock.thisBlock.blockNum` |
| `block_id[0..16]` | First 16 hex chars of block ID |
| `global_sequence` | `ShipTrace.globalSequence` (bigint, unique across forks) |

### Delta event (`kind: "delta"`)

```
{chain_id}:d:{block_num}:{block_id[0..16]}:{code}:{scope}:{table}:{primary_key}
```

Example: `eos-mainnet:d:400000000:00017d7840ab12cd:eosio:eosio:global:...`

### Native-delta event (`kind: "native-delta"`)

```
{chain_id}:n:{block_num}:{block_id[0..16]}:{table}:{lookup_key}
```

Example: `eos-mainnet:n:400000000:00017d7840ab12cd:permission:alice:owner`

The `lookup_key` is provided by ship-reader's native delta deserialiser and typically encodes the natural primary key of the native table row (e.g. `owner:name` for `permission`).

### Fork event (`kind: "fork"`)

```
{chain_id}:f:{forked_from_block}:{new_head_block_id[0..16]}
```

Example: `eos-mainnet:f:399999999:00017d7700aa11bb`

## Fork scenarios

### Micro-fork (1-2 blocks)

```
Block 1000 → Block 1001 → Block 1002  (canonical)
                       ↘ Block 1002'  (fork, different block_id)
```

When the parser receives block 1002 with `block_num ≤ last_processed`, it emits a `fork` event **first** in the batch, then re-processes block 1002 normally.  Consumers that already processed 1002 must roll back their state.

The fork event ID includes `forked_from_block` (1001) and the first bytes of the new head block ID, so it is unique even for repeated micro-forks at the same depth.

### Consumer rollback pattern

```typescript
client.on('fork', async (event) => {
  // Roll back all state produced by blocks > event.forked_from_block
  await myDb.rollbackAfter(event.forked_from_block)
})
```

See `docs/disaster-recovery.md` for a full runbook.

## `irreversibleOnly` mode

When `irreversibleOnly: true` is set in config, the parser only publishes events for blocks with `block_num ≤ lastIrreversible.blockNum`.  Fork events are never emitted in this mode because irreversible blocks cannot be forked.  The tradeoff is higher latency (~300 blocks / ~2.5 min on EOS mainnet).
