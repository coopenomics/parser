# Coopenomics Parser

Универсальный индексер блокчейнов EOSIO / Antelope: читает блоки из State History Plugin (SHiP) по WebSocket, декодирует actions и дельты таблиц с учётом исторических ABI, публикует унифицированный поток событий в Redis Stream. Потребители получают события через `ParserClient` с single-active-consumer lock'ом, recovery после сбоев и dead-letter для poison-messages.

[![CI](https://github.com/coopenomics/parser/actions/workflows/ci.yml/badge.svg)](https://github.com/coopenomics/parser/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@coopenomics/parser.svg)](https://www.npmjs.com/package/@coopenomics/parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Зачем

SHiP отдаёт сырые бинарные блоки — чтобы превратить их в прикладной поток событий, нужно: держать кэш ABI за каждый блок (контракты обновляют ABI, старые блоки декодируются старой версией), обрабатывать форки и переподключения, распределять нагрузку между подписчиками. Этот проект закрывает весь этот слой и отдаёт вам единый стрим `action` / `delta` / `native-delta` / `fork` событий.

## Пакеты монорепы

| Пакет | Описание | npm |
|:---|:---|:---|
| [`@coopenomics/parser`](packages/parser) | Ядро индексера (Parser) + подписочный клиент (ParserClient), CLI, observability | [`@coopenomics/parser`](https://www.npmjs.com/package/@coopenomics/parser) |
| [`@coopenomics/coopos-ship-reader`](packages/ship-reader) | Низкоуровневый WebSocket SHiP клиент с поддержкой 24 нативных системных таблиц | [`@coopenomics/coopos-ship-reader`](https://www.npmjs.com/package/@coopenomics/coopos-ship-reader) |

## Быстрый старт

### 1. Установка

```bash
pnpm add @coopenomics/parser
# или если используете только SHiP-клиент без Redis-пайплайна:
pnpm add @coopenomics/coopos-ship-reader
```

Требования рантайма:
- Node ≥ 20
- Redis ≥ 7 (с persistence — AOF/RDB)
- Доступ до SHiP endpoint блокчейн-ноды (`ws://node:8080`)
- Доступ до Chain API ноды (`http://node:8888`)

### 2. Запуск парсера

Создай `parser.config.yaml`:

```yaml
ship:
  url: ws://my-nodeos:8080
  timeoutMs: 15000
chain:
  url: http://my-nodeos:8888
redis:
  url: redis://localhost:6379
abiFallback: rpc-current
xtrim:
  enabled: true
  intervalMs: 60000
logger:
  level: info
  pretty: false
health:
  enabled: true
  port: 8081
metrics:
  enabled: true
  port: 9090
```

Запусти через CLI (после глобальной установки пакета):

```bash
parser start --config parser.config.yaml
```

Парсер подключится к SHiP, начнёт читать блоки с последней checkpoint-позиции (или с head если запускается впервые), и публиковать события в Redis stream `ce:parser:<chainId>:events`.

### 3. Подписка на события из приложения

```typescript
import { ParserClient } from '@coopenomics/parser'

const client = new ParserClient({
  subscriptionId: 'my-app',
  filters: [
    { kind: 'action', account: 'eosio.token', name: 'transfer' },
    { kind: 'action', account: 'eosio.token', name: 'issue' },
  ],
  startFrom: 'last_known',
  redis: { url: 'redis://localhost:6379' },
  chain: { id: 'eb004c7dcb6e92f5ba9c98e0d86a616e79ec4e7c80bc1a66c0d6c8d6c...' },
})

for await (const event of client.stream()) {
  if (event.kind === 'action') {
    console.log(
      `${event.block_num} | ${event.account}::${event.name}`,
      event.data,
    )
    // Если обработчик упадёт (throw) — событие попадёт в dead-letter после 3 попыток
  }
}
```

Несколько реплик одного `subscriptionId` автоматически выберут **одного active**-потребителя через distributed lock; остальные встанут в standby и подхватят при падении active.

### 4. CLI-утилиты

```bash
# Посмотреть все зарегистрированные подписки и их отставание
parser list-subscriptions

# Сбросить cursor подписки на начало стрима
parser reset-subscription --sub-id my-app --start-from 0

# Посмотреть dead-letter сообщения
parser list-dead-letters --sub-id my-app

# Replay одного dead-letter обратно в основной поток
parser replay-dead-letter --sub-id my-app --dl-id 1699999999999-0

# Удалить старые ABI-версии (GC)
parser abi-prune --keep-last 10 --all-contracts
```

## Docker

Публичный образ: [`dicoop/parser`](https://hub.docker.com/r/dicoop/parser) — multi-arch (`linux/amd64`, `linux/arm64`).

```bash
docker pull dicoop/parser:latest
# или конкретная версия
docker pull dicoop/parser:1.0.1
```

### Минимальный запуск

Парсер читает конфигурацию из YAML-файла, путь передаётся через `--config`:

```bash
docker run --rm \
  -v $(pwd)/parser.config.yaml:/app/parser.config.yaml:ro \
  --network host \
  dicoop/parser:latest \
  start --config /app/parser.config.yaml
```

### docker-compose.yml

Полная конфигурация с Redis:

```yaml
services:
  redis:
    image: redis:7-alpine
    command: >-
      redis-server
      --appendonly yes
      --appendfsync everysec
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"

  parser:
    image: dicoop/parser:1.0.1
    depends_on:
      - redis
    volumes:
      - ./parser.config.yaml:/app/parser.config.yaml:ro
    command: ["start", "--config", "/app/parser.config.yaml"]
    ports:
      - "8081:8081"   # /health
      - "9090:9090"   # /metrics (Prometheus)
    restart: unless-stopped

volumes:
  redis-data:
```

`parser.config.yaml` рядом с compose-файлом:

```yaml
ship:
  url: ws://nodeos:8080
  timeoutMs: 15000
chain:
  url: http://nodeos:8888
redis:
  url: redis://redis:6379
abiFallback: rpc-current
xtrim:
  enabled: true
  intervalMs: 60000
reconnect:
  maxAttempts: 10
  backoffSeconds: [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800]
logger:
  level: info
  pretty: false     # для production — JSON logs в stdout
health:
  enabled: true
  port: 8081
metrics:
  enabled: true
  port: 9090
irreversibleOnly: false    # читать head-блоки (false) или ждать last_irreversible (true)
```

Запуск: `docker compose up -d`. `/health` отдаст `200 OK` как только парсер подключился к SHiP, `/metrics` — экспорт для Prometheus.

### Переопределение CLI-команды

Контейнер по умолчанию запускает `parser start`, но можно использовать любую другую команду:

```bash
# Посмотреть подписки в прод-Redis
docker run --rm --network host \
  -e REDIS_URL=redis://localhost:6379 \
  dicoop/parser:latest \
  list-subscriptions
```

## Архитектура

```
┌──────────────┐   WS   ┌──────────────┐            ┌──────────────┐
│  EOSIO node  │────────▶│   Parser     │──XADD────▶│              │
│  (SHiP+RPC)  │        │              │            │              │
└──────────────┘        │  • AbiStore  │            │    Redis     │
                        │  • Workers   │            │              │
                        │  • ForkDet.  │            │  Streams +   │
                        │  • XtrimSup. │            │  Hashes +    │
                        └──────────────┘            │  ZSets       │
                                                    │              │
                        ┌──────────────┐            │              │
                        │ ParserClient │◀─XREADGR──│              │
                        │   #1 active  │            │              │
                        └──────────────┘            └──────────────┘
                        ┌──────────────┐                    ▲
                        │ ParserClient │────────────────────┘
                        │   #2 standby │ (ждёт lock)
                        └──────────────┘
```

Подробности:
- [Redis key taxonomy](docs/redis-key-taxonomy.md)
- [Disaster recovery / fork scenarios](docs/disaster-recovery.md)

## Разработка

### Структура монорепы

```
.
├── packages/
│   ├── parser/            # @coopenomics/parser — ядро + CLI + ParserClient
│   └── ship-reader/       # @coopenomics/coopos-ship-reader — SHiP WS клиент
├── docs/                  # redis taxonomy, disaster recovery
├── examples/              # пример verifier-like подписчика
└── .github/workflows/     # CI + Release
```

### Установка зависимостей

```bash
pnpm install
```

### Сборка

```bash
pnpm build           # build всех пакетов
pnpm --filter @coopenomics/parser build   # только parser
```

### Тесты

```bash
pnpm test            # unit во всех пакетах
pnpm --filter @coopenomics/parser test:unit
pnpm --filter @coopenomics/parser test:integration   # нужен Docker для блокчейн-ноды
```

**Текущее покрытие:**
- `@coopenomics/parser`: 81% statements / 74% functions (205 unit-тестов)
- `@coopenomics/coopos-ship-reader`: 81% statements / 86% functions (51 unit-тест)

### Бенчмарк

```bash
pnpm --filter @coopenomics/coopos-ship-reader bench
```

Замеряет throughput wharfkit-десериализатора — используется для контроля регрессий перформанса между версиями.

### Ветки и релизы

- `dev` — рабочая ветка разработки; push / PR сюда запускает CI (lint, typecheck, unit, integration, build)
- `main` — релизная ветка; merge из `dev` автоматически публикует через Lerna

Процесс релиза через Lerna (independent versioning):

```bash
# 1. В dev сделать изменения, закоммитить через blago flow
# 2. Посмотреть какие пакеты будут опубликованы:
pnpm changed

# 3. Поднять версии интерактивно (Lerna сам предложит семвер по коммитам):
pnpm release
# → изменит packages/*/package.json, создаст тег(и), закоммитит + запушит
# (локально можно также dry-run: pnpm release:version --no-push --no-git-tag-version)

# 4. Смёрджить dev → main (обычным PR)
# 5. GitHub Actions release.yml автоматически:
#    • lerna publish from-package — опубликует в npm только пакеты с новой версией
#    • changelogithub — создаст GitHub Release с changelog
#    • docker build-push — опубликует образ в docker.io/dicoop/parser:<version>
```

Альтернативно, если lerna version не использовалась — можно вручную поднять версию в `packages/*/package.json`, смёрджить в main, и workflow опубликует.

## Лицензия

MIT. См. [LICENSE](LICENSE) и [NOTICE](packages/ship-reader/NOTICE) для атрибуции third-party компонентов.
