# syntax=docker/dockerfile:1

# Build stage: install everything, generate the Prisma client, compile to dist/,
# then drop dev dependencies so only production packages (plus the generated
# Prisma client) remain for the runtime image.
FROM node:24-alpine AS build
# openssl (libssl) — Prisma's query engine needs it on Alpine/musl.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build && pnpm prune --prod

# Runtime stage: ship only what the process needs to boot.
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# openssl (libssl) for Prisma's engine, then the Prisma CLI itself (the client +
# query engines are already in node_modules; the CLI is pruned as a
# devDependency). Needed to apply migrations at startup.
RUN apk add --no-cache openssl && npm install -g prisma@6.10.1

USER node
EXPOSE 3000
# Apply any pending migrations, then boot. Safe on a single instance.
CMD ["sh", "-c", "prisma migrate deploy && node dist/main.js"]
