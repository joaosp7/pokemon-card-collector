# syntax=docker/dockerfile:1
# Imagem Debian (slim), nao alpine: better-sqlite3 e sharp usam binarios nativos glibc.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
# better-sqlite3 traz binarios pre-compilados em prebuilds/ (linux-x64 glibc incluso);
# --ignore-scripts evita o `node-gyp rebuild` (que exigiria python/g++ na imagem).
RUN npm ci --ignore-scripts

FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /build/web
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /build/web/node_modules ./node_modules
COPY web/ ./
RUN npm run build

FROM node:${NODE_VERSION}-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# O app resolve os dados a partir de process.cwd()/.. (ver web/lib/data-paths.ts):
#   cwd=/app/web  ->  /app/data (catalog.db, ownership.db) e /app/cards (imagens).
# Ambos sao volumes montados em runtime; nada disso fica na imagem.
WORKDIR /app/web
COPY --from=builder --chown=node:node /build/web/.next/standalone ./
COPY --from=builder --chown=node:node /build/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /build/web/public ./public
RUN mkdir -p /app/data /app/cards && chown node:node /app/data /app/cards
USER node
EXPOSE 3000
CMD ["node", "server.js"]
