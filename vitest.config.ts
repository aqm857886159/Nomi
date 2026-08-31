import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // scripts/ 两种后缀都收：历史门岗脚本是 .mjs，需要 import 仓库 TS 的脚本（如 model-radar 要
    // 从 seedBuiltins/档案 derive「我们接了哪些模型」）只能是 .ts。漏掉 .ts 的后果是**测试文件静静躺着不跑**
    // ——比没写测试更糟，因为它看起来有覆盖。
    include: [
      "electron/**/*.test.ts",
      "src/**/*.test.ts",
      "evals/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.ts",
      "tests/**/*.test.mjs",
    ],
    environment: "node",
    // 单测不做真 fsync：临时目录的数据没人需要它跨掉电存活，但 fsync 会让墙钟随磁盘队列漂移，
    // 把 productionRun 的编排测试顶过 5000ms testTimeout（flake 根因）。见该文件顶部注释。
    setupFiles: [fileURLToPath(new URL("./tests/setup/durability.ts", import.meta.url))],
    // flake 的另一条腿：测试自己不 fsync 了，但**邻居进程**打满文件系统时（这台机器 20+ worktree
    // 并行跑 gates 是常态），最重的编排测试仍会被外部负载从 ~300ms 拖过 5s——2026-08-25 实测：
    // 8 个 fsync 锤子进程加载下，durability 修复后 productionGateIdempotency / productionQaVerify
    // 仍两连挂在「Test timed out in 5000ms」，而安静机器 5 连绿。测试从未断言过自己的耗时，
    // 拿墙钟当判据只会把「机器忙」误报成「代码坏」。30s = 最重测试的 ~100× 余量，真死锁仍然会红。
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // node 单测不得加载真 electron 运行时（import 即抛"failed to install"）。
      // 统一指向无副作用的桩；真实构建走 vite.config.ts，不受影响。
      electron: fileURLToPath(new URL("./tests/stubs/electron.ts", import.meta.url)),
    },
  },
});
