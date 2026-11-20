# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-alpine AS build
# Prisma's query engine needs OpenSSL on Alpine
RUN apk add --no-cache openssl
WORKDIR /app

# Install all dependencies (dev deps are needed for the TypeScript build).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Generate the Prisma client before compiling.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app

# Production mode: secure refresh cookie, CSP enabled, no tsx/watch.
ENV NODE_ENV=production

# Runtime dependencies only, including `prisma` for `migrate deploy`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Prisma schema + migrations, and the generated client for this image.
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
COPY data ./data

# The app writes uploaded floor plans under data/floor_svgs at runtime.
RUN mkdir -p data/floor_svgs && chown -R node:node /app
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then start the compiled API (no hot reload). Seeding stays explicit.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
