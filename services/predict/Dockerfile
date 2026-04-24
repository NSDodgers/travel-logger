# Bun predict service
# M2: skeleton; expanded in M10 with real percentile logic.
FROM oven/bun:1.1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/api/predict/health || exit 1

CMD ["bun", "run", "src/index.ts"]
