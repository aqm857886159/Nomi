结论：通过 · 验收线：n1121s10-verify · 验收 HEAD：de55ecd5909b927d904a0b6fb85d88ebd4894400

## 验收元数据

- verified_sha: `de55ecd5909b927d904a0b6fb85d88ebd4894400`
- 待验分支：`fix/nightly-walk-selector-sync-s10`（`I-1 #1121` 夜跑走查现役契约同步第十批）
- 验收线：`n1121s10-verify`（独立工作树检出 `verify/1121-tenth`，仅增量提交本验收报告）
- 变更范围核查（`git diff --stat origin/main...de55ecd5909b927d904a0b6fb85d88ebd4894400`）：
  - 共 8 个文件（`138 insertions(+), 54 deletions(-)`）：
    - 7 个走查与框架文件：`tests/ux/design-lab-settings.walk.mjs`、`tests/ux/design-lab-vendor-order.walk.mjs`、`tests/ux/design-lab-catalog-liveness.walk.mjs`、`tests/ux/design-lab/walkScreen.mjs`、`tests/ux/director-reference-attach.walk.mjs`、`tests/ux/reference-entry.walk.mjs`、`tests/ux/storyboard-confirm-selection.walk.mjs`
    - 1 份设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s10.md`
  - 逐文件断言复核：7 个测试文件均按现役组件/样本契约与临时目录隔离改造（`makeTempDir` / `NOMI_WALK_OUT`），未发现任何断言弱化或绕过。
  - 生产代码改动：`src/` 与 `electron/` 均 **0 文件改动**
  - 本机路径与隐私扫描（`origin/main...HEAD` diff 扫绝对路径与工作树名）：**0 命中**
  - 真实付费模型调用：**0 次**（Design Lab 纯本地 Chromium 渲染，真 Electron 走查走本地回环夹具且 `paidCalls: 0`）

## 1. 静态门岗全量复跑结果（7/7 通过）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 临时目录静态检查 | `pnpm run check:test-temp-static` | `EXIT=0`（27/27 PASS） |
| 走查等待原语检查 | `pnpm run check:test-waits` | `EXIT=0`（14/14 PASS，`Station wait baseline: 584; new/stale: 0`） |
| Launcher 临时目录单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | `EXIT=0`（4/4 PASS） |
| MJS 语法校验 | `pnpm run check:mjs-parse` | `EXIT=0`（6/6 自检 + 1740 个文件全过） |
| 测试文案字面量检查 | `node ./scripts/check-test-copy-literals.mjs` | `EXIT=0`（存量 1168，5 个文件较基线改善） |
| 改动文件增量 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | `EXIT=0`（7 个改动文件，0 errors） |
| 走查契约与选择器回归门 | `pnpm run check:walkthroughs` | `EXIT=0`（108/108 单测 + 398 条走查零回归：`dead-selector=0`、`dead-data-attr=38`、`absence-without-baseline=56`、`sleep-as-done-signal` 65→62） |

## 2. 真实串行双变异验证（2/2 通过：1 条 Design Lab + 1 条真 Electron）

> 严格按「单次仅 1 个窗口进程串行运行：突变 → 必红 → `git checkout --` 还原 → 必绿 → 工作树干净」完成两条代表性走查实跑；在运行真 Electron 前于 `de55ecd5909b927d904a0b6fb85d88ebd4894400` 执行一次 `pnpm run build`（`EXIT=0`）使构建时间戳与本批提交对齐。

### M1（Design Lab / Chromium）：`tests/ux/design-lab-vendor-order.walk.mjs`（供应商偏好浮层溢出与空态契约）

- **突变设计**（对应设计卡 ★9 变异二）：将 `tests/ux/design-lab-vendor-order.walk.mjs` 第 25 行 `PICKER_CAPTURE_HEIGHT = 384` 改回旧高度 `320`。
- **突变结果（RED）**：`M1_RED_EXIT=1`
  - 关键断言命中：`✗ vo-06-picker-model-box 的下拉未完整落入截图舞台：{"top":-47,"bottom":45,"left":-13,"right":-163}`、`❌ 设计实验室走查失败 1 条`，证明浮层几何溢出防线真实有效，不会无声裁切。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/design-lab-vendor-order.walk.mjs` 后重跑，`M1_GREEN_EXIT=0`
  - 关键输出：`✅ 11 个状态全部渲染并截图`（所有 8 个 picker 格在 `460×384` 舞台内完整落框，`vo-04-picker-empty-no-vendor` 诚实空态与设置 3 格均通过，0 `pageerror`），工作树干净。

### M2（真隔离 Electron）：`tests/ux/storyboard-confirm-selection.walk.mjs`（分镜批量确认排除 2 镜 + 第 1 镜切视频跨品类生成）

- **突变设计**：将 `tests/ux/storyboard-confirm-selection.walk.mjs` 第 24 行 `durationSec: 5` 改回旧夹具时长 `durationSec: 3`（触发 Seedance 2.0 文生视频 4 秒下限拦截，复现设计卡记载的基线失败形态）。
- **突变结果（RED）**：`M2_RED_EXIT=1`
  - 关键断言命中：`Error: An image row explicitly switched to a video model must issue one video POST`（`Expected: 1, Received: 0`，`result: "failed"`），确认切视频后真实出站 POST 契约断言能立即捕获非法时长拦截。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/storyboard-confirm-selection.walk.mjs` 后重跑，`M2_GREEN_EXIT=0`
  - 关键输出：`result: "passed"`、`paidCalls: 0`、`selection: { candidates: 4, excluded: 2, posts: 2, generatedShotIds: ["selection-shot-3", "selection-shot-4"] }`、`crossKind: { imagePosts: 2, videoPosts: 1, defaultPreservesKind: true }`、4 张中/英 × 明/暗最小窗截图全部落仓外临时目录。
- **还原后工作树核查**：`git status -s` 为空（无残留突变或未跟踪产物）。

## 3. 未验证边界（如实标注）

- 本批其余 4 条走查（`design-lab-settings.walk.mjs`、`design-lab-catalog-liveness.walk.mjs`、`director-reference-attach.walk.mjs`、`reference-entry.walk.mjs`）本次均已通过 7 项静态门岗与逐行契约复核；独立验收线按指令未逐条重复拉起渲染/真 Electron，其本机实跑证据依赖实现线记录，标为 `unverified（独立线仅抽跑 M1+M2 两条双变异）`。
- Linux / Ubuntu Nightly Runner 环境与真实在线付费模型调用链路不在本次验收范围，标为 `unverified`。
