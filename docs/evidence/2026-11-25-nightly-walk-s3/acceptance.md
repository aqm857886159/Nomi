结论：通过 · 验收线：n1121s3-verify · 验收 HEAD：e4f78afe8071238c5fe6bc9a2a30d7c014183ab4

# PR-1121-S3（#1121 夜跑走查第三批 7 条旧选择器 / 前置入口 / makeTempDir 同步）独立验收报告

- 验收线：`n1121s3-verify`
- 实现线：`fix/nightly-walk-selector-sync-s3`
- 验收 HEAD：`e4f78afe8071238c5fe6bc9a2a30d7c014183ab4`
- 对应设计卡：`docs/plan/2026-11-25-nightly-walk-selector-sync-s3.md`
- 验收分支：`verify/1121-s3`

## 一、范围、边界与零生产代码变更核查

1. **生产代码零改动**：`git diff --name-only origin/main...HEAD -- src/ electron/` 输出为空，本次提交未改动任何生产源码，仅同步 7 条夜跑走查脚本及配套设计卡。
2. **变更清单核对**：
   - `tests/ux/dark-audit.walk.mjs`：改用 `makeTempDir('nomi-dark-audit-')`，补齐空画布生图任务入口及生成节点 `expectVisible` 断言（提升了 `assertion-density`，未弱化原暗色主题审计）。
   - `tests/ux/focus-indication.walk.mjs`：改用 `makeTempDir`，同步聚焦态验证入口与前置条件，未弱化焦点轮廓断言。
   - `tests/ux/grouping-optimization.walk.mjs`：改用 `makeTempDir`，以可见分组框与成员节点的真实几何同步轮询替代旧选择器/脆弱等待，未弱化编组位置与对齐断言。
   - `tests/ux/node-toolbar-one-row.walk.mjs`：改用 `makeTempDir`，同步节点工具栏前置选中与锚点，保留单行布局硬断言。
   - `tests/ux/omni-video-reference-gate.walk.mjs`：改用 `makeTempDir`，悬停 `button[data-bar-segment="generate"]` 并断言 `[data-send-cost-hover]` 文案非空且不含 `videoReferenceRequired`，未弱化参考门控语义。
   - `tests/ux/mcp-workbuddy-client-profile.walk.mjs`：改用 `makeTempDir`，改用真实 `openSettings`/`closeSettings`、radio 选中态断言、本地化 `uiTextWith` 与撤销确认流程，未弱化配置与撤销验证。
   - `tests/ux/deconstruction-interrupted-recovery.walk.mjs`：改用 `makeTempDir`，在断言 `[data-shot-table-composer="deconstruct"]` 与双语 `uiText` 前先选中中断的分镜表，恢复路径断言完整。
   - 设计卡记录了 `tests/ux/deconstruction-panel.walk.mjs` 因旧右侧槽位已由 `87adc5b6a` 退役而保持未动/跳过，说明与代码现状一致。
3. **临时目录与隐私扫描**：
   - 7 条走查均统一经由 `scripts/_test-temp.mjs` 的 `makeTempDir` 管理临时目录，不向仓库树落盘。
   - 提交日志与新增 diff 经正则扫描，无任何本机绝对路径、临时目录路径或私有工作树前缀泄漏（0 命中）。

## 二、静态门岗与变更检查实跑结果

全部 6 项指定门岗均在验收 HEAD `e4f78afe8071238c5fe6bc9a2a30d7c014183ab4` 上实跑并通过（`EXIT=0`）：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 临时目录静态约束 | `pnpm run check:test-temp-static` | PASS（27/27 通过） |
| 走查静态契约检查 | `pnpm run check:walkthroughs` | PASS（108/108 通过，`dead-selector=0`，`dead-data-attr=38`，`dark-audit.walk.mjs` 改善 `assertion-density`，零退步） |
| MJS/CJS 语法解析 | `pnpm run check:mjs-parse` | PASS（6/6 通过，1740 个脚本解析无误） |
| 禁止空等/墙钟等待 | `pnpm run check:test-waits` | PASS（14/14 通过，0 处违规等待） |
| 测试文案字面量基线 | `node ./scripts/check-test-copy-literals.mjs` | PASS（基线 1164，只减不增，8 个文件净改善） |
| 变更文件 Lint | `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS（7 个变更文件 0 error，0 新增 warning） |

## 三、真实故障注入（Mutation）反例实证

针对本批次最核心的两类回归风险执行了真实故障注入，验证门岗均可稳定拦红，恢复后全绿：

1. **M1（失效 `data-*` 锚点注入）**：
   - 改动：将 `tests/ux/omni-video-reference-gate.walk.mjs` 中的 `[data-send-cost-hover]` 临时改为 `[data-send-cost-hover-dead-probe]`。
   - 实跑：`node ./scripts/check-walkthroughs.mjs` 立即失败（`EXIT=1`），精准检出 `dead-data-attr` 基线由 `38` 升至 `39` 并阻断。
2. **M2（裸调原生临时目录注入）**：
   - 改动：将 `tests/ux/dark-audit.walk.mjs` 中的 `makeTempDir('nomi-dark-audit-')` 临时改回原生 `fs.mkdtempSync` + `os.tmpdir()`。
   - 实跑：`pnpm run check:test-temp-static` 立即失败（`EXIT=1`），精准检出 `tests/ux/dark-audit.walk.mjs` 第 13 行新增 1 处违规（基线 0）。
3. **恢复复跑**：
   - `git checkout --` 恢复两个文件后工作树干净，复跑 `node ./scripts/check-walkthroughs.mjs`（`dead-data-attr=38`）与 `pnpm run check:test-temp-static`（27/27）均恢复通过（`EXIT=0`）。

## 四、未验证边界声明（Unverified）

- 本次独立验收在隔离工作树中完成静态门岗、diff 逐行核对与故障注入实证；未在真实 Ubuntu Nightly Runner 上整批回放全部 7 条 Electron 桌面 UI 走查，也未触发任何真实付费模型调用（`unverified: nightly-ubuntu-e2e-replay / paid-vendor-generation`），需以合入后的 Nightly CI 实跑收据最终确认。

## 五、结论

- `PR-1121-S3` 在 `e4f78afe8071238c5fe6bc9a2a30d7c014183ab4` 上满足设计卡全部约束：零生产代码改动、7 条走查契约与前置入口同步无弱化、`makeTempDir` 迁移与隐私边界干净、6 项静态门岗全绿、2 项反例故障注入均精准拦红并恢复全绿。
- 独立验收结论：**通过**。
