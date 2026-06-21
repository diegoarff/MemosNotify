# syntax=docker/dockerfile:1

# --- build stage ---------------------------------------------------------
FROM node:26-slim AS build
WORKDIR /app
RUN npm install -g corepack@latest && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

# --- runtime stage -------------------------------------------------------
FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pruned prod dependencies + bundled app + migrations (applied at startup)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/storage/drizzle/migrations ./src/storage/drizzle/migrations
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "dist/index.mjs"]
