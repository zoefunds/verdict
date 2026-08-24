# Multi-stage build for the VERDICT backend (Fastify + Node 20).
# Runs on Fly.io as an always-on machine (see fly.toml: min_machines_running = 1).

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle

# Evidence volume mount point — see fly.toml [[mounts]]
RUN mkdir -p /data/evidence
ENV EVIDENCE_STORAGE_PATH=/data/evidence

EXPOSE 4000
CMD ["node", "dist/index.js"]
