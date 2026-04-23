FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

# ── deps layer ────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/parser2/package.json ./packages/parser2/
COPY packages/ship-reader/package.json ./packages/ship-reader/
RUN pnpm install --frozen-lockfile --prod

# ── runner (использует pre-built artifacts) ───────────────────────────────────
FROM base AS runner
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S parser && adduser -u 1001 -S parser -G parser

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/parser2/node_modules ./packages/parser2/node_modules
COPY --from=deps /app/packages/ship-reader/node_modules ./packages/ship-reader/node_modules

COPY packages/parser2/dist ./packages/parser2/dist
COPY packages/ship-reader/dist ./packages/ship-reader/dist
COPY packages/parser2/package.json packages/parser2/LICENSE packages/parser2/NOTICE ./packages/parser2/
COPY packages/ship-reader/package.json packages/ship-reader/LICENSE packages/ship-reader/NOTICE ./packages/ship-reader/
COPY package.json pnpm-workspace.yaml README.md ./

USER parser

ENV NODE_ENV=production
ENV LOG_LEVEL=info

ENTRYPOINT ["node", "packages/parser2/dist/cli/index.js"]
CMD ["--help"]
