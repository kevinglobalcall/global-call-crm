# Global Call CRM —— Fly.io
FROM node:22-slim

WORKDIR /app

# 先 copy manifest，npm ci 呢層可以 cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
# release_command 行 migration 要用
COPY supabase/migrations ./supabase/migrations

# 邊個 commit 起呢個 image（deploy.yml 傳入嚟）—— /health 報返，驗部署一句 curl 就得
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# ⚠️ DATABASE_URL／APP_PASSWORD／SESSION_SECRET 唔焗入 image，係 Fly secrets
CMD ["node", "--import", "tsx", "src/server/http.ts"]
