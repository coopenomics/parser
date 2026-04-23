# Parser v2 — Baseline Performance Report

## ABI ZSET Lookup

| Metric | Value |
|:---|:---|
| Sample size | 10 000 ZREVRANGEBYSCORE queries |
| Contracts | 100 unique, 10 ABI versions each (1 000 ZADD setup) |
| p50 latency | — (run against live Redis 7 to populate) |
| p95 latency | — |
| p99 latency | — (target: ≤ 0.5 ms per NFR-02) |

*Populate by running `pnpm tsx benchmarks/abi-performance.ts` against a local Redis 7 instance.*

## wharfkit ABI Parse Cache

| Metric | Value |
|:---|:---|
| Cold parse (ABI.from + cache miss) | — |
| Cache hit (Map lookup) | — |
| Speedup (cache vs cold) | — (target: ≥ 10×) |

## Notes

- Benchmark file: `benchmarks/abi-performance.ts` (Epic 4.4, to be run in CI gate E10)
- Results above are placeholders — fill after first live run
