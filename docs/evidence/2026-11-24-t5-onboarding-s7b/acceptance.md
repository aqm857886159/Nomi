t5-s7b-verify：通过

- 验收线：t5-s7b-verify
- 实现线：t5-onboarding-s7b-impl
- 验收 HEAD：b2ff287f9f5d6aad0383cd698c224987e0d6b041
- 关联任务：协作看板 #1586 · T-5 接入引导第一批切片（`E0` 收成一扇门 + `S7b` 删开屏、首屏主卡与整窗出发大页）
- 设计卡：`docs/plan/2026-11-24-t5-onboarding-s7b.md`

## 1. 五张并排真截图逐张目视核对（均亲眼 `read_file` 核验）

1. **`docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-library.png`（`O0-library 1440×900 zh-CN`）**：
   - 无开屏直达项目库；首屏主卡左 3 张 `108×108` 随包作品（`Seedance 2.0`、`Nano Banana 2`、`Nano Banana`）与右栏实时目录模型数（`88 个模型都能用`）、`$5 大约能出 470 张图（按公开价估算）`、唯一黑底胶囊主按钮「连接模型」及「用别家服务？去设置」全部对齐；下方「新建空白项目 / 打开已有文件夹 / 看 Nomi 怎么出片」三卡均为次级平级样式，无多余嵌套框、无截断。
2. **`docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-zh.png`（`Main 1440×900 zh-CN`）**：
   - 顶栏 `← 项目库 › 连接 APIMart` 共享外壳几何；左栏一大两小拼贴与角标对齐；右栏严格仅用 `400 / 600` 两档字重，三栏等宽 `tabular-nums`（`88` / `最新一代` / `4%–47%`）、估算行 + `数字怎么来的`、三步条（无左侧打勾违规）、黑底胶囊 `打开官网 ↗` + `打不开？ · 链接带 Nomi 邀请码` + 顾虑行 + 底部非受控密码框与粘贴按钮逐项匹配拍板样张。
3. **`docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-en.png`（`O2-en 1440×900 en`）**：
   - 全屏纯英文零中英混语（`← Projects › Connect APIMart`、`88 models`、`Latest / older ones stay`、`4%–47% below official prices`、`Open site ↗`、`Can't open it?`、`After step 3, paste your key here`），无折行挤压或溢出。
4. **`docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-dark.png`（`O2-dark 1440×900 dark`）**：
   - 暗色表层与对比度一致，主按钮正确反转浅底黑字，第 1 步悬停路径提示（`已有账号直接登录 · 注册 → 创建账户`）与样张逐项一致。
5. **`docs/evidence/2026-11-24-t5-onboarding-s7b/board-vs-impl-narrow.png`（`O2-narrow 1024×700 zh-CN`）**：
   - `< 1200px` 正确切换顶部三图横条 + 单栏居中布局，第 2 步活动提示（`按需先充值 · 钱包 → 充值`）、主按钮「打开官网」与底部 Key 输入框全部完整落在 `700px` 首屏视口内，零横向溢出。

## 2. 同提交删旧、老用户保护与首轮拦回闭环

1. **删除旧开屏**：核查 `src/workbench/onboarding/SplashIntro.tsx` 已同提交彻底删除（`-440` 行，`git ls-files '*SplashIntro*'` 为空），设置页「重看开屏动画」与历史死锚点同步清理。
2. **老用户零打扰与兄弟连接保护**：`src/ui/onboarding/onboardingModelAvailability.ts` 直接基于 `swr` + `projectOnboardingConnections` + `electron/shared/builtinVendorIdentity`（`isVendorOfBuiltin` / `builtinVendorKeyOfKey`），保证 0 项目全新装机（含免鉴权 `local-speech` / 未登录即梦 / 未填 Key 种子）必出主卡，而已有项目或已接入任一可用连接（含 APIMart 兄弟连接 `apimart--mini`、别家供应商、自定义中转、ComfyUI、本地模型、已登录即梦）出现主卡次数严格为 `0`。
3. **首轮拦回 → 次轮清零闭环**：
   - 首轮（`a545b9506a3cf225707b89bbdf27946826630750`）独立验收拦截 5 组真 CI 阻断（`scripts/comfyui-real-user-journey.mjs:235` 多余 `}` 语法错、`tests/ux/journeys/experience.walk.mjs:66` 未定义 `skip`、`apimartConnectRoute.ts` / `onboardingDrawerConnections.ts` / `useOnboardingModelAvailability.ts` 3 处 `builtin-vendor-literals` 违规、`useOnboardingModelAvailability.ts` 命中 `check-self-written` 未认领、4 文件 unused vars/imports）。
   - 次轮（`e56e7cd4dba66a217b0cf6fa98a6577fea3828de`）复验确认上述 5 组全部清零，`check-self-written.mjs` 与 `lint-changed.mjs` 均 `EXIT=0`，全量 diff 含 **0 处**本机绝对路径或工作树路径泄露。
   - 推送前守卫收口复验（`b2ff287f9f5d6aad0383cd698c224987e0d6b041`，增量仅 3 文件）：① `ApimartConnectPage.tsx` 改用 `ResizeObserver` 量 `<main>` 容器宽度 `< 1180px` 并将 `min-[1400px]:gap-12` 改为 `xl:gap-12`，`narrowOneThreshold.structure.test.ts` + `ApimartConnectPage.test.tsx` + `onboardingModelAvailability.test.ts` **3 套件 12/12 通过**；② 删除 `tests/ux/design-lab/__baselines__/primitives-surfaces/ps-45-splash-dialog.png`，`node scripts/check-design-lab.mjs --mirrors-only` 通过；③ `scripts/station-waits-baseline.json` 收紧 3 条陈旧等待 hash（`587 → 584`），`pnpm run check:test-waits`（14/14 + `new/stale: 0`）通过。

## 3. 独立实跑测试、变异反例与全套门岗

### 3.1 核心 Vitest 单测（`--maxWorkers=2`，8 套件 **107/107 通过**）
- `src/ui/onboarding/onboardingModelAvailability.test.ts`（含 C1 / C2 / C3 / `apimart--mini` 兄弟连接）
- `src/ui/onboarding/ApimartConnectPage.test.tsx`（含 C4 禁止 focus 偷读剪贴板、非受控密码框、400/600 字重、1 秒防连点）
- `src/workbench/onboarding/onboardingState.test.ts`
- `electron/protocol/localProtocol.test.ts`
- `src/ui/app-shell/windowChrome.test.ts`
- `src/workbench/settings/settingsDialogStructure.test.ts`
- `src/workbench/modalInputLayerCensus.test.ts`
- `tests/world/world.locks.test.mjs`

### 3.2 三项独立变异反例（均在 `e56e7cd4dba6` 实跑必红 → `git checkout -- .` 还原复绿）
1. **M1（C1：删去 `onboardingModelAvailability.ts` 对 `local-speech` 的排除）**：运行 `onboardingModelAvailability.test.ts` → **1 failed / 3 passed (4)**（C1 立刻翻红，`exit=1`）。
2. **M2（C2：将 `hasUsableModelConnection` 收窄为只查 APIMart、忽略别家已接入供应商）**：运行 `onboardingModelAvailability.test.ts` → **1 failed / 3 passed (4)**（C2 立刻翻红，`exit=1`）。
3. **M3（兄弟连接回归：将 `isVendorOfBuiltin(vendorIdentities, conn.vendorKey, 'apimart')` 改回 `conn.vendorKey === 'apimart'`）**：运行 `onboardingModelAvailability.test.ts` → **1 failed / 3 passed (4)**（`apimart--mini` 断言立刻翻红，`exit=1`）。
4. **还原复绿**：`git checkout -- .` 恢复工作区干净后复跑 `onboardingModelAvailability.test.ts` → **4/4 passed (`exit=0`)**。

### 3.3 全套仓库门岗实跑（全部 `EXIT=0`）
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：✅ 0 错
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：✅ 0 错
- `node scripts/check-board-parity.mjs`：✅ 12 张板候选全部认领（`Onboarding` 19 `implemented` + 4 `dropped`、`NomiEntryTopbar` 1 项）
- `pnpm run check:i18n`：✅ 23/23 单测 + `visible-text` + `key-parity`（6670 keys）+ `key-ref`（1820 文件）+ `fragile-match` + `test-copy-literals` 全绿
- `node scripts/check-perf-scenarios.mjs`：✅ 93 个场景结构齐全（`onboarding-connect-open` 实测 `47.4ms` median / `47.9ms` p95，基线 `46.3ms / 47.2ms`，远低于 `150ms / 225ms` 预算，原始数据 `docs/evidence/2026-11-24-t5-onboarding-s7b/perf-onboarding-connect-open.json`）
- `pnpm run check:tokens`、`pnpm run check:controls`、`pnpm run check:icon-semantics`、`pnpm run check:walkthroughs`（108/108）：✅ 全绿
- `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs`：✅ 177 领域目录 · 64 登记 · 新增 8 文件 0 未认领
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：✅ 53 改动文件 · 0 错误 · 0 新增警告
- `node scripts/check-design-lab.mjs --mirrors-only`、`pnpm run check:test-waits`（14/14 + `584` 基线 `new/stale: 0`）、`src/ui/app-shell/shell/narrowOneThreshold.structure.test.ts`：✅ 全绿（`b2ff287f9f5d` 复跑 `EXIT=0`）
- `node scripts/check-boundaries.mjs`、`node scripts/check-boundary-owners.mjs`、`node scripts/check-concept-owners.mjs`、`node scripts/check-file-sizes.mjs`、`node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 全绿

## 4. 未验证范围与协调待确认项说明
- **未验证（`unverified`）**：Windows 真机原生标题栏三键让位（当前仅 macOS 实测）、真付费 Key 线上余额查询（本切片不改 `S6` 与线上扣费）、`Seedance 2.0` 橘猫 1.0–3.8s 原 `.mp4` 裁片（当前稳停在随包海报帧）。
- **合并前协调确认项（`merge-preflight` 提示）**：`--board NomiEntryTopbar`、`--board Onboarding`、`--perf onboarding-connect-open`（PR 创建后由协调执行 `node scripts/coord-approve.mjs --pr <号>` 确认）。
