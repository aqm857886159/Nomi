import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts", "src/**/*.test.ts", "evals/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node",
  },
  resolve: {
    alias: {
      // node 单测不得加载真 electron 运行时（import 即抛"failed to install"）。
      // 统一指向无副作用的桩；真实构建走 vite.config.ts，不受影响。
      electron: fileURLToPath(new URL("./tests/stubs/electron.ts", import.meta.url)),
    },
  },
});
