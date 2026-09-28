FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/hevc-player/package.json ./packages/hevc-player/package.json
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/diagnose.mjs ./scripts/diagnose.mjs
COPY --from=build --chown=node:node /app/app/lib/stream-source.mjs ./app/lib/stream-source.mjs
USER node
EXPOSE 3000
CMD ["node","server.js"]
