# =============================================================================
# Mutly Daemon Agent — Multi-stage Docker build
# Base: node:22-alpine (matches engines.node in package.json)
# =============================================================================
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS builder

WORKDIR /app

# ---------- Stage 1: Install dependencies ----------
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile --ignore-scripts

# ---------- Stage 2: Build source ----------
COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY src/ src/
COPY server/ server/
COPY index.html ./

# Build frontend (Vite SPA) and backend (esbuild server bundle)
RUN npx vite build && \
    npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs

# ---------- Stage 3: Production runtime ----------
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS runtime

WORKDIR /app

# Install tools needed for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -S mutly && adduser -S mutly -G mutly

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# Runtime data directory
RUN mkdir -p data && chown -R mutly:mutly /app

USER mutly

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=15s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
