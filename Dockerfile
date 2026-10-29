# ---- build stage: minified, hashed, precompressed client bundle ----
FROM node:22.23.4-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN node tools/build.mjs && node tools/budget.mjs

# ---- runtime stage: server + dist only, non-root, healthchecked ----
FROM node:22.23.4-alpine
RUN apk add --no-cache ffmpeg tini
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund
COPY server/ server/
COPY richtext.js protection-core.js minors-core.js ./
COPY store.js v12.js seed/
ENV SEED_ROOT=/app/seed
COPY --from=build /src/dist/ dist/
ENV NODE_ENV=production PORT=8080 WEB_ROOT=/app/dist STORAGE_DIR=/data/storage LOG_REQUESTS=1
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/server.js"]
