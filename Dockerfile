FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN npm install --global pnpm@10.15.1
COPY package.json pnpm-lock.yaml ./
COPY scripts/prepare-highs.mjs ./scripts/prepare-highs.mjs
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATABASE_PATH=/app/.data/users.sqlite

# tsx нужен серверу в runtime; сохраняем установленные зависимости вместе с ним.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/domain ./packages/domain
COPY --from=build /app/packages/game-data/*.json ./packages/game-data/
COPY --from=build /app/dist/web ./dist/web
COPY --from=build /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "apps/api/server.ts"]
