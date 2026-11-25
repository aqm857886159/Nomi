结论：通过 · 验收线：n1121s7-verify · 验收 HEAD：3102b5d3c6a3ce9e1a6fc17e98fb3a2334d2fe10

# #1121 夜跑走查现役契约同步第七批独立验收报告

- 验收线：`n1121s7-verify`
- 实现线：`fix/nightly-walk-selector-sync-s7`
- verified_sha: `3102b5d3c6a3ce9e1a6fc17e98fb3a2334d2fe10`
- 验收 HEAD：`3102b5d3c6a3ce9e1a6fc17e98fb3a2334d2fe10`（含自 `e12405ab0657a8ba75fb5e2b5a9979b0deafae32` 起仅 6 行纯局部变量改名增量复签）
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s7.md`
- 验收分支：`verify/1121-seventh-v2`

## 一、范围、边界与零生产代码变更核查

1. **生产代码零改动**：`git diff --name-only origin/main...HEAD -- src/ electron/` 输出为空，本次交付未触碰任何生产源码，仅同步 6 条夜跑走查脚本、配套设计卡及两份棘轮基线收紧文件。
2. **6 条走查改动逐文件核对**：
   - `tests/ux/screenshot-hotkey.walk.mjs`：迁移 `makeTempDir`，改用现役 `newProjectEntry`、`switchWorkspace`、`openSettings(win, { tab: 'general' })` 与具名 `switch` 控件（`Space` 切换），完整保留真实主进程 `globalShortcut` 默认未注册 → 注册 `Q` → 换键 `S` 且撤 `Q` → 关闭撤 `S` 断言。
   - `tests/ux/comfy-t2v-gate-and-error-dismiss.walk.mjs`：迁移 `makeTempDir`，为 Comfy mapping 补 `enabled: true`，用 `seedSavedFixtureCredentials(['runway'])` + 仅图生模型 `gen4_turbo` 作严格阳性对照，发送钮定位限定到各节点 `[data-node-composer-footer] button[data-bar-segment="generate"]:not([data-composer-connect])`，完整保留图生零参考禁用、Comfy 文生可用与关闭错误保留产物断言。
   - `tests/ux/runway-vendor-honest-modes.walk.mjs`：迁移 `makeTempDir`，适配 `NomiSelect` 「更多」展开、`[data-nomi-select-option-label]` 精确匹配与 `Grok Imagine 1.5` 行内 `Runway Dev` 渠道按钮（并将局部参数 `channelLabel` 改名为 `badgeText` 以避免与概念登记写口同名冲突），模式表对齐 `[M('text'), M('reference')]`，完整保留 10 条模型身份与 Veo 跨渠道 3 对 2 对照断言。
   - `tests/ux/layout-timeline-panel-span.walk.mjs`：迁移 `makeTempDir`，引入 `EXPECTED_SHELL_GUTTER = 8` 独立对账 `ShellFrame` 右缘留距，等待 `--generation-assistant-width` 动画收口后取基线，并以 `.workbench-generation__surface` 统一覆盖画布与底边窄条，完整保留四态与复开及 240px 默认高度断言。
   - `tests/ux/timeline-toolbar-row.walk.mjs`：迁移 `makeTempDir`，将对 `flex-1` 无效的 `row.style.width = '320px'` 改为 `row.style.maxWidth = '320px'` 并新增 `expect(safetyNet.squeezedWidth).toBe(320)` 硬证压窄生效，完整保留三簇单行、可横滚、尾组可达与收展断言。
   - `tests/ux/director-timeline-pointer.walk.mjs`：迁移 `makeTempDir`，改由隔离 Electron 加载本地 Vite 中间件夹具（不往仓库落 `.tmp` 文件），补齐 `workspaceInputAttributes(true)`、`data-shortcut-surface="canvas"` 与 `renderRowMenu`，新增拖动预览位移确认，完整保留取消不提交、点空轨定位 6 秒、框选 `[1, 2]` 关键帧断言。
3. **增量核对（`e12405ab0..3102b5d3c`）**：
   - 仅将 `tests/ux/runway-vendor-honest-modes.walk.mjs` 中 `pickModel`、`assertModeBar` 及调用处 6 行局部参数 `channelLabel` 重命名为 `badgeText`，无任何逻辑或断言改动，消除 `check:concept-owners` 同名冲突。
4. **临时目录与隐私扫描**：
   - 6 条修改走查均统一使用 `scripts/_test-temp.mjs` 的 `makeTempDir`。
   - 全部提交日志与新增 diff 经正则扫描，无任何本机绝对路径、临时目录路径或私有工作树前缀泄漏（0 命中）。

## 二、静态门岗与结构测试实跑结果

全部 8 项门岗均已独立实跑并通过（`EXIT=0`）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 概念 owner 门岗（增量复验） | `pnpm run check:concept-owners` | PASS（58/58 + 408 个概念，第二写口 0 新增） |
| 变更文件 Lint（增量复验） | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS（6 个改动文件 0 error，0 新增 warning，`eslint-suppressions.json` 干净） |
| MJS/CJS 语法解析（增量复验） | `node ./scripts/check-mjs-parse.mjs` | PASS（1740 个脚本全部可解析） |
| 测试等待门岗 | `pnpm run check:test-waits` | PASS（14/14 通过，`Station wait baseline: 579 occurrences; new/stale: 0`） |
| 走查静态契约检查 | `pnpm run check:walkthroughs` | PASS（108/108 + 399 份走查，`dead-selector=0`，`dead-data-attr=38`，`sleep-as-done-signal` 65→60） |
| 临时目录静态约束 | `pnpm run check:test-temp-static` | PASS（27/27 通过） |
| 启动器冻结名单单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | PASS（4/4 通过） |
| 测试文案字面量基线 | `node ./scripts/check-test-copy-literals.mjs` | PASS（存量 1167，只减不增，6 个文件净改善） |

## 三、真实 Electron 串行双变异必红 → 还原必绿实证

在隔离工作树使用当期构建产物串行（每次仅 1 个 Electron 实例）完成 2 条走查的真实故障变异验证，还原后工作树完全干净：

1. **M1（`tests/ux/layout-timeline-panel-span.walk.mjs` 几何常量变异）**：
   - 变异：将 `EXPECTED_SHELL_GUTTER` 由 `8` 临时改为 `0`。
   - 必红结果：真实 Electron 执行退出 `1`，`assertBottomBandSpans` 精准报红：`③ 两个都开：底部带右缘离窗口应留 0px（timeline.right=1272 viewport=1280）`。
   - 复原复跑：`git checkout --` 复原后真实 Electron 执行退出 `0`，窗口 `1280×933` 下工作区与时间轴宽均为 `1212px`、右缘 `1272px`、默认高度 `240px`，四态与复开全部通过。
2. **M2（`tests/ux/director-timeline-pointer.walk.mjs` 行为取消路径变异）**：
   - 变异：跳过 `pointercancel` 事件派发（模拟取消失效导致拖动提交）。
   - 必红结果：真实 Electron 执行退出 `1`，`cancel does not commit` 精准报红：`Expected: 0, Received: 1`。
   - 复原复跑：`git checkout --` 复原后真实 Electron 执行退出 `0`，`cancel does not commit`、`empty row seeks`、`range selects keys` 3/3 全部通过。

## 四、未验证边界声明（Unverified）

- 本次独立验收在隔离 macOS 工作树完成全量静态门岗、diff 逐行核查与 2 条走查的真实 Electron 双变异实证；未在真实 Ubuntu Nightly Runner 上全量串跑其余 4 条走查，也未触发任何真实外部供应商付费调用（`unverified: nightly-ubuntu-e2e-replay / paid-vendor-generation`），需以合入后 Nightly CI 实跑收据最终确认。

## 五、结论

- `#1121` 夜跑走查现役契约同步第七批在 `3102b5d3c6a3ce9e1a6fc17e98fb3a2334d2fe10` 上满足设计卡及 CI 全部约束：零生产代码改动、局部参数改名消除概念门岗冲突、8 项静态门岗全绿、2 条走查真实 Electron 串行双变异均必红且复原全绿、0 本机路径泄漏。
- 独立验收结论：**通过**。
