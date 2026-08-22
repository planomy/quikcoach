# syntax=docker/dockerfile:1

# Build the Vite/React client with its development dependencies available.
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# Production image: only the Node server, production dependencies and built client.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3001

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server && npm cache clean --force

COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist/

# SQLite and student board media live outside the disposable app container.
# Mount a persistent volume at /data in Railway/AWS/Azure.
RUN mkdir -p /data

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "start", "--prefix", "server"]
