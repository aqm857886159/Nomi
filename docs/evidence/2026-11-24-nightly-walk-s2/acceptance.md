结论：通过 · 验收线：n1121s2-verify · 验收 HEAD：498adbd53d3bf921030c78d4ce650f9e771a0bcc

- 验收线：`n1121s2-verify`
- 对应设计卡：`docs/plan/2026-11-24-nightly-walk-selector-sync-s2.md`

## 1. 范围、原业务判据与隐私核查

- **改动范围（`origin/main...498adbd53d3bf921030c78d4ce650f9e771a0bcc`，7 个文件）**：
  - `src/` 与 `electron/` 生产代码 **0 改动**，全部改动严格限定在设计卡与 6 份夜跑走查脚本。
  - **6 份走查契约对齐且未削弱任何原业务判据**：
    - `tests/ux/agent-panel-system-prompt.walk.mjs`：保留身份层 → 生成画布专长层层序校验，对齐现役方法约束句与主进程发布的 `stage_shot` 工具条目。
    - `tests/ux/editing-real-user-pass.walk.mjs`：通过 `editing-surface-inspector` 展开按钮兼容窄窗自动收起的属性栏，原 41 项时间轴属性与 720p/1080p 导出判据完整保留。
    - `tests/ux/feedback-batch-hardening.walk.mjs`：对齐 `canvasAddBar` `[data-add-intent="image"]`、外部清单变更同步确认、画布命中点与现役版本宫格 `[data-version-badge]` / `[data-version-grid]` / `[data-version-card]`，原 3 阶段加节点/连线/版本删除/损坏清单恢复判据均保留。
    - `tests/ux/library-load-error.walk.mjs`：空态探针改锚定现役 `[data-library-first-run]`，完整保留空态证明 → 故障注入错误态 → 点击重试恢复链路。
    - `tests/ux/skill-library-specimen.walk.mjs`：宿主就绪探针改锚定 `[data-library-first-run]` 新建项目卡，保留真实 Electron 宿主与详情打开校验。
    - `tests/ux/vendor-connection-identity.walk.mjs`：复用 `_shell.mjs` 的 `openModelSettings` / `openCustomApiWizard` / `setAppLanguage` 入口，保留同地址连接独立名与删除隔离的中英两轨校验。
  - **产物与临时目录隔离**：全部 6 份走查均已改走 `makeTempDir` + `assertOutsideRepo` 输出到仓库外临时目录。
- **隐私与路径泄露核查**：`git diff origin/main...HEAD` 全部改动及本验收报告均含 `0` 处本机绝对路径、临时目录字面路径或工作树前缀泄露。

## 2. 拦截闭环与 6 项静态门岗独立实跑（全部 `EXIT=0`）

首轮验收（`9af502de0`）拦下 1 项 `gates:contracts` 硬阻断门岗（B1：`check:test-temp-static` 检出 5 份走查共 7 处绕过 `scripts/_test-temp.mjs` 的裸 `fs.mkdtempSync`），实现线在 `498adbd53` 统一迁至 `makeTempDir` 后，全部 6 项独立门岗实跑全绿（`EXIT=0`）：

| 门岗命令 | 结果 | 关键摘要 |
|---|---|---|
| `pnpm run check:test-temp-static` | PASS | `27/27` 通过，无绕过 `makeTempDir` 的临时目录分配 |
| `pnpm run check:walkthroughs` | PASS | `108/108` 规则单测全过，`absence-without-baseline=56`、`dead-data-attr=38`、`dead-selector=0` 零回归 |
| `pnpm run check:mjs-parse` | PASS | `6/6` 自测 + `1740` 个 `.mjs/.cjs` 全部可解析 |
| `pnpm run check:test-waits` | PASS | 全部测试等待契约通过 |
| `node ./scripts/check-test-copy-literals.mjs` | PASS | 棘轮只减不增（存量 `1165` 处） |
| `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs` | PASS | `6` 个改动文件 `0` 错误 |

## 3. ★9 死选择器变异验证（必红 → 还原必绿）

- **M1（`tests/ux/library-load-error.walk.mjs:40`）**：将空态探针 `[data-library-first-run]` 临时改为源码无渲染者的死选择器 `[data-library-first-run-dead-probe]` → 实跑 `node ./scripts/check-walkthroughs.mjs` 立即返回 `EXIT=1`（`dead-data-attr` 基线 `38 → 39`，新增 1 处拦阻）。
- **`git checkout --` 复原后复跑**：`node ./scripts/check-walkthroughs.mjs` 返回 `EXIT=0`（`dead-data-attr=38`），工作树干净。

## 4. 诚实未验证边界

- 本次独立验收覆盖 6 份走查全量代码审阅、全部静态门岗实跑与死选择器变异验证；6 条 Electron 真窗隔离走查与 720p/1080p 真实导出未在本验收线重复跑完（实现线设计卡已录 `8ac07cffb` 构建逐条实跑结果），且原夜跑 Linux Ubuntu runner 环境与设计卡中撤回的 `screenshot-hotkey` / `design-lab-settings` 记为 `unverified`。
