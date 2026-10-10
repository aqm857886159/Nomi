import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 真素材腿的文件名约定 —— 这份清单只有这一个 owner。
 * 默认车道按它 exclude，`vitest.realMedia.config.ts` 按它 include，两边读同一个常量，
 * 不会出现「一边排掉了、另一边没收进来」的静默空洞（正是本分支在修的那类根因）。
 */
export const REAL_MEDIA_TESTS = ["**/*.realMedia.test.ts"];

/** 两条车道都要排掉的产物目录。同样只有一个 owner，免得两边各写一份、漂成两套。 */
export const BUILD_ARTIFACTS = ["**/node_modules/**", "**/dist/**", "**/dist-electron/**"];

/** 一条车道的认领规则：recursive 目录树下 / 恰好某目录下，文件名以 suffix 结尾。 */
export type LaneRule = { root?: string; dir?: string; suffix: string };

/**
 * 默认 vitest 车道认领哪些文件——include 与「孤儿自检」读同一份，不写第二份。
 * 用「目录 + 后缀」而不是 glob 字符串，是为了自检不需要 glob 引擎（也不必新增依赖）；
 * 下面 include 由它机械生成。
 */
export const VITEST_LANE: LaneRule[] = [
  ...["electron", "src"].flatMap((root) => [{ root, suffix: ".test.ts" }, { root, suffix: ".test.tsx" }]),
  { root: "evals", suffix: ".test.ts" },
  { root: "evals", suffix: ".test.mjs" },
  { root: "scripts", suffix: ".test.mjs" },
  { root: "scripts", suffix: ".test.ts" },
  { root: "tests", suffix: ".test.mjs" },
];

/**
 * 不在默认车道、但**确有人跑**的测试样式文件。每条必须写明 runner（package.json 的 script 名），
 * 单测 scripts/vitest-lanes.test.ts 会核对这个 script 真的存在——「登记了却没人跑」同样过不了。
 * 新增一种测试样式文件，要么加进 VITEST_LANE，要么在这里认领；两处都没有 → vitest 起不来。
 */
export const OTHER_LANES: Array<LaneRule & { script: string; why: string }> = [
  { suffix: ".realMedia.test.ts", script: "test:real-media", why: "真素材腿，缺素材硬红，不进默认车道" },
  { dir: "tests/agent-runtime", suffix: ".test.mts", script: "test:agent-runtime", why: "tsc 编译后 node --test" },
  { dir: "scripts/packaging", suffix: ".test.cjs", script: "test:packaging", why: "node 直跑的打包断言" },
  { dir: "tests/ux/design-lab", suffix: ".spec.mjs", script: "check:design-lab", why: "Playwright 视觉基线" },
  { dir: "tests/ux", suffix: ".spec.ts", script: "test:toast-layout", why: "真浏览器几何断言，tsx --test，故意不混进无浏览器的 vitest" },
];

const TEST_STYLE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-electron", "release", "out", "coverage"]);

export function ruleClaims(rule: LaneRule, file: string): boolean {
  if (!file.endsWith(rule.suffix)) return false;
  if (rule.dir !== undefined) return file.startsWith(`${rule.dir}/`) && !file.slice(rule.dir.length + 1).includes("/");
  if (rule.root !== undefined) return file.startsWith(`${rule.root}/`);
  return true;
}

/** 列出仓库里所有测试样式文件（相对路径，/ 分隔）。点目录与产物目录不进。 */
export function listTestStyleFiles(repoRoot: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(rel ? `${repoRoot}/${rel}` : repoRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        walk(rel ? `${rel}/${entry.name}` : entry.name);
      } else if (TEST_STYLE.test(entry.name)) out.push(rel ? `${rel}/${entry.name}` : entry.name);
    }
  };
  walk("");
  return out;
}

/** 没有任何车道认领的测试样式文件 = 静静躺着不跑的测试。 */
export function findOrphanTests(files: string[]): string[] {
  return files.filter((f) => !VITEST_LANE.some((r) => ruleClaims(r, f)) && !OTHER_LANES.some((r) => ruleClaims(r, f)));
}

// 配置期自检：有孤儿就让 vitest 起不来。写了测试却没人跑，比没写更糟（看起来有覆盖）。
const orphans = findOrphanTests(listTestStyleFiles(fileURLToPath(new URL(".", import.meta.url))));
if (orphans.length > 0) {
  throw new Error(
    `以下测试文件没有任何车道认领，会静静躺着不跑：\n  ${orphans.join("\n  ")}\n` +
      "改 vitest.config.ts：放进 VITEST_LANE，或在 OTHER_LANES 登记 runner。",
  );
}

export default defineConfig({
  test: {
    // scripts/ 两种后缀都收：历史门岗脚本是 .mjs，需要 import 仓库 TS 的脚本（如 model-radar 要
    // 从 seedBuiltins/档案 derive「我们接了哪些模型」）只能是 .ts。漏掉 .ts 的后果是**测试文件静静躺着不跑**
    // ——比没写测试更糟，因为它看起来有覆盖。
    include: VITEST_LANE.map((r) => `${r.root}/**/*${r.suffix}`),
    // 真素材腿**不进这条车道**。它们按设计「缺素材就硬红」（R13 四件真实第④件 / R17：
    // 登记即放绿的 skip 是自欺），而 CI runner 上没有那 1.38GB 素材——放进来只会让每个 PR
    // 红在一件与改动无关的事上，红灯一旦不可信，人就开始绕过它。
    // 登记表 tests/ux/real-media-fixtures.json 里其余 live 条目（.probe.mjs / .walk.mjs /
    // scripts/*.ts）天然落在 include 之外，本行只是把同一条规矩写给 *.realMedia.test.ts。
    // 跑它：`pnpm run test:real-media`（缺素材照样硬红，不 skip）。
    exclude: [...REAL_MEDIA_TESTS, ...BUILD_ARTIFACTS],
    environment: "node",
    // Fork workers reuse a child process across files; restore every vi.stubEnv mutation
    // before the next test can observe it.
    unstubEnvs: true,
    // 单测不做真 fsync：临时目录的数据没人需要它跨掉电存活，但 fsync 会让墙钟随磁盘队列漂移，
    // 把 productionRun 的编排测试顶过 5000ms testTimeout（flake 根因）。见该文件顶部注释。
    setupFiles: [fileURLToPath(new URL("./tests/setup/durability.ts", import.meta.url)),
      fileURLToPath(new URL("./tests/setup/networkTransport.ts", import.meta.url)),
      // 技能目录的 CJS→岛桥在源码上不存在（要编译产物）；单测里把 readSkillRecords 直接接到岛上（见文件头）。
      fileURLToPath(new URL("./tests/setup/skillCatalogBridge.ts", import.meta.url)),
      // 每个用例后核模块级单例里有没有没落定的后台任务（跨用例泄漏），见文件头。
      fileURLToPath(new URL("./tests/setup/inflightWork.ts", import.meta.url))],
    globalSetup: fileURLToPath(new URL("./tests/setup/tempWorkspace.ts", import.meta.url)),
    // flake 的另一条腿：测试自己不 fsync 了，但**邻居进程**打满文件系统时（这台机器 20+ worktree
    // 并行跑 gates 是常态），最重的编排测试仍会被外部负载从 ~300ms 拖过 5s——2026-08-25 实测：
    // 8 个 fsync 锤子进程加载下，durability 修复后 productionGateIdempotency / productionQaVerify
    // 仍两连挂在「Test timed out in 5000ms」，而安静机器 5 连绿。测试从未断言过自己的耗时，
    // 拿墙钟当判据只会把「机器忙」误报成「代码坏」。30s = 最重测试的 ~100× 余量，真死锁仍然会红。
    testTimeout: 30_000,
    // 疑似不稳定的测试自动标出来（只提示、不阻断）：CI 里失败的测试重试 1 次；重试后才过的，vitest 自带的
    // github-actions reporter（4.1 起，GITHUB_ACTIONS=true 时默认开）会在 Job Summary 的 Flaky 小节列出
    // 「文件 / 测试名 / 重试几次」。自己一行代码都没写——这就是现成能力。本机不重试：红就是红，不被重试盖住。
    // 重试只在真失败时才多跑一次，全绿的一次运行零额外耗时。
    retry: process.env.GITHUB_ACTIONS === "true" ? 1 : 0,
    // 显式写 reporters 就不再自动补 github-actions，所以 CI 里三个都要列：default / github-actions（失败注解 + Job Summary）/
    // 我们的十来行 reporter（把重试后才过的变成「疑似不稳定」warning 注解，PR 检查结果里能读到）。本机保持 vitest 默认。
    ...(process.env.GITHUB_ACTIONS === "true"
      ? { reporters: ["default", "github-actions", fileURLToPath(new URL("./scripts/vitest-flaky-reporter.mjs", import.meta.url))] }
      : {}),
    // 浏览器 fixture 的 beforeAll/beforeEach 也要共享同一份 CI 资源余量；默认 10s 会在
    // full lane 的多个 Vite/Chromium fixture 并行初始化时误报超时。长 hook 仍受测试本身的
    // assertions 和 process 退出约束，不改变产品运行时。
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      // node 单测不得加载真 electron 运行时（import 即抛"failed to install"）。
      // 统一指向无副作用的桩；真实构建走 vite.config.ts，不受影响。
      electron: fileURLToPath(new URL("./tests/stubs/electron.ts", import.meta.url)),
    },
  },
});
