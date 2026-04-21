# verifier-like example

Minimal example: Parser (SHiP → Redis indexer) and ParserClient (consumer) running in the same Node.js process. The consumer watches native `permission` table deltas and logs every account-key change.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Redis 7+ (with `appendonly yes`)
- Access to an EOSIO/Antelope node with SHiP plugin enabled

## 5-step startup

**Step 1 — Clone and install**

```bash
git clone https://github.com/coopenomics/parser.git
cd parser
pnpm install
```

**Step 2 — Build the package**

```bash
pnpm --filter @coopenomics/parser build
```

**Step 3 — Configure**

```bash
cp examples/verifier-like/.env.example examples/verifier-like/.env
# Edit .env: set SHIP_URL, CHAIN_ID, REDIS_URL, SUB_ID
```

**Step 4 — Start Redis** (if not already running)

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine redis-server --appendonly yes
```

**Step 5 — Run the example**

```bash
cd examples/verifier-like
pnpm start
```

Expected output:

```
Starting verifier-like example for chain: eos-mainnet
[400000000] permission UPSERT: eosio@active {"threshold":1,"keys":[...]}
[400000001] permission UPSERT: alice@owner {"threshold":1,"keys":[...]}
```

## Stopping

Press `Ctrl+C` — the process performs a graceful shutdown (drains in-flight messages, closes Redis connection).
