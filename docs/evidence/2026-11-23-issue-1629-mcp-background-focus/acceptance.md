v-1609-accept：通过

## 验收元信息

- 任务：修复 Issue #1629（PR #1634 · macOS 启动外部宿主后台连接 MCP 时抢占 Nomi 窗口焦点）
- 验收线：v-1609-accept
- 实现线：issues-1629-and-drafts
- 验收 HEAD：836a84fe065cb8d14c960276ef3398043b58e06c
- 验收分支：`fix/issue-1629-mcp-background-focus`（仅追加本验收报告，未修改任何实现或测试代码）

## 1. 独立核验与全部阻断清零记录

- **第 1 轮核验（`6887665a0`）**：独立实跑拦出 2 项硬 CI 门岗阻断：
  1. `B1`：`check:concept-owners` 报 3 处 `unregistered-boundary`；
  2. `B2`：`check:filesize` 报 `electron/main.ts` 699 行 > 冻结上限 682 行。
- **第 2 轮复验（`a6e53ddd2`）**：验证 B1 / B2 全部清零（新增 `docs/engineering/concept-owners/desktop.launch-intent.json` 登记 3 条 `write_api`；抽离 `bootMcpStdioMainProcess` 使 `electron/main.ts` 降至 **675 行 < 682**，且 `check:boundaries` 零新增越界）；同时 `check-pr-judgement.mjs` 拦出 `B3`（合同 `detected_by: "user"` 尚缺逃逸账本条目及类级矩阵测试形状）。
- **第 3 轮推送档复验（`395b8ebc6e35`）**：验证 `desktopLaunchIntent.test.ts` 重构为 `LAUNCH_INTENT_MATRIX`（9 格）+ `SECOND_INSTANCE_MATRIX`（10 格）参数化 `it.each` 矩阵（19/19 passed）并新增 `USER-20261123-mcp-background-focus.json`。
- **最终合并档复验（`836a84fe065cb8d14c960276ef3398043b58e06c`）**：核对仅单文件变更——`tests/ux/full-walk/escapeLedger/USER-20261123-mcp-background-focus.json` 结账为 `status: "fixed"`、`fixedInPr: 1634`；复跑 `node ./scripts/check-escape-ledger.mjs`（171 条账本 0 错误，fixed 120）与 `node scripts/fix-churn.mjs --range origin/main..HEAD` 全绿。

## 2. 架构与代码边界核查

- **唯一启动意图判定边界**：`electron/productionRun/desktopLaunchIntent.ts` 统一 `classifyProcessLaunch` / `isMcpStdioLaunch` / `isBackgroundDesktopLaunch` / `singleInstanceLockData` / `classifySecondInstance`，零 `electron` 依赖，被 `electron/main.ts`、`electron/backgroundLaunch.ts`、`electron/mainProcessLifecycle.ts`、`electron/diagnostics/stallMonitor.ts`、`electron/telemetry/sessionExit.ts`、`electron/productionRun/productionRunDesktopLifecycle.ts` 共用，无散落副本。
- **双向防护完整**：
  - 入口侧（`electron/main.ts` + `bootMcpStdioMainProcess`）：在 `installMainProcessLifecycle` 与 `requestSingleInstanceLock` 之前识别 `NOMI_MCP_STDIO=1`、`--mcp-stdio` 或 `mcpNodeLauncher.js` / `mcpHttpForwarder.js` / `mcpServerEntry.js`，命中即 `app.dock?.hide?.()`、跳过单实例锁并进入无头 MCP 模式；后台冷启通过 `app.requestSingleInstanceLock({ launchIntent: "background" })` 透传身份；
  - 接收侧（`electron/productionRun/productionRunDesktopLifecycle.ts`）：`second-instance` 经 `classifySecondInstance(commandLine, additionalData)` 守卫，后台 MCP / `Nomi Helper` / 后台冷启锁竞争仅记 `second-instance-background-ignored` 绝不调用 `revealMainWindow`；用户显式再次打开与 `nomi://` 深链仍正常恢复并聚焦主窗，macOS Dock `activate` 不受影响。
- **老用户兼容（★1c）与路径安全**：不改动 `mcpConfig.ts` 既有配置格式，老用户 Codex / Claude / Cursor 现有配置零重配；`git diff origin/main...HEAD` 本机路径扫描 **0 泄露**。

## 3. 独立实跑测试与门岗结果

- **桌面/生命周期 Vitest 全绿（7/7 套，164/164 passed，0 failed）**：
  - `electron/productionRun/desktopLaunchIntent.test.ts`：**19 passed**（`LAUNCH_INTENT_MATRIX` 9 + `SECOND_INSTANCE_MATRIX` 10）
  - `electron/productionRun/productionRunDesktopLifecycle.test.ts`：**9 passed**
  - `electron/mainProcessLifecycle.test.ts`：**8 passed**
  - `electron/diagnostics/stallMonitor.test.ts`：**20 passed**
  - `electron/mainWindowPresence.test.ts`：**93 passed**
  - `electron/telemetry/sessionExit.test.ts`：**10 passed**
  - `electron/backgroundLaunch.inflight.test.ts`：**5 passed**
- **3 套 MCP 启动器/配置关联 Vitest（3/3 套，64/64 passed）**：
  - `electron/capabilityCore/mcpConfig.test.ts`（53）、`electron/capabilityCore/mcpNodeLauncher.test.ts`（7）、`electron/capabilityCore/mcpNodeLauncherRelaunch.test.ts`（4）。
- **全部 10 项仓库门岗与静态检查全绿（0 错）**：
  - `node ./scripts/check-escape-ledger.mjs`：**通过**（`836a84fe0` 实跑，171 条 0 错误，fixed 120）
  - `node ./scripts/check-concept-owners.mjs`：**通过**（399 个概念 · 写接口 1047 个 · 第二写口 0 新增）
  - `pnpm run check:filesize`：**通过**（`electron/main.ts` 675 行 < 冻结上限 682 行）
  - `pnpm run check:boundaries`：**通过**（无新增越界/硬环）
  - `node ./scripts/check-root-cause-contracts.mjs`：**通过**
  - `node ./scripts/check-self-written.mjs`：**通过**
  - `node ./scripts/check-boundary-owners.mjs`：**通过**
  - `node scripts/fix-churn.mjs --range origin/main..HEAD`：**通过**（`836a84fe0` 实跑）
  - `pnpm exec tsc -p electron/tsconfig.json --noEmit`：**通过**（0 类型错误）
  - `node scripts/lint-changed.mjs`：**通过**（0 错误）

## 4. 独立变异反例核验（确保「什么都不做」与「全部拦下」均必红）

| 变异反例 | 注入改动 | 目标 4 套测试结果 | 恢复后复绿 |
|---|---|---|---|
| M1 · 什么都不做 | 将 `classifySecondInstance` 的 `shouldRevealWindow: false` 改为 `true` | **红（退出码 1）**：2 文件 3 用例失败（拦截到 `restore/show/focus` 被误调用） | 全绿 |
| M2 · 全部拦下 | 将 `classifySecondInstance` 的 `shouldRevealWindow: true` 改为 `false` | **红（退出码 1）**：2 文件 5 用例失败（正对照用户双击打开、零窗建窗、最小化恢复、辅助窗跳过与 `nomi://` 深链均红） | 全绿 |
| M3 · 去掉 argv 脚本识别 | 将 `classifyProcessLaunch` 的 `matchMcpScriptKind(args)` 置 `undefined` | **红（退出码 1）**：3 文件 4 用例失败（`desktopLaunchIntent` + `mainProcessLifecycle` + `stallMonitor`） | 全绿 |

## 5. 残余风险与诚实边界

- 本工作树无已签名打包版 `Nomi.app` DMG 与 macOS ChatGPT Desktop `26.1111.21308` 实机联动环境，真实宿主机联动场景诚实记为 `unverified`；所有入口 argv / 剥离环境变量 / `second-instance` 载荷与窗口恢复正反对照均已由参数化矩阵与生命周期测试锁死。

## 结论

`836a84fe065cb8d14c960276ef3398043b58e06c`（PR #1634）已清零 B1 / B2 / B3 与逃逸账本 `fixed` 结账全部要求，10 套单测（228/228）、10 项仓库门岗与 3 项变异反例全绿，零本机路径泄露，签发 **通过**。
