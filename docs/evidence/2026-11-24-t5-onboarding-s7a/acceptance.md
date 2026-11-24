t5-s7a-verify：通过

- 验收线：t5-s7a-verify
- 实现线：t5-onboarding-s7a-impl
- 验收 HEAD：ec7d1df89aa24cc53a179984fa83ced2912d1a81
- 关联任务：协作看板 #1586 · T-5 接入引导第二批切片（`S7a` 全部 7 个剩余入口指路收口 + `F-D` 4 条 `noGenericContract` 契约核对，叠在 PR `#1650` Slice 1 `55eee245e` 之上）
- 设计卡：`docs/plan/2026-11-24-t5-onboarding-s7a.md`

## 1. 拍板边界与 9 张真截图目视核对（均亲眼 `read_file` 核验）

1. **拍板清单严守切片边界**：
   - `git diff --name-only origin/feat/t5-onboarding-main-card-and-big-page...HEAD -- docs/design/boards/` 仅含 `docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`，`ModelSurfaces.board.json` **0 改动**；
   - `Onboarding.board.json` 精确翻转 `S7a` 7 项（`entry.composer-connect`、`entry.persona-setup`、`entry.library-banner`、`entry.agent-pointer`、`entry.picker-empty`、`entry.copy-unify`、`entry.kept-recovery`）为 `implemented`（连同 Slice 1 共 26 项 `implemented`、4 项 `dropped`），`S6` 全部 13 项与 `onb.drop.preset-count` 严格保持 `missing` 不动（共 14 项）。
2. **真截图逐张目视核验（覆盖 `board-vs-impl`、`zh`、`en`、`dark`、`narrow`、`kept-recovery`）**：
   - **`board-vs-impl-o1a-canvas.png`、`impl-o1a-canvas-en.png`、`impl-o1a-canvas-dark.png`**：画布生成框未连模型时左端「未连模型 ▾ / No model ▾」、右端「连接模型 / Connect」胶囊主按钮及右对齐悬停草稿保留提示准确对齐；右下角零「先连一个模型」浮动胶囊，严格遵守 `NomiEntryTopbar` D1/D5，暗色与英文无截断溢出。
   - **`board-vs-impl-o1b-library.png`、`impl-o1b-library-narrow.png`**：已有本地项目未连模型时顶部仅呈单段流动提示条（已彻底清除旧「分别配置」误导话术）+ 右侧「连接模型 / Connect」按钮；`1100×690` 英文窄窗自然换行、无竖条挤压或横向溢出。
   - **`board-vs-impl-o1c-agent.png`、`impl-o1c-agent-en.png`、`impl-o1c-agent-dark.png`**：Agent 面板严格遵守 §P5「Agent 只指路」（零内嵌配置表单/输入框），仅展示 Nomi 身份行 + 两句说明 + 可点击「连接 APIMart / Connect APIMart」指路卡，底栏显示「未连模型 ▾ / No model ▾」，暗色与英文可读性良好（微末非阻断备注：`impl-o1c-agent-en.png` 中 `Nomi uses APIMart：` 含一处全角冒号，可留后续文案润色）。
   - **`impl-kept-recovery-zh.png`**：已有 API Key 但手动停用助手文本模型时，准确展示「启用 Gemini 3.5 Flash」一键恢复主按钮与「连接模型」次按钮。
3. **`F-D` 4 条 `noGenericContract` 核对与路径隐私**：
   - 核查 `NF-1117-0001`、`NF-1115-0001`、`NF-1107-0004`、`NF-1016-0001` 已在设计卡 §6 逐条对应到 `noGenericContractFailure` 与 `adapterFailureAdvice`（统一指向 `selfConnect` 调用脚本 / ComfyUI，零诱导 OpenAI 兼容模板）并由单测锁定；
   - 全量 diff、提交日志与本验收单均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑单测、变异反例与全套门岗

### 2.1 核心 Vitest 套件全绿（`--maxWorkers=2`，6 套件 **35/35 通过**）
- `src/ui/onboarding/onboardingS7aEntries.test.tsx`（6/6）
- `src/ui/onboarding/onboardingModelAvailability.test.ts`（4/4）
- `src/ui/onboarding/ApimartConnectPage.test.tsx`（5/5）
- `src/workbench/ai/assistantModelIdentity.test.ts`（9/9）
- `electron/catalog/dreaminaSeed.test.ts`（8/8）
- `electron/capabilityCore/modelOnboarding/noGenericContract.test.ts`（3/3）
- `src/workbench/common/useDedupedModelSelect.test.ts`（42/42，`c61eb8ea69c0` 同步 `nomi-open-apimart-connect` 断言后实跑通过；7 套件共 77/77）

### 2.2 三项独立反例变异测试（3/3 必红 → `git checkout -- .` 还原 100% 复绿）
1. **M1（新装即梦种子误启用：`electron/catalog/dreaminaVendor.ts:15` 将 `enabled: false` 改为 `enabled: true`）**：运行 `electron/catalog/dreaminaSeed.test.ts` → **1 failed / 7 passed (8)**（新装默认未启用断言立刻翻红，`exit=1`）。
2. **M2（破坏可恢复助手大脑角色过滤：`src/workbench/ai/assistantModelIdentity.ts:71` 移除 `&& fitsAssistantTextRole(m)`）**：运行 `src/ui/onboarding/onboardingS7aEntries.test.tsx` → **1 failed / 5 passed (6)**（误选 `prompt-refiner-only` 而非 `gpt-5-chat`，`exit=1`）。
3. **M3（破坏 S7a 统一连接路由：`src/workbench/common/useDedupedModelSelect.ts` 断开 `openApimartConnect()` 调用）**：运行 `src/ui/onboarding/onboardingS7aEntries.test.tsx` → **1 failed / 5 passed (6)**（`entry.picker-empty` 期望 2 次统一路由事件仅收到 1 次，`exit=1`）。
4. **还原复绿**：`git checkout -- .` 恢复干净后复跑 `dreaminaSeed.test.ts` + `onboardingS7aEntries.test.tsx` → **2 passed / 14 passed (`exit=0`)**。

### 2.3 串行静态与治理门岗（全部 `EXIT=0`）
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：✅ 0 错
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：✅ 0 错
- `node scripts/check-test-types.mjs`：✅ `src/` 0 错（存量 10 个只减不增）
- `pnpm run check:board-parity`：✅ 全量规则单测与板对账通过
- `pnpm run check:i18n`：✅ 23/23 单测 + `visible-text` + `key-parity` + `key-ref` + `fragile-match` + `test-copy-literals` 全绿
- `pnpm run check:controls`：✅ 控件交互契约 0 违规
- `node scripts/check-file-sizes.mjs`：✅ 0 红牌超限
- `node scripts/check-design-lab.mjs --mirrors-only`：✅ mirrors 行号全部对齐
- `pnpm run check:perf-scenarios`：✅ 23/23 单测 + 93 场景齐全（`onboarding-connect-open` 5 轮中位数 `48.2ms` / p95 `48.4ms` ≤ `150ms`，`longTasks = 0`，`mediaRequests = 0`，原始结果 `docs/evidence/2026-11-24-t5-onboarding-s7a/perf-onboarding-connect-open.json`）
- `NOMI_BASE_REF=origin/feat/t5-onboarding-main-card-and-big-page` 与 `NOMI_BASE_REF=origin/main` 双基线实跑 `check-self-written.mjs`（0 未认领）与 `lint-changed.mjs`（77 文件 0 错误 0 新增警告）：✅ 全绿

### 2.4 CI 修复与 `origin/main`（`6c09b7510`）合入版独立复验（HEAD `8659f84f344de05085a8dadc79803874516052cb`）
- **生产种子与隐私核查**：确认 `electron/catalog/dreaminaVendor.ts:15`（`DREAMINA_VENDOR_SEED`）与 `electron/catalog/volcengineVendor.ts:41`（`VOLCENGINE_SPEECH_VENDOR_SEED`）生产新装默认仍严格保持 `enabled: false`（仅在测试对等辅助中启用）；新提交 diff 0 本机路径泄露。
- **4 套核心 Vitest 独立实跑（`--maxWorkers=2`，4/4 文件，174/174 通过）**：`electron/parity/landingProjectionParity.test.ts`、`electron/parity/paramsKeysByMode.matrix.test.ts`（2/2，快照全一致）、`src/ui/onboarding/onboardingS7aEntries.test.tsx`（6/6）、`src/workbench/ai/v4/agentPanelV4Blocks.test.ts`（74/74）。
- **9 项串行门岗全绿（`EXIT=0`）**：`tsc`（app + electron）、`check-test-types.mjs`（`src/ 0 错`）、`check:filesize`（`ResidentThreadMenu.tsx` 拆出后 0 红牌）、`lint-changed.mjs`（0 错）、`check-design-lab.mjs --mirrors-only`、`check-boundaries.mjs`（53/53 基线 0 新增）、`check-boundary-owners.mjs`（2137 条）、`check:board-parity`。
- **会话菜单锚点断言修复复验（HEAD `ec7d1df89aa24cc53a179984fa83ced2912d1a81`，生产代码 0 改动）**：核实增量 diff 仅更新 `tests/ux/agent-runtime-walk-support.test.mjs`（同时断言父组件 `<ResidentThreadMenu` 与子组件 `ResidentThreadMenu.tsx` 的 `data-agent-thread-menu="true"` 锚点），独立实跑 `tests/ux/agent-runtime-walk-support.test.mjs` **25/25 passed**、`lint-changed.mjs`（87 文件 0 错）与 `check-concept-owners.mjs`（401 概念 0 新增第二写口）全绿。
- **3 张更新 Design Lab 基线图逐张 `read_file` 目视通过**：`ps-20-settings-dialog.png`（设置通用清单第 1 步「连接模型」清晰对齐）、`ps-23-handbook-dialog.png`（新手手册第 2 步与「第一次用」已统一为 `APIMart` 三步，无旧 `Agnes` 残留）、`vo-04-picker-empty-no-vendor.png`（空模型下拉「还没连模型 · 连接模型」排版紧凑无截断）。

## 3. 未验证范围与协调待确认项说明
- **未验证（`unverified`）**：Windows 真机原生标题栏三键让位（当前仅 macOS 实测）、真实付费线上模型调用（本切片零计费请求）、Agent LLM 意图规划评测（本切片仅处理前端未连模型指路卡与一键恢复入口，未改提示词或工具契约）。
- **合并前协调确认项（`merge-preflight` 提示）**：开 PR 后需协调按提示执行 `coord-approve.mjs` 确认相关板与性能场景基线。
