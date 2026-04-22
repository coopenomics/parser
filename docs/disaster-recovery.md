# Disaster Recovery Runbook

This document covers recovery procedures for common failure scenarios involving `@coopenomics/parser`.

---

## Scenario 1 — Redis data loss (RDB/AOF corruption or total loss)

**Symptoms:** Parser starts but emits no events; `redis-cli HGET parser:sync:<chainId> block_num` returns nil.

**Impact:** The sync checkpoint is lost. The parser will restart from block 0 (or the last known position in config). Consumers will re-process old events — their handlers must be idempotent.

### Recovery steps

1. **Stop the parser.**
   ```bash
   kill -SIGTERM <parser-pid>
   ```

2. **Decide start block.** If you know the last safely processed block, set it manually:
   ```bash
   redis-cli HSET parser:sync:<chainId> block_num <N> block_id <ID> last_updated $(date -u +%FT%TZ)
   ```
   If unknown, leave empty and the parser will replay from 0.

3. **Clear stale consumer group positions** for each subscription so consumers don't skip events:
   ```bash
   parser reset-subscription --chain <chainId> --sub-id <subId> --to-block 0
   ```

4. **Restart the parser.**

5. **Monitor lag** via `/health` endpoint or `parser_indexing_lag_seconds` Prometheus metric.

---

## Scenario 2 — Parser crash mid-block

**Symptoms:** Parser process exits unexpectedly. Redis sync hash may reflect the last **completed** block.

**Impact:** Partial block processing is never committed (the sync hash is only written after all events for a block are XADDed). No data corruption; the parser will re-process the incomplete block on restart.

### Recovery steps

Simply restart the parser. The sync hash guarantees replay from the last complete block.

---

## Scenario 3 — Consumer handler failures → dead-letter accumulation

**Symptoms:** `ce:parser:<chainId>:dead:<subId>` stream grows; `parser_client_dead_letters_total` counter rising.

### Recovery steps

1. **Inspect dead letters:**
   ```bash
   parser list-dead-letters --chain <chainId> --sub-id <subId> --limit 50
   ```

2. **Fix the handler** so it no longer throws for the affected event shape.

3. **Replay a single event** (after the fix is deployed):
   ```bash
   parser replay-dead-letter --chain <chainId> --sub-id <subId> --event-id <id>
   ```

4. **Replay all dead letters** at once:
   ```bash
   parser replay-dead-letter --chain <chainId> --sub-id <subId> --all
   ```
   Use `--dry-run` first to preview the count.

---

## Scenario 4 — Fork causes consumer state inconsistency

**Symptoms:** Consumer has processed block N but later receives a `fork` event with `forked_from_block < N`.

### Recovery steps

Consumers **must** handle the `fork` event and roll back any state derived from blocks after `forked_from_block`:

```typescript
client.on('fork', async (event) => {
  // Example: revert a Postgres table
  await db.query(
    'DELETE FROM indexed_actions WHERE block_num > $1',
    [event.forked_from_block],
  )
})
```

If the consumer did not implement fork handling and state is inconsistent:

1. Stop the consumer.
2. Manually truncate/rollback consumer state to a safe block.
3. Use `parser reset-subscription` to re-position the consumer group:
   ```bash
   parser reset-subscription --chain <chainId> --sub-id <subId> --to-block <safe-block>
   ```
4. Restart the consumer.

---

## Scenario 5 — ABI cache corruption

**Symptoms:** Events for a specific contract have `data: {}` or deserialization errors in logs.

### Recovery steps

Prune the corrupted ABI history and let the bootstrapper re-fetch from chain:

```bash
# Preview what would be pruned
parser abi-prune --account <contract> --before-block <current_head> --dry-run

# Execute prune
parser abi-prune --account <contract> --before-block <current_head>
```

The parser will automatically re-fetch the ABI from the chain RPC on the next block that involves this contract.

---

## General health checks

| Check | Command |
|---|---|
| Parser lag | `curl http://localhost:9090/health` |
| Prometheus metrics | `curl http://localhost:9090/metrics` |
| Stream length | `redis-cli XLEN ce:parser:<chainId>:events` |
| Sync position | `redis-cli HGETALL parser:sync:<chainId>` |
| Dead letters | `parser list-dead-letters --chain <chainId> --all` |
