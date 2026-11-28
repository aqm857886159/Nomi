# 方向检查：画布与常驻面板整屏重复表面与角色舞台移交（类根因复盘）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

**这一处的全图在哪**：表外（跨顶栏 `ShellNomiEntry` 与右侧 `AgentPanelV4Panel` 头部及流内恢复卡、`GenerationCanvasReactFlow` 底栏与 `GenerationCanvasReactFlowOverlays` 空态、以及 `tests/ux/_feel.mjs` / `gate-family` 视口扫描链）。

### 0. 一句话根因

各子树（顶栏入口 vs 面板顶栏 vs 未连模型卡、空画布中央起步卡 vs 底部浮动工具条）各自按局部视角独立挂载品牌/角色或创建栏，缺少「同一视口同一角色/同一职责只能有一个激活舞台」的单源移交机制与整屏自动扫描。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 面板展开时左上 `[N]`、右上 `[··]` 小人、下方 30px 面板头 `[N] Nomi` 及恢复卡 `NomiIdentityRow` 多重打架 | 面板头沿用软件标 `NomiBrand`、恢复卡遗留 v4 前 `NomiIdentityRow`，而活小人五态在面板展开时仍困在顶栏 26px 角落未移交舞台 | 角色真身与软件标职责混用 + 开合未移交舞台 |
| 空画布（0 节点）正中央 7 张起步卡与正下方底部 7 钮创建条同屏并存 | `GenerationCanvasReactFlow.tsx` 只判 `!readOnly` 即挂 `CanvasToolbar`，未与 `nodes.length === 0` 的 `CanvasEmptyState` 互斥 | 空态引导与常驻工具栏未共享单一状态机 |
| `01-workbench.tsx` 镜像行号与 `gate-family` 门岗连带命中 | 源码行号硬编码镜像随删旧行漂移；通用体感扫描此前未覆盖同屏双角色舞台、近距重复头与重复工具条 | 局部测试盲区 + 门岗判据缺整屏结构去重 |

### 2. 为什么这一类会一直出现

组件按“自己这一块缺什么就画什么”局部演化：顶栏入口做了活小人、面板头保留了旧软件标 `[N]`、恢复卡怕没头又自带 `NomiIdentityRow`，画布空态加了 7 张起步卡却没收起底栏；单测只测各自局部子树，旧 `_feel.mjs` 也未检查整屏重复角色、近距重复头与同构工具条。

#### 三条体验铁律（类根因必须落到其中一条或明确不适用）

| 铁律 | 结论与最小证据 |
|---|---|
| ⑩ 说的=摆的 / ⑪ 能选到 | 不适用（本次不涉及意图参数映射或模型参数下拉过滤）。 |
| ⑫ 点了=以为的 | **适用**：创作者打开面板盯的是面板，活小人五态与实时状态应就在面板头说话，顶栏开关安静退居幕后，空画布只留一套中央起步入口；逃逸账本 `USER-20261128-canvas-duplicate-surfaces` 结账挂类级矩阵检查 `tests/ux/feel-policy.test.mjs` 与整屏扫描 `tests/ux/_feel.browser.mjs`（证据：`docs/evidence/2026-11-28-canvas-duplicate-surface-guard/canvas-duplicate-guard.scorecard.md`）。 |

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. 后续改顶栏或面板时再次让顶栏活小人与面板内活小人同时可见，重现双小人同屏 | `node --test tests/ux/_feel.browser.mjs tests/ux/_feel-observer.browser.mjs`（`duplicate-persona-stage` 棘轮零容忍） + `npx vitest run src/design/loadingMark.structure.test.ts` |
| 2. 弹窗或抽屉 `<header>` 写了标题后，正文首块又写一遍同名标题/徽标，局部单测继续漏网 | `node --test tests/ux/_feel.browser.mjs`（`duplicate-nearby-header` 用例） |
| 3. 别的空状态页加了中央起步动作排后，底栏/顶栏同构动作排忘记收起，再次同屏双排 | `node --test tests/ux/_feel.browser.mjs tests/ux/_feel-observer.browser.mjs`（`duplicate-action-bar` 棘轮零容忍） |

### 4. 靶子独立性检查

- 此前 `nomi-entry-topbar.walk.mjs` C4/C5 断言面板打开时顶栏仍为 `data-shape="face"` + 角标，`_shell.mjs` 的 `canvasAddBar(win)` 只认 `.generation-canvas-v2-toolbar`。
- 本次按用户拍板的方案 A 先对齐靶子：面板打开时顶栏断言 `data-shape="toggle"` 且面板头承接活小人与待确认胶囊，`canvasAddBar(win)` 对齐项目库 `newProjectEntry(win)` 单活入口模式。

### 5. 这一整块归谁（P0）

这一整块：Agent 角色开合舞台移交、画布创建入口互斥显隐与整屏体感扫描门岗（含自写登记 `gate-family`）
归谁：src/ui/app-shell/shell/nomiEntryLook.ts:36 · src/workbench/ai/v4/AgentPanelV4Panel.tsx:436 · src/workbench/generationCanvas/components/canvasToolbarModel.ts:13 · tests/ux/_feel.mjs:13（Playwright 1.60 页面几何评估与门岗瘦身迁入 ESLint 计划 docs/plan/2026-11-28-gate-retirement-candidates.md:1）
我们哪里绕开了它：此前面板打开时顶栏入口与面板头各自画标、src/workbench/ai/NoTextModelRecoveryCard.tsx 重复渲染 NomiIdentityRow、src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx 脱离节点数独立挂底部工具条，且 tests/ux/_feel.mjs 漏掉同屏双角色舞台、近距重复头与同构动作条检测

关于自写登记 `gate-family`（`under-review`）：全仓门岗正在按 `docs/plan/2026-11-28-gate-retirement-candidates.md` 分批把纯 AST 扫描门折入 `eslint.config.mjs` 与 `.dependency-cruiser.mjs`（目标复查期 `2026-12-21`）；而 `scripts/check-feel.mjs` 守卫的是 `feel-baseline.json` 棘轮与 `_feel.mjs` / `_feel-observer.mjs` 的无产品选择器边界，静态 ESLint 无法运行真实浏览器 `getBoundingClientRect` 视口几何计算，因此本次不新建任何 `check:*` 脚本，仅在既有 `_feel.mjs` / `_feel-observer.mjs` / `check-feel.mjs` 内补齐整屏去重判据。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 只删恢复卡里的 `NomiIdentityRow`，保留面板头 `[N]` 软件标与顶栏小人同屏 | 小 | **会**——全屏仍有 3 颗黑底标，且用户盯面板时小人五态缩在顶栏角落浪费 | 角色与软件标语义继续混淆 | 否 |
| **换一种做法：方案 A 开合移交舞台 + 单源互斥 + 删冗余（用户已拍板）** | 软件标 `[N]` 退出面板头；面板收起时顶栏 `ShellNomiEntry` 展示活小人/胶囊，面板打开时顶栏退成安静线性开关 `toggle`、唯一活小人与实时状态短句搬进 `AgentPanelV4Panel` 头部；删掉零引用的 `NomiIdentityRow.tsx`；用 `resolveCanvasCreationSurface` 互斥画布空态与底栏；在 `_feel.mjs` / `_feel-observer.mjs` 零预算棘轮拦截 `duplicate-persona-stage`、`duplicate-nearby-header`、`duplicate-action-bar` | 中（同步更新三块画板清单与走查） | **不会**——DOM 与状态层保证全屏最多 1 颗活小人、1 套画布创建栏，观测层在每次检查点自动拦截同类回归 | 需确保收起进隐藏 portal 时卸载面板头活脸（已通过 `!headerSlot?.collapsed` 实现） | **用户拍板定案** |
| 删掉（最小可删单位） | 已并入方案 A：同提交删掉 `NomiIdentityRow.tsx`、`AgentPanelV4Panel` 头部的软件标 `NomiBrand`、`open` 时顶栏重复脸/角标、以及 `0` 节点时的冗余 `CanvasToolbar` | 低 | 配合结构守卫与体感棘轮彻底封死 | 无 | **已并入执行** |

### 7. 用户要权衡的核心

软件标 `[N]` 只代表软件本身留在左上角，活小人 `Nomi` 只保留唯一真身——面板收起时在顶栏值班报信，面板打开时搬进面板头实时演五态表情与状态短句（顶栏退成安静侧栏开关），配合空画布单创建区，让整屏视觉秩序彻底清爽。

## 特征测试清单（动结构前先锁住）

- `src/ui/app-shell/shell/nomiEntryLook.test.ts` & `src/ui/app-shell/shell/ShellNomiEntry.wiring.test.tsx`（锁住开合舞台移交、`toggle` / `capsule` / `face` 三态与存档不变性）
- `src/design/loadingMark.structure.test.ts`（锁死 `<NomiAgentFace>` 全仓仅 `ShellNomiEntry.tsx` 与 `AgentPanelV4Panel.tsx` 两处渲染）
- `src/ui/onboarding/onboardingS7aEntries.test.tsx`（锁住面板头五档实时状态、未连模型指路/自愈卡及零重复头）
- `src/workbench/generationCanvas/components/CanvasEmptyState.test.tsx`（锁住 `resolveCanvasCreationSurface` 互斥不变量）
- `tests/ux/_feel.browser.mjs`、`tests/ux/_feel-observer.browser.mjs`、`tests/ux/feel-policy.test.mjs`（锁住三项整屏去重规则正反单测与零预算棘轮）
