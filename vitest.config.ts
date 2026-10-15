import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 用真 migration 砌 template DB（tests/setup/global.ts）；每個測試檔 clone 一個
    globalSetup: ["tests/setup/global.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
