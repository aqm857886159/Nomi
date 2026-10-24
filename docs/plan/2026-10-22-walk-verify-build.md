# 走查 / e2e / 性能驱动起跑前核构建戳（设计卡，★5 格）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

类别：根因明确的小修 + 门岗，不碰花钱 / 长跑 / 新界面，只填 ★ 5 格（1、2、3、4、9）。

## 开工三问

1. 近 14 天修过几次：`node scripts/fix-churn.mjs tests/ux/_launchApp.mjs tests/ux/_directorLab.mjs scripts/package-build-stamp.mjs` → 未命中热点。
2. 独有领域吗：不是。「产物是否比源码新」是通用构建缓存校验，已有现成机制 `scripts/package-build-stamp.mjs`（`verifyBuild`，戳 = 构建当时的源码树指纹）；不再写第二套时间戳比对。
3. 补 / 换 / 删：补。把已有的 `verifyBuild` 接进所有入口共用的启动处；不换，因为机制本身是对的，缺的只是接线。

## ★1 用户怎么用

当 agent 或人跑免费真机走查 / e2e / perf 驱动时，我想它跑的一定是当前源码的构建，以便「通过」、截图和 perf 数字都能当证据。

- 之前：只有付费跑（`tests/ux/_paidRun.mjs`）核戳。免费的 14 个以上入口都不核，I-b1a（生成框）走查发现之前几轮一直跑旧构建。
- 之后：戳缺失 / 与当前源码树不一致，起跑前拒跑，提示「构建产物比源码旧（或没有构建），先跑 pnpm run build」。
- 不做：不加跳过开关；打包形态（传 `executablePath` 指向安装包）跑的是安装包自带产物，不看仓库 dist，不核；`dev-electron` 等开发者自己起 App 的脚本不产出证据，不管。
- 已知代价：戳 v2 是「构建输入树」的指纹（默认全算，只排除已证明不进产物的 .github、.claude、.agents、根目录 md、docs（除 release-notes）、tests（除 ux/fixtures），证据见 package-build-stamp.mjs 的 NON_INPUTS 注释）：构建后提交文档、写证据不过期，改 src / 依赖清单过期；旧 v1 戳作废。
- 真实任务：①戳新时 `tests/ux/smoke.e2e.mjs` 在隔离资料目录、屏外窗口真起 Electron 通过（17 条断言）；②构建后新增一个文件，同一脚本拒跑并给出上面的提示；③`pnpm run gates` 的末步就是 `pnpm run build`，CI 各 job 都是 build 在走查之前（已逐个核对 workflow 顺序）。
- 指标：量具 = 本卡的节点测试（见 ★9）；主指标 = 入口覆盖 100%（门岗守）。

## ★2 谁说了算

- 概念「构建产物新鲜度」唯一 owner：`scripts/package-build-stamp.mjs`（`verifyBuild` 判定，新增 `assertFreshBuild` 是它面向走查的唯一出口）。
- 消费者 = 起 / 加载构建产物的入口。`node scripts/door-map.mjs` 与 grep 数出的入口见 PR 正文；共享边界是 `launchNomiApp`（`tests/ux/_launchApp.mjs`），其余是直接起 Electron 的 6 处。
- 同一事实只存一份（戳）；没有靠猜。

## ★3 一致与复用

- 复用 `verifyBuild`，不另写时间戳比对（`_paidRun.mjs` 原注释也如此要求）。`assertBuilt`（`_mcpJourney.mjs`）原来只查「入口文件在不在」，改为委托 `assertFreshBuild`，同提交删旧。
- 门岗并进已有的 `check:e2e-launch`（它本来就守「不许绕开 launchNomiApp」），不另开一道检查。

## ★4 全状态

| 状态 | 看到什么 |
| --- | --- |
| 戳新 | 照常起跑，无额外输出 |
| 戳缺失（没构建 / 构建失败 / 被 invalidate） | 拒跑，提示先 `pnpm run build` |
| 戳过期（构建后源码又变） | 同上 |
| 打包形态 | 不核（产物来自安装包） |
| 能力不可用 / 取消中 | 不适用（无界面） |

## ★9 验收与回滚

- 节点测试（动手前定的清单，先红后绿）：
  1. `scripts/package-build-stamp.node-test.mjs`：没有戳 → 拒；旧戳 → 拒；戳一致 → 放行。
  2. `scripts/launch-build-gate.node-test.mjs`：`launchNomiApp` 在戳缺失 / 过期时拒跑，且不调用 `electron.launch`。
  3. `scripts/lib/buildGateScan.test.mjs`（vitest）：有人绕过共享边界直接起 Electron → 门岗红；走 `launchNomiApp` / 自己核戳 / 已登记的非构建起法 → 绿；启动器自己不核戳 → 红；真实 `tests/` 树无漏网。
- 反例会从哪些入口回来：新写的走查直接 `spawn(require('electron'))`、新写直接起 `dist-electron/main.js` 的脚本、Playwright `_electron` —— 都被 `check:e2e-launch` 的新规则拦；登记表 `NON_BUILD_SPAWNERS` 每条要写理由，且只给「起的不是仓库构建产物」的起法。
- 回滚：revert 本提交即可；无数据迁移。

## 排除项的自动核对

`scripts/lib/buildInputRefScan.mjs`（测试 `scripts/lib/buildInputRefScan.test.mjs`，登记在 `pre-push-scan-guards.mjs`）：扫 `src/`、`electron/`（不含测试文件）、vite / tailwind / postcss 配置和构建链脚本里的静态 import、`?raw`、`import.meta.glob`、`new URL`、`require`、构建期 fs 读取；字面路径落进 `NON_INPUTS` 且不在 `KEEP_INSIDE_EXCLUDED` 就红。判据直接读 `package-build-stamp.mjs` 导出的同一份常量。`scripts/build-*.mjs` 里只有 build-tailwind / build-electron 在 App 构建链上，build-delivery-ledger 等生成文档的脚本不在范围。
