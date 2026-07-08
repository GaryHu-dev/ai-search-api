# syntax=docker/dockerfile:1

# Build stage: install everything, generate the Prisma client, compile to dist/.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build

# Runtime stage: ship only what the process needs to boot.
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
