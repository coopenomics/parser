# Native Tables Reference

`@coopenomics/coopos-ship-reader` exposes native SHiP table deltas for all 24 EOSIO system tables.

## Lookup Key Rules

Each native delta event has a `lookup_key` field computed deterministically from the row data:

| Table | `lookup_key` format |
|:------|:--------------------|
| `permission` | `"${owner}:${name}"` |
| `permission_link` | `"${account}:${code}:${message_type}"` |
| `account` | `"${name}"` |
| `account_metadata` | `"${name}"` |
| `code` | `"${code_hash}"` |
| `contract_table` | `"${code}:${scope}:${table}"` |
| `contract_row` | `"${code}:${scope}:${table}:${primary_key}"` |
| `contract_index64..long_double` | `"${code}:${scope}:${table}:${primary_key}"` |
| `key_value` | `"${database}:${contract}:${primary_key}"` |
| `received_block` | `"${block_num}"` |
| `block_info` | `"${block_num}"` |
| `resource_limits` | `"${owner}"` |
| `resource_usage` | `"${owner}"` |
| `generated_transaction` | `"${sender}:${sender_id}"` |
| `global_property` | `"global"` |
| `fill_status` | `"fill_status"` |
| `protocol_state` | `"protocol_state"` |
| `resource_limits_state` | `"resource_limits_state"` |
| `resource_limits_config` | `"resource_limits_config"` |
| `transaction_trace` | `"${id}"` |

## Attribution

Native-delta algorithms for the 24-table whitelist are derived from EOS Rio's
[Hyperion History Solution](https://github.com/eosrio/hyperion-history-api) (MIT).
No source files were copied. See `NOTICE` for full attribution.
