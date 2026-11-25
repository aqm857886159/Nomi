结论：通过 · 验收线：n1121s5-verify · 验收 HEAD：41a9cf1fa53ed2c80a193ad49f182cf5319143a2

# #1121 夜跑走查第五批（5 条现役契约、播放器守卫与 makeTempDir 同步）独立验收报告

- 验收线：`n1121s5-verify`
- 实现线：`fix/nightly-walk-selector-sync-s5`
- 验收 HEAD：`41a9cf1fa53ed2c80a193ad49f182cf5319143a2`（含自 `b2808035cc6780a56aedb361cbfe712e7d9cdd63` 起仅 2 行增量复签）
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s5.md`
- 验收分支：`verify/1121-s5-v2`

## 一、范围、边界与零生产代码变更核查

1. **生产代码零改动**：`git diff --name-only origin/main...HEAD -- src/ electron/` 输出为空，本次提交未改动任何生产源码，仅同步 5 条夜跑走查脚本及配套设计卡。
2. **变更清单逐文件核对（5 条同步 + 3 条设计卡标注跳过）**：
   - `tests/ux/mention-scope.walk.mjs`：改用 `makeTempDir` + `assertOutsideRepo` 与 `buildWorld` 本地夹具；通过 `addCanvasNode` 与 `canvasFitView`/`canvasZoomStep` 保证目标节点 composer 可点；加强了候选组全为 `canvas` 且长度为 2 的断言，新增 `createEdgeId(sourceId, targetId)` 精确连线挂载断言、正文 chip 文本等于 `clipReferenceName(sourceName)` 及二次打开 `@` 后「当前参考」编号断言，无断言弱化。
   - `tests/ux/modal-input-priority.walk.mjs`：改用 `makeTempDir` + `assertOutsideRepo` 输出证据目录；将 macOS 专有 `Meta+` 键位统一为跨平台 `ControlOrMeta+`；在 A7 设置 AI 页签增加 `fieldset[aria-busy="false"]` 可用与输入框可编辑前置等待；全部 A1–A13 键盘优先权与恢复断言完整保留。
   - `tests/ux/node-prompt-presets.walk.mjs`：改用 `makeTempDir` + `assertOutsideRepo`；经 `addCanvasNode` 精确定位新增节点并以现役 `[data-prompt-tool="effects"]` 替代旧 `[data-effect-more]`；以 `findCanvasBlankPoint` 替代硬编码画布坐标点击；补齐 Agent 面板显式开关与 `openSettings(page, { tab: 'general' })`；全部 9 项任务断言完整保留。
   - `tests/ux/plan-gate.walk.mjs`：改用 `makeTempDir` + `assertOutsideRepo` 与共享 `_mcpJourney.mjs`（`makeIsolatedDirs`、`spawnMcpStdioClient`、`parseToolResult`），并在 `launchNomiApp` 显式透传 `settingsDir: dirs.settingsDir`、`projectsDir: dirs.projectsDir` 以匹配 `launcherDirs.test.mjs` 冻结名单；显式申请 `nomi_session_open` 租约，使用 `Promise.race` 防止 MCP 在人工确认前提前落盘，并在方案门弹窗出现时用 `expectAbsent(nodes)` 硬证画布仍为空，确认后按回执 3 个不重复 `affectedNodeIds` 逐一读回画布节点，较旧实现更严密。
   - `tests/ux/video-playback-heal.walk.mjs`：改用 `makeTempDir` + `assertOutsideRepo`；补齐封面图与已知尺寸元数据，收紧原始 AVI 解码失败前提（`baseline.startsWith('error:')`），新增浏览态展示 `[data-node-video-poster="true"]` 且未挂载 `<video>` 的守卫断言，选中后验证节点自愈解码与全屏预览解码，无弱化。
   - 设计卡中标注跳过的 3 条脚本（`node-composer-placement.walk.mjs`、`storyboard-reference-slots.walk.mjs`、`storyboard-table-phasec.walk.mjs`）均与 `origin/main` 保持未改。
3. **增量核对（`b2808035cc6780a56aedb361cbfe712e7d9cdd63..41a9cf1fa53ed2c80a193ad49f182cf5319143a2`）**：
   - 仅在 `tests/ux/plan-gate.walk.mjs` 新增 `settingsDir: dirs.settingsDir` 与 `projectsDir: dirs.projectsDir` 两行，无其他改动，免碰 `launcherDirs.json`。
4. **临时目录与隐私扫描**：
   - 5 条修改的走查均统一经由 `scripts/_test-temp.mjs` 的 `makeTempDir` 管理临时目录，并通过 `assertOutsideRepo` 保证证据目录不落入仓库树。
   - 提交说明与新增 diff 经正则扫描，无任何本机绝对路径、临时目录路径或私有工作树前缀泄漏（0 命中）。

## 二、静态门岗与变更检查实跑结果

基线提交 `b2808035cc6780a56aedb361cbfe712e7d9cdd63` 上 6 项静态门岗全绿；在最新提交 `41a9cf1fa53ed2c80a193ad49f182cf5319143a2` 上增量复跑 `launcherDirs.test.mjs`、`lint-changed` 与 `check-mjs-parse` 全部通过（`EXIT=0`）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 启动器冻结名单单测（增量实跑） | `pnpm exec vitest run tests/ux/launcherDirs.test.mjs` | PASS（4/4 通过） |
| 临时目录静态约束 | `pnpm run check:test-temp-static` | PASS（27/27 通过） |
| 走查静态契约检查 | `pnpm run check:walkthroughs` | PASS（108/108 + 398 份走查通过，`dead-selector=0`，`dead-data-attr=38`，`whole-page-text` 28→27、`sleep-as-done-signal` 65→60，零退步） |
| MJS/CJS 语法解析（增量实跑） | `node ./scripts/check-mjs-parse.mjs` | PASS（1740 个脚本全解析） |
| 禁止空等/墙钟等待 | `pnpm run check:test-waits` | PASS（14/14 通过，0 处违规等待） |
| 测试文案字面量基线 | `node ./scripts/check-test-copy-literals.mjs` | PASS（存量 1165，只减不增，7 个文件净改善） |
| 变更文件 Lint（增量实跑） | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS（5 个变更文件 0 error，0 新增 warning） |

## 三、真实故障注入（Mutation）反例实证

针对本批次核心回归风险执行了 2 处真实故障注入，验证门岗均可精准拦红，恢复后全绿：

1. **M1（失效 `data-*` 锚点注入）**：
   - 改动：将 `tests/ux/mention-scope.walk.mjs` 中的 `[data-mention-list]` 临时改为 `[data-mention-list-dead-probe]`。
   - 实跑：`node ./scripts/check-walkthroughs.mjs` 立即失败（`EXIT=1`），精准检出 `dead-data-attr` 基线由 `38` 升至 `39` 并阻断。
2. **M2（裸调原生临时目录注入）**：
   - 改动：将 `tests/ux/video-playback-heal.walk.mjs` 第 27 行的 `makeTempDir('nomi-video-heal-')` 临时改回原生 `fs.mkdtempSync` + `os.tmpdir()`。
   - 实跑：`pnpm run check:test-temp-static` 立即失败（`EXIT=1`），精准检出 `tests/ux/video-playback-heal.walk.mjs` 第 27 行新增 1 处违规（基线 0）。
3. **恢复复跑**：
   - `git checkout --` 复原两处改动后工作树干净，复跑 `node ./scripts/check-walkthroughs.mjs`（`dead-data-attr=38`）与 `pnpm run check:test-temp-static`（27/27）均恢复通过（`EXIT=0`）。

## 四、未验证边界声明（Unverified）

- 本次独立验收在隔离工作树中完成逐行 diff 核对、全部静态门岗、`launcherDirs.test.mjs` 实跑与 2 处真实故障注入实证；未在真实 Ubuntu Nightly Runner 上整批回放全部 5 条 Electron 桌面真窗走查，也未触发任何真实付费模型调用（`unverified: nightly-ubuntu-e2e-replay / paid-vendor-generation`），需以合入后的 Nightly CI 实跑收据最终确认。

## 五、结论

- `#1121` 夜跑走查第五批在 `41a9cf1fa53ed2c80a193ad49f182cf5319143a2` 上满足设计卡全部约束：零生产代码改动、5 条走查契约与前置入口同步无弱化、`launcherDirs.test.mjs` 4/4 全绿、`makeTempDir` 迁移与隐私边界干净、静态门岗与故障注入全过。
- 独立验收结论：**通过**。
