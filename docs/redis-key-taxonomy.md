# Redis Key Taxonomy

All keys used by `@coopenomics/parser` follow a consistent namespace scheme.
Keys produced by the **parser (indexer)** use the prefix `ce:parser2:` or `parser2:`.

## Key catalogue

| Key pattern | Type | TTL | Produced by | Consumed by | Description |
|---|---|---|---|---|---|
| `ce:parser2:{chainId}:events` | Stream | ∞ (XTRIM) | Parser | ParserClient | Unified event stream: all `action`, `delta`, `native-delta`, `fork` events |
| `ce:parser2:{chainId}:dead:{subId}` | Stream | ∞ | FailureTracker | CLI / admin | Dead-letter stream for a specific subscription; entries include `data`, `failureCount`, `lastError`, `subId` |
| `ce:parser2:{chainId}:reparse:{jobId}` | Stream | ∞ | CLI (future) | Parser | On-demand reparse job stream |
| `parser2:abi:{contract}` | Sorted Set | ∞ | AbiStore | BlockProcessor / AbiBootstrapper | ABI version history; score = block_num, member = base64-encoded raw ABI bytes |
| `parser2:sync:{chainId}` | Hash | ∞ | Parser | Parser (crash-recovery) | Sync checkpoint: `block_num`, `block_id`, `last_updated` |
| `parser2:subs` | Hash | ∞ | ParserClient | CLI (list-subscriptions) | Subscription registry; field = subId, value = JSON metadata |
| `parser2:sub:{subId}:failures` | Hash | 24 h | FailureTracker | FailureTracker / CLI | Per-event failure counter; field = event_id, value = count |
| `parser2:sub:{subId}:lock` | String | 10 s (auto-renew) | SubscriptionLock | SubscriptionLock | Active-standby lock; value = instanceId |
| `parser2:reparse:{jobId}` | Hash | ∞ | CLI (future) | Parser | Reparse job metadata |

## Naming rules

- `chainId` is an arbitrary human-readable string (`eos-mainnet`, `telos`, …) set via `chain.id` in config.
- `subId` is the subscription identifier assigned by the consumer via `ParserClientOptions.subId`.
- `jobId` is a UUID assigned at job creation time.
- All stream entries use a single field `data` containing a JSON-serialised `ParserEvent`.  Dead-letter entries additionally carry `failureCount`, `lastError`, and `subId` fields.

## XTRIM policy

The events stream is trimmed by `XtrimSupervisor` using `XTRIM … MINID` based on a sliding time window (default: keep last 24 h).  The minimum retained ID is computed from `Date.now() - windowMs` converted to a Redis stream ID.
