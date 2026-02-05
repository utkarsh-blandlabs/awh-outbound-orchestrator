# ============================================================================
# AWH Outbound Orchestrator - Production Dockerfile
# Multi-stage build: Stage 1 builds TypeScript, Stage 2 runs production
# ============================================================================

# --- Stage 1: Build TypeScript ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy TypeScript source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript (outputs to /app/build/)
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:20-alpine

WORKDIR /app

# Set timezone to EST (matches existing deployment)
ENV TZ=America/New_York
ENV NODE_ENV=production

# Install curl for health checks
RUN apk add --no-cache curl

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built JavaScript from builder stage
COPY --from=builder /app/build ./build

# Copy version.json (used by versionService)
COPY version.json ./

# Create data and logs directories (overridden by volume mounts)
RUN mkdir -p /app/data /app/logs

EXPOSE 3000

# Health check matching /health endpoint in index.ts
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "build/index.js"]
