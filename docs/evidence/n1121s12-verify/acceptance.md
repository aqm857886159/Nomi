结论：通过 · 验收线：n1121s12-verify · 验收 HEAD：fa3956f86cfdb4aa924867a36f9bab8dd71f7886

## 验收元数据

- verified_sha: `fa3956f86cfdb4aa924867a36f9bab8dd71f7886`
- 待验分支：`fix/nightly-walk-selector-sync-s12`（`I-1 #1121` 夜跑走查现役契约同步第十二批）
- 验收线：`n1121s12-verify`（独立工作树检出 `verify/1121-twelfth`，仅增量提交本验收报告）
- 变更范围核查（`git diff --stat origin/main...fa3956f86cfdb4aa924867a36f9bab8dd71f7886`）：
  - 共 9 个文件（`114 insertions(+), 50 deletions(-)`）：
    - 7 个走查与辅助文件：`tests/ux/video-clip-direct.walk.mjs`、`tests/ux/card12-draft-shots-performance.walk.mjs`、`tests/ux/generation-lock-exit.walk.mjs`、`tests/ux/_generationLockExitThreePages.mjs`、`tests/ux/director-assets.walk.mjs`、`tests/ux/_directorLab.mjs`、`tests/ux/director-ual-crowd.walk.mjs`
    - 1 份设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s12.md`
    - 1 份规则收紧：`eslint-suppressions.json`（移除 `tests/ux/director-assets.walk.mjs` 已消除的 1 条未使用变量豁免）
  - 逐文件断言复核：7 个测试文件均改为仓外隔离目录（`makeTempDir` / `shotsDir`）并同步现役操作预算、结果身份与弹窗遮挡处理，未弱化任何核心断言。
  - 生产代码改动：`src/` 与 `electron/` 均 **0 文件改动**
  - 本机路径与隐私扫描（`origin/main...HEAD` diff 扫绝对路径与工作树名）：**0 命中**
  - 真实付费模型调用：**0 次**（`director-assets` 为本地 Chromium + 生成 PLY 渲染，`video-clip-direct` 为本地 1080p 媒体直剪，全程无在线付费请求）

## 1. 静态门岗全量复跑结果（8/8 通过）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 临时目录静态检查 | `pnpm run check:test-temp-static` | `EXIT=0`（27/27 PASS） |
| 走查等待原语检查 | `pnpm run check:test-waits` | `EXIT=0`（14/14 PASS，`Station wait baseline: 584; new/stale: 0`） |
| Launcher 临时目录单测 | `VITEST_MAX_WORKERS=1 npx vitest run tests/ux/launcherDirs.test.mjs` | `EXIT=0`（4/4 PASS） |
| MJS 语法校验 | `pnpm run check:mjs-parse` | `EXIT=0`（6/6 自检 + 1740 个文件全过） |
| 测试文案字面量检查 | `node ./scripts/check-test-copy-literals.mjs` | `EXIT=0`（存量 1167，6 个文件较基线改善） |
| 改动文件增量 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | `EXIT=0`（7 个改动文件，0 errors） |
| 概念 Owner 写口门岗 | `pnpm run check:concept-owners` | `EXIT=0`（58/58 PASS，408 个概念，0 新增第二写口） |
| 走查契约与选择器回归门 | `pnpm run check:walkthroughs` | `EXIT=0`（108/108 单测 + 398 条走查零回归：`dead-selector=0`、`dead-data-attr=38`、`absence-without-baseline=56`、`sleep-as-done-signal` 65→62） |

## 2. 真实串行双变异验证（2/2 通过：1 条 3D 导演台 Chromium + 1 条真 Electron）

> 严格按「单次仅 1 个窗口进程串行运行：突变 → 必红 → `git checkout --` 还原 → 必绿 → 工作树干净」完成两条代表性走查实跑；在运行真 Electron 前于 `fa3956f86cfdb4aa924867a36f9bab8dd71f7886` 执行一次 `pnpm run build`（`EXIT=0`）对齐 `eslint-suppressions.json` 更新后的构建时间戳。

### M1（隔离 Chromium 3D 导演台）：`tests/ux/director-assets.walk.mjs`（15,000 点 PLY 解码显现、重命名保身份与进入观察视角 HUD）

- **突变设计**：注释掉 `tests/ux/director-assets.walk.mjs` 第 83 行 `await clickOrFail(enterPov, '观察机位·进入视角', { timeout })`，跳过进入视角点击以验证新增 `director-pov-hud` 可见断言是否真能拦截未进入视角态。
- **突变结果（RED）**：`M1_RED_EXIT=1`
  - 关键断言命中：`tests/ux/director-assets.walk.mjs:84:54` 报 `Error: expect(locator).toBeVisible() failed — Locator: getByTestId('director-pov-hud'), Expected: visible, Timeout: 60000ms`（前序 15,000 点解码显现与重命名全部通过后精准红在 POV HUD 断言）。
  - 注：首次试跑 M1 RED 时曾在第 39 行 `input[type="file"]` 遇偶发 DOM detach，本线未将其计作有效红灯，立即重跑直至精准命中第 84 行目标断言。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/director-assets.walk.mjs` 后重跑，`M1_GREEN_EXIT=0`
  - 关键输出：`✓ 上传的 PLY 山谷已解码且完成显现 — 15000 splats`、`✓ 泼溅添加按源轴约定绕X翻转180度`、`✓ 重命名不重建泼溅或重启黑幕`、`✓ 资产目录菜单/拖拽/循环拒绝/折叠搜索走通`、`✓ asset-tree：全部通过`。

### M2（真隔离 Electron）：`tests/ux/video-clip-direct.walk.mjs`（9 项视频直剪旅程 + 第 9 项 1080p 新增结果 ID 与时长契约）

- **突变设计**（对应设计卡 ★9 反例二）：注释掉 `tests/ux/video-clip-direct.walk.mjs` 第 427 行确认直剪按钮点击 `await win.getByRole('button', { name: L.confirm, exact: true }).click()`，模拟选定 1080p 素材后未执行直剪。
- **突变结果（RED）**：`M2_RED_EXIT=1`
  - 关键断言命中：`8/9 passed (zh)`，第 9 项精准报红：`{"name":"09-real-1080p-performance-and-keyboard","pass":false,"error":"expect(received).toEqual(expected) // deep equality | - Expected: [\"success\"] | + Received: []"}`，证明新增 `previousIds` 差集与 `sourceVideoNodeId` 成功态断言确实能捕获未落盘的新直剪节点。
- **还原复跑（GREEN）**：`git checkout -- tests/ux/video-clip-direct.walk.mjs` 后重跑，`M2_GREEN_EXIT=0`
  - 关键输出：`{"name":"09-real-1080p-performance-and-keyboard","pass":true}`、`9/9 passed (zh)`，截图与性能产物全部写入仓外隔离目录。
- **还原后工作树核查**：`git status -s` 为空（无残留突变或未跟踪产物）。

## 3. 未验证边界（如实标注）

- 本批其余 3 条走查（`card12-draft-shots-performance.walk.mjs`、`generation-lock-exit.walk.mjs`、`director-ual-crowd.walk.mjs`）本次均已通过全部 8 项静态门岗与逐行契约复核；独立验收线按指令未逐条重复拉起渲染/真 Electron，其本机实跑证据依赖实现线记录，标为 `unverified（独立线仅抽跑 M1+M2 两条双变异）`。
- Linux / Ubuntu Nightly Runner 环境与真实在线付费模型调用链路不在本次验收范围，标为 `unverified`。
