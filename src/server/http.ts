#!/usr/bin/env node
/**
 * 開機入口（Fly.io 行呢個）。
 *
 * 環境變數（缺一唔起機 —— 寧願部機起唔到，都好過開咗一個人人入到嘅客戶名單）：
 *   DATABASE_URL    Supabase「Session pooler」嗰條（Settings → Database → Connection string）
 *   APP_PASSWORD    登入網頁／批准 claude.ai 連接嘅密碼（最少 10 個字元）
 *   SESSION_SECRET  簽 cookie／token 嘅 key（最少 32 個字元；換咗 ＝ 全部裝置要重新登入）
 *   PORT            Fly 自動畀，預設 8080
 *   BUILD_SHA       部署 workflow 塞入嚟，/health 報返
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDb } from "../db/client.js";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 8080);
const PASSWORD = process.env.APP_PASSWORD ?? "";
const SECRET = process.env.SESSION_SECRET ?? "";

function die(msg: string): never {
  console.error(`[global-call-crm] 起唔到：${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) die("DATABASE_URL 未設定");
if (PASSWORD.length < 10) die("APP_PASSWORD 未設定或者太短（最少 10 個字元）");
if (SECRET.length < 32) die("SESSION_SECRET 未設定或者太短（最少 32 個字元）—— openssl rand -base64 48");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const handler = createApp({
  sql: getDb, password: PASSWORD, secret: SECRET,
  publicDir: join(root, "public"), build: process.env.BUILD_SHA ?? "dev",
});

const server = createServer(handler);
server.on("error", (e: NodeJS.ErrnoException) => die(e.code === "EADDRINUSE" ? `port ${PORT} 有人用緊` : e.message));
server.listen(PORT, "0.0.0.0", () => console.error(`[global-call-crm] 聽緊 :${PORT}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
