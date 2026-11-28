# 方向检查：画布与常驻面板整屏重复表面防呆（类根因复盘）

**这一处的全图在哪**：表外（跨 `AgentPanelV4Panel` 头部与流内恢复卡、`GenerationCanvasReactFlow` 底栏与 `GenerationCanvasReactFlowOverlays` 空态、以及 `tests/ux/_feel.mjs` / `gate-family` 视口扫描链）。

### 0. 一句话根因

各子树（面板顶栏 vs 未连模型卡、空画布中央起步卡 vs 底部浮动工具条）各自独立判断挂载、组件单测只验局部子树，缺少「同一视口同一职责只能有一个激活宿主」的互斥裁决与整屏自动扫描。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 常驻 Agent 面板上下相距约 22px 出现两个 `Nomi` 徽标 | `NoTextModelRecoveryCard.tsx` 保留了 v4 前独立面板时代的 `NomiIdentityRow`，与 `AgentPanelV4Panel` 永久 `<header>` 叠出双头 | 宿主已接管身份但子卡片未删旧身份头 |
| 空画布（0 节点）正中央 7 张起步卡与正下方底部 7 钮创建条同屏并存 | `GenerationCanvasReactFlow.tsx` 只判 `!readOnly` 即挂 `CanvasToolbar`，未与 `nodes.length === 0` 的 `CanvasEmptyState` 互斥 | 空态引导与常驻工具栏未共享单一状态机 |
| `01-workbench.tsx` 镜像行号与 `gate-family` 门岗连带命中 | 源码行号硬编码镜像随删旧行漂移；通用体感扫描此前未覆盖近距重复头与重复工具条 | 局部测试盲区 + 门岗判据缺整屏结构去重 |

### 2. 为什么这一类会一直出现

组件按“自己缺什么就画什么”局部演化：写恢复卡时怕没有身份头就自带 `NomiIdentityRow`，写画布空态时加了 7 张起步卡却没把底栏收进同一个显隐函数；而单测和旧 `_feel.mjs` 都没有站在 1440×900 整屏视角审视“两个同职责元素同时出现在一个视口里”。

#### 三条体验铁律（类根因必须落到其中一条或明确不适用）

| 铁律 | 结论与最小证据 |
|---|---|
| ⑩ 说的=摆的 / ⑪ 能选到 | 不适用（本次不涉及意图参数映射或模型参数下拉过滤）。 |
| ⑫ 点了=以为的 | **适用**：创作者在 0 节点空画布与未连模型面板首屏看到两套完全一样的 7 钮创建栏和两个紧挨的 `Nomi` 标题，破坏首屏唯一焦点；逃逸账本 `USER-20261128-canvas-duplicate-surfaces` 结账挂类级矩阵检查 `tests/ux/feel-policy.test.mjs` 与整屏几何扫描 `tests/ux/_feel.browser.mjs`（证据：`docs/evidence/2026-11-28-canvas-duplicate-surface-guard/canvas-duplicate-guard.scorecard.md`）。 |

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. 弹窗或抽屉 `<header>` 写了标题后，正文首块又写一遍同名 `<h2>`，局部单测继续全绿漏网 | `node --test tests/ux/_feel.browser.mjs`（`duplicate-nearby-header` 用例） |
| 2. 别的空状态页（如分镜/素材空态）加了中央起步动作排后，底栏/顶栏同构动作排忘记收起，再次同屏双排 | `node --test tests/ux/_feel.browser.mjs tests/ux/_feel-observer.browser.mjs`（`duplicate-action-bar` 棘轮零容忍） |

### 4. 靶子独立性检查

- 此前走查外壳 `tests/ux/_shell.mjs` 的 `canvasAddBar(win)` 只认 `.generation-canvas-v2-toolbar`，等于在靶子里隐含假设“0 节点也必须挂底部工具条”。
- 本次先修靶子：`canvasAddBar(win)` 与 `CANVAS_ADD_SURFACE` 对齐项目库 `newProjectEntry(win)` 的单活入口模式（0 节点认中央起步排，`≥1` 节点认底部工具条），消除“删掉重复底栏反而让走查假红”的错靶子。

### 5. 这一整块归谁（P0）

这一整块：画布创建入口互斥显隐、常驻面板唯一品牌头归属与整屏体感扫描门岗（含自写登记 `gate-family`）
归谁：src/workbench/generationCanvas/components/CanvasEmptyState.tsx:24 · src/workbench/ai/v4/AgentPanelV4Panel.tsx:419 · tests/ux/_feel.mjs:11（Playwright 1.60 页面几何评估与门岗瘦身迁入 ESLint 计划 docs/plan/2026-11-28-gate-retirement-candidates.md:1）
我们哪里绕开了它：src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:657 脱离节点数独立判 !readOnly 挂载底部工具条，src/workbench/ai/NoTextModelRecoveryCard.tsx:93 在面板头下方重复渲染 NomiIdentityRow，且 tests/ux/_feel.mjs:141 漏掉同容器近距重复头与同构动作条检测

关于自写登记 `gate-family`（`under-review`）：全仓门岗正在按 `docs/plan/2026-11-28-gate-retirement-candidates.md` 分批把纯 AST 扫描门折入 `eslint.config.mjs` 与 `.dependency-cruiser.mjs`（目标复查期 `2026-12-21`）；而 `scripts/check-feel.mjs` 守卫的是 `feel-baseline.json` 棘轮与 `_feel.mjs` / `_feel-observer.mjs` 的无产品选择器边界，静态 ESLint 无法运行真实浏览器 `getBoundingClientRect` 视口几何计算，因此本次不新建任何 `check:*` 脚本，仅在既有 `_feel.mjs` / `_feel-observer.mjs` / `check-feel.mjs` 内补齐整屏去重判据。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在各组件上加 CSS 隐藏或特例 props | 小 | **会**——别的面板或空态仍会继续叠双头、双工具条 | 留死 DOM 与隐藏监听 | 否 |
| **换一种做法 + 删掉冗余（推荐）** | **删掉** `NoTextModelRecoveryCard` 内 3 处 `<NomiIdentityRow />`；把画布空态与底栏**换成**共享纯函数 `resolveCanvasCreationSurface` 单源互斥裁决；在 Playwright 整屏观测层 `_feel.mjs` / `_feel-observer.mjs`（Playwright `1.60.0`，`tests/ux/_feel.mjs:11`）以零预算棘轮自动阻断 `duplicate-nearby-header` 与 `duplicate-action-bar` | 中（同步对齐 `_shell.mjs` 单活入口出口） | **不会**——代码层互斥无法同屏双挂，观测层在每次 `smoke`/旅程截图检查点自动拦截整屏近距双头与同构双栏 | 需排除正常多节点与单行消息操作钮（已由 LCA 内容体判据与 29+5 项浏览器正反单测验证零误伤） | **推荐（由协调会话按 P1 换/删定案）** |
| 删掉（最小可删单位） | 已并入上一行：最小删除单位即 `NoTextModelRecoveryCard` 内的冗余 `<NomiIdentityRow />` 挂载与 `nodes.length === 0` 时的冗余 `<CanvasToolbar />` 挂载；完整保住未连模型指路/一键恢复与 7 项创建动作，老用户零数据迁移 | 低 | 配合观测器棘轮后同类不再漏网 | 无 | **同上（已执行）** |

### 7. 用户要权衡的核心

0 节点空画布只留正中央一套带文字的 7 张起步卡（收起底下重复的 7 颗小图标条，建出第 1 个节点后再亮底栏），同时面板里只留顶栏唯一一个 `Nomi` 名字，换取首屏干净聚焦、零双胞胎干扰。

## 特征测试清单（动结构前先锁住）

- `src/ui/onboarding/onboardingS7aEntries.test.tsx`（锁住未连模型指路卡、可恢复大脑一键启用与顶栏唯一 `Nomi` 身份）
- `src/workbench/generationCanvas/components/CanvasEmptyState.test.tsx`（锁住 6 常驻意图 + 更多菜单、`readOnly` 行为与 `resolveCanvasCreationSurface` 互斥不变量）
- `tests/ux/_feel.browser.mjs`、`tests/ux/_feel-observer.browser.mjs`、`tests/ux/feel-policy.test.mjs`（锁住整屏双头/双工具条正反检测与零预算棘轮）
- `tests/ux/smoke.e2e.mjs`（锁住真实 Electron 空画布加首节点 → 1 节点底栏加导演台全链路与 16 个体感检查点）
