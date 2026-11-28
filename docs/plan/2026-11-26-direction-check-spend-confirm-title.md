# 方向检查：花钱确认框反复被修与弹窗标题截断类根因复盘（RW-spend）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 写的线：未参与过 `SpendConfirmDialog.tsx` 近 14 天任何一轮修改与 `feat/sd-sample-mode` 实现的独立复盘线（Gemini 4 Carbon） · 2026-11-26 · 只读源码与历史后提交本文档。
> 触发：`node scripts/fix-churn.mjs src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` 命中双热点——① 文件近 14 天已有 **4** 个 `fix` 提交，下一刀是第 **5** 个；② 目录 `src/workbench/generationCanvas/spend/` 近 14 天已有 **6** 个 `fix` 提交（涉及 5 个文件），下一刀是第 **7** 个。

**这一处的全图在哪**：表外（`docs/engineering/seams.json` 登记了付费策略与错误文案，未登记弹窗标题栏排版交接处）。现役边界由以下四处共同组成：
- 弹窗外壳唯一入口：`src/design/overlays.tsx:66-148`（`DesignModal`，`docs/engineering/concept-owners/ui.dialog-layout.json` 登记主人）；
- Mantine 主题映射：`src/theme/nomiTheme.ts:284-291`（`components.Modal`）与 `@mantine/core@8.3.18` 的 `ModalBase.css`；
- 非对话付费确认唯一弹窗：`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:87-147`（`door-map SpendConfirmDialog` 读入口 1 扇，`door-map requestConfirm` 写入口 7 扇 / 12 处调用）；
- 设计规范与守门测试：`docs/design/nomi-design-system.md:812-855`（§3.5 弹窗 overlays）、`src/design/overlays.structure.test.tsx`、`src/design/dialogName.browser.test.ts`。

### 0. 一句话根因

`DesignModal` 分两次收口了弹窗的「高度滚动」（11-09）和「读屏名字」（11-22），却始终没收口**标题栏的排版与折行契约**（`overlays.tsx:96-102` 只管 `content / header / body`，没管 `title`），任由 `SpendConfirmDialog.tsx:141` 保留迁壳前的手写 `truncate`，在 `380px` 窄卡扣除图标与关闭键后仅剩约 `270px` 的标题槽里把英文长问句直接截断。

### 1. 归类表：近 14 天全部 6 个 `fix`（含本文件 4 个 + 同目录 2 个）与本次触发项

| 提交 / 问题 | 触碰文件与直接原因 | 类 |
|---|---|---|
| `cdcae82d4`（2026-11-13）`fix(dialog-shell)` | `SpendConfirmDialog.tsx`：首次迁入 `DesignModal` 时外壳未隔离标题与副标，Mantine `aria-labelledby` 把 Agent 副标一并念进对话框名字，只能在本文件补 `aria-hidden` + `sr-only`。 | **A：弹窗外壳契约未收完，调用方局部打补丁** |
| `e9c8c5e39`（2026-11-13）`fix(design)` | `SpendConfirmDialog.tsx` + `overlays.tsx`：迁壳丢了关闭键锚点，且多弹窗标题含杂项污染读屏名，外壳临时加 `accessibleName` 过渡口子、本文件补回 `closeButtonProps`。 | **A：弹窗外壳契约未收完，调用方局部打补丁** |
| `c5b68c048`（2026-11-22）`fix(a11y)` | `SpendConfirmDialog.tsx` 等 4 个弹窗：为清零无障碍普查名单，逐个弹窗手传 `accessibleName={pending.title}`（同日 `c4b07cdcc` / `748975b0d` 才改为 `title: string` + `header` 插槽删掉该过渡口子，但仍留着各调用方手写的 `classNames.title`）。 | **A：弹窗外壳契约未收完，调用方局部打补丁** |
| **本次触发项**（`feat/sd-sample-mode` 走查） | `SpendConfirmDialog.tsx:88-108, 123, 141`：`380px` 宽弹窗同时放 `32px` 图标、标题和 `DesignModal` 默认开启的 `28px` 关闭键（板 States E4 未画关闭键且注「比真框 380 窄才折行」），而 `:141` 手写 `truncate` 禁止折行，英文 `This draft already has a 1080p HD version`（41 字符）被截成 `…v…`。 | **A：弹窗外壳契约未收完，调用方局部打补丁** |
| `c83694a96`（2026-11-17）`fix: 仅由设置决定第三方公共临时托管` | `SpendConfirmDialog.tsx` + `spendConfirm.ts`：删掉确认卡上的「按次允许公共临时托管」勾选项与披露文案，收口回设置开关。 | **B：花钱策略业务收口（与画布约价共居 `spend/` 目录）** |
| `963bd7325`（2026-11-23）`fix(spend)` | `SendCostUnitMenuButton.tsx` + `sendCostFormat.ts`：画布发送键旁约价菜单接入汇率单点与中英对齐（未碰弹窗，因共居 `spend/` 计入目录热点）。 | **B：花钱策略业务收口（与画布约价共居 `spend/` 目录）** |
| `b4b0f33f9`（2026-11-24）`fix(generation)` | `spendConfirm.ts`：`paidNodeLedger` 改为 `generationNodeLedger` 让本地 ComfyUI 也进可找回 Run（未碰弹窗，因共居 `spend/` 计入目录热点）。 | **B：花钱策略业务收口（与画布约价共居 `spend/` 目录）** |

### 2. 为什么这一类会一直出现（含全仓弹窗标题 `truncate` 普查）

1. **外壳只管了 DOM 身份，没管视觉排版与防截断**：
   - 核查 `@mantine/core@8.3.18`（`styles/ModalBase.css:1-21`）：Mantine 原生 `.mantine-Modal-title` **本来就不截断、天然可折行**，但默认设了 `line-height: 1` 且 `font-size: var(--mantine-font-size-md)`（在 `nomiTheme.ts:149` 映射为 `13px`）；原生 `.mantine-Modal-header` 设了 `align-items: center`。
   - `DesignModal`（`src/design/overlays.tsx:96-102`）只合并了 `content`、`header`、`body`，**完全没定义 `title` 默认样式，也没把多行标题下的头部改成顶对齐**。结果全仓 **19** 个生产 `DesignModal` 调用方（`node scripts/door-map.mjs DesignModal` 共 20 扇门，扣掉 1 个 `devlab` 样张 = 19 个生产文件）裂成两派：
     - **13 个不传 `classNames.title` 的弹窗**（如 `confirmDialog.tsx:73`、`BrowserPromptExtractionSettingsModal.tsx:119`、`FeedbackShareHost.tsx:53` 等）：吃到 Mantine 原生 `13px` 字号 + **`line-height: 1`**——一旦英文标题折成两行，上下两行文字行距为 0 直接贴死；
     - **6 个手传 `classNames.title` 的弹窗**：各自手写字号、字重与换行策略（`UpdateDialog.tsx:162`、`SelectionPromptSaveController.tsx:201`、`HandbookPanel.tsx:99`、`SkillDetail.tsx:85` 允许折行；唯独 **`SpendConfirmDialog.tsx:141` 写了 `truncate`**、**`CustomCallTitle.tsx:6` 写了 `whitespace-nowrap`**，另有 `OnboardingWizard.tsx:678` 在弹窗体内部自绘 `<h2 className="truncate">`）。
2. **`380px` 窄弹窗的几何算术决定了英文句子标题必超单行**：
   - `SpendConfirmDialog` 默认宽度 `380px`（`:82`），减去左右内边距 `16px × 2`、左侧图标槽 `32px` + 间距 `10px`（`:89-95`）、右侧关闭键 `28px` + 间距 `8px`（`DesignModal` 默认 `withCloseButton: true`，板上未画关闭键所以板上放得下、真屏少掉 `36px` 就爆了），标题净宽仅约 **`270px`**。
   - `16px`（`text-title`）Inter 英文平均字宽约 `8–8.5px`，单行上限仅 **31–33 个字符**。除了本次样片模式的 41 字符标题外，**今天 `main` 上现存的英文付费/核对标题同样会超限或擦边**：如 `reconcile.notFoundTitle`（`'Confirm the provider has no such task?'`，38 字符，380px 卡）、`gate.shotTitle`（`'Confirm shot {{index}} before submission'`，36+ 字符）、以及 `runtime.capability.spendTitle` 拼入英文长动词或未来带模型名/价格的标题。
   - 花钱确认框的标题本质是**合同问题句**（问创作者要不要花这笔钱 / 覆盖这一版），截成 `…` 等于把合同宾语藏起来让用户盲签。

#### 三条体验铁律核对

- **⑩ 说的=摆的**：不适用（非意图抽取到草稿参数的映射）。
- **⑪ 能选到**：不适用（非模型目录参数暴露）。
- **⑫ 点了=以为的**：直接相关——确认框标题是创作者按下 `Confirm (Enter)` 前核对「这一步到底会干什么」的唯一主句，标题末尾被 `truncate` 吃掉（如吃掉 `1080p HD version?` 里的宾语或否定词）会让点击后果与预期失配。

### 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. 今天 `main` 上无需样片模式分支，只要在英文下触发 `reconcile.notFoundTitle`（`'Confirm the provider has no such task?'`，38 字符）或长 `intent` 的 `SpendConfirmDialog`（380px），标题 `scrollWidth > clientWidth` 同样被截断 | 在浏览器测试挂载 `SpendConfirmDialog`，传入 `i18n.t('generationCommon.production.reconcile.notFoundTitle', { lng: 'en' })`，断言 `h2.scrollWidth <= h2.clientWidth` 必红 |
| 2. 其余 13 个未传 `classNames.title` 的 `DesignModal`（如 `ConfirmDialogHost` 破坏性确认框 `size="sm"` 380px）一旦遇到两行英文标题，计算样式 `lineHeight === fontSize`（`line-height: 1`），两行上下紧贴 | 挂载 `<DesignModal opened onClose={nop} size={380} title="Delete all 12 generated shots and local exports permanently?">` 量 `getComputedStyle(h2).lineHeight` 为 `13px` |
| 3. 以后每张新拍板图只要没画右上角 `×` 关闭键、而实现走 `DesignModal` 默认 `withCloseButton: true`，真屏标题可用宽度都会比板上少 `36px`，窄卡英文继续爆单行 | 用 C-0 板屏差异量具对比板与真屏标题区的 `width` 差值恒约 `36px` |

### 4. 靶子独立性检查

- **设计实验室基线曾反向锁死旧毛病**：`c4b07cdcc` 迁壳时以「19 个弹窗像素 0 差」（`ps-37-spend-dialog.png`）当约束，迫使 `SpendConfirmDialog.tsx:141` 原样保留了迁壳前的 `truncate` 和手写类；那是守「和上次一样」，不是守「长英文可读」。
- **拍板图与真屏壳存在 1 处结构分叉**：拍板图 States E4 未画右上角 `×` 关闭键（因卡底已有「取消」按钮 + `Esc`），而 `DesignModal` 默认 `withCloseButton: true` 多占了 `36px` 横向空间。修外壳折行的同时，应明确拍板图没画 `×` 的确认卡是否保留 `×`（或统一折行后保留 `×` 仍能完整显示两行标题）。

### 5. 这一整块归谁（P0）

这一整块：全产品模态弹窗（`DesignModal`）标题栏的字号行高、多行折行、图标/副标插槽与关闭键的对齐契约。
归谁：设计系统唯一弹窗外壳 `src/design/overlays.tsx:66`（`DesignModal`，底层组合 `@mantine/core@8.3.18` `Modal.Header` / `Modal.Title`，规范见 `docs/design/nomi-design-system.md:812` §3.5 与概念登记 `docs/engineering/concept-owners/ui.dialog-layout.json`）。
我们哪里绕开了它：`src/design/overlays.tsx:96-102` 未给 `Modal.Title` 设定默认字号、行高与折行规则；`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:89, 141` 与 `src/ui/onboarding/CustomCallTitle.tsx:6` 各自通过 `classNames.title` 手写 `truncate` / `whitespace-nowrap` 强压成单行，绕开了外壳统一排版。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修（只改 `SpendConfirmDialog.tsx` 一处折行） | 仅把 `SpendConfirmDialog.tsx:141` 的 `truncate` 改成折行、`items-center` 改 `items-start` | 最小（约 5 行 + 更新 1 张实验室基线） | **会**：① `CustomCallTitle.tsx:6` 仍在截断/禁折行；② 其余 13 个走 `DesignModal` 默认值的弹窗（含 `confirmDialog`）折行时仍是 Mantine 的 `line-height: 1` 贴行；③ 新弹窗仍会继续手传 `classNames.title: '... truncate'` | 低 | 否 |
| **换一种做法（推荐：在 `DesignModal` 外壳唯一收口「标题放不下就折行 + 顶对齐」，同提交删调用方手写覆盖）** | 由 `src/design/overlays.tsx`（`DesignModal`）统一定义默认标题排版（`text-title font-semibold leading-[22px] text-nomi-ink break-words`，无 `truncate`）与 `header` 顶对齐（关闭键与首行对齐）；同提交删掉 `SpendConfirmDialog.tsx:141` 的 `truncate`（`:89` 图标与多行标题顶对齐）和 `CustomCallTitle.tsx:6` 的 `whitespace-nowrap`，并在 `overlays.structure.test.tsx` 加 AST/结构守门：**禁止任何 `DesignModal` 调用方在 `classNames.title` 或 `header` 标题槽写 `truncate` / `whitespace-nowrap` / `line-clamp-1`** | 小（改 `overlays.tsx` + 2 个调用方 + 1 条结构守门测试 + 按需刷新受影响的 `ps-07/ps-37` 基线，1 个小 PR 内完成） | **不会再出现**：全仓 19 个 `DesignModal` 弹窗无论英文、模型名、动态次数或价格多长，一律按统一行高自然折行完整可读；谁再塞 `truncate` 当场单测红 | 极低（单行短标题视觉几乎不变，仅 2 行长标题自然增高约 `22px`，而中间滚动区由 `DesignModal` 自动让位，决定栏恒可见） | **⭐ 推荐** |
| 改短英文文案（或删掉右上角关闭键腾 36px） | 把样片模式和各处超 30 字符的英文确认标题逐条改写成 3–4 个词的短语；或在无 `×` 拍板图的确认卡传 `withCloseButton={false}` | 每次新增确认场景都要人工数英文字符数；且含动态模型名（最长 28 字）或金额的标题靠改词根本压不进 `270px` | **一定会回来**：下一个新功能、新语言或带模型名的标题照样超过 `270px` 再截断 | 把合同里的关键条件（如 `already has a 1080p HD version`）删短，创作者反而看不懂为什么要再花一次钱 | 否（仅可作为辅助润色，不能替代外壳折行） |

### 7. 用户要权衡的核心

是让全产品所有弹窗标题在 `DesignModal` 外壳统一按「放不下就自然折成两行、永不把花钱或删除问题截成省略号」定死规矩（推荐，一劳永逸且中间区自动让高），还是为了强保标题栏永远只有一行高而去逐条削短英文合同说明？

## 特征测试清单（动结构前先锁住）

- **已钉住（动结构时必须保持全绿）**：
  - `src/workbench/generationCanvas/spend/SpendConfirmDialog.test.tsx`（G1 双行风险提示与取消/确认钮；G2 Agent 发起时 `h2` 只含标题一句、Agent 副标紧跟其后且无 `aria-label`/`sr-only`）；
  - `src/workbench/generationCanvas/spend/SpendConfirmHost.test.tsx`（回车确认、Esc/遮罩/关闭键取消、返回原焦点）；
  - `src/design/overlays.structure.test.tsx`（三段 flex 列、决定栏在滚动区外、`Modal.Title` 纯净性）；
  - `src/design/dialogName.browser.test.ts`（真浏览器 axe `aria-dialog-name` + `getByRole('dialog', { name })` 精确匹配）；
  - `src/design/dialogMigration.structure.test.ts` 与 `src/design/dialogAnchorFreeze.test.ts`（外壳唯一性与冻结锚点）。
- **未钉住（拍板后实现刀应先补必红测试）**：
  - `380px` 宽 `DesignModal` / `SpendConfirmDialog` 在挂载 40–60 字符英文标题（如 `'This draft already has a 1080p HD version'` 与 `'Confirm the provider has no such task?'`）时，标题元素 `overflowX !== 'hidden'`、计算后 `scrollWidth <= clientWidth`（零水平截断）且折行后 `lineHeight >= 1.25 * fontSize`（不贴行）；
  - 全仓 `DesignModal` 调用方禁止对标题施加 `truncate` / `whitespace-nowrap` 的静态结构检查。
