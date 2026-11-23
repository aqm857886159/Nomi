# 设计卡：T-5 接入引导第二批切片（S7a 全部剩余入口指路收口 + F-D 4 条 noGenericContract 反馈核对）

```
改动名：T-5 接入引导 S7a + F-D 核对            线/负责人：t5-onboarding-s7a-impl            类别：[新界面]
```

> 2026-11-24。拍板来源：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`（r8 减字版，用户 2026-11-15「可以，照这版做」；设计合同 `docs/plan/2026-11-15-onboarding-board.md`）与 `docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.board.json`（用户 2026-11-22「全部收进顶栏 / 照这版拍板 / C 不出胶囊」）。
> 本切片在已验收通过的第一批切片（`E0 + S7b`）之上，收口 `S7a` 全部 7 个入口指路元素（`entry.composer-connect`、`entry.persona-setup`、`entry.library-banner`、`entry.agent-pointer`、`entry.picker-empty`、`entry.copy-unify`、`entry.kept-recovery`），并对 `#1586` 中 `F-D` 的 4 条 `noGenericContract` /「这一步没成功」反馈做端到端核对。`S6`（四行检查表、等待、充值与六种错误卡）与 `onb.drop.preset-count` 按边界保持 `missing` 不动；不触碰 `ModelSurfaces.board.json`。

## ★0 先查别人

- NN/g Contextual Help & Empty-State Design（https://www.nngroup.com/articles/onboarding-tutorials/ · https://www.nngroup.com/articles/empty-state-interface-design/）· 创作者已经走进画布节点、分镜行或聊天面板准备干活时，遇到「还没连模型」不能只给一颗灰掉点不动的发送圆钮或把人赶去四层菜单外找设置，而应在动作发生的原位给明确主按钮、悬停讲清耗时并承诺「写好的草稿会留着」 · **确认了**生成框与分镜底栏无可用模型时左端模型框显示「未连模型」（点开为「还没连模型 · 连接模型」），右端发送位换成深色胶囊主按钮「连接模型」配悬停提示，返回后草稿一字不丢。
- Nomi 设计系统 §1.0 与 `AGENTS.md` §P5（「一个东西一个家、Agent 只指路」）· 聊天面板只放指向元素、必要请示与本来属于聊天的说明，绝不在对话流里内嵌配置表单或第二套密钥输入框 · **确认了** `O1c-agent`（`entry.agent-pointer`）：当 Agent 面板没有可用文本模型且无一键可恢复模型时，只显示 Nomi 身份行 + 两句说明 + 可点击指路卡「连接 APIMart」，点一下直达整窗「连接 APIMart」大页；若存在已存 Key 但被停用的文本模型（`entry.kept-recovery`），原样保留「启用 {{model}}」一键恢复。
- `NomiEntryTopbar` 拍板合同（`docs/design/boards/2026-11-22-nomi-entry-topbar/NomiEntryTopbar.board.json` D1/D3/D5 与 `priorDecisions`）· 2026-11-22 已拍板删除右下浮动小球，「收起后只有顶栏最右 28px 入口；胶囊仅在有待确认且面板未开时出现，10-27 形象里的『先连一个模型』胶囊不做」；同时 `Onboarding.board.json` `entry.persona-setup` 备注「落点改成顶栏 Nomi 入口，点开先开面板再指向同一页」 · **对齐了**两条拍板：顶栏 Nomi 入口严格保持 `NomiEntryTopbar` D1/D3/D5 形态不变，未连模型时点顶栏入口展开 Agent 面板即落到 `entry.agent-pointer` 指路卡并直达「连接 APIMart」大页，不复活任何浮动胶囊或顶栏特例胶囊。
- 仓库先例：`src/ui/onboarding/onboardingModelAvailability.ts`、`src/ui/onboarding/apimartConnectRoute.ts`、`src/ui/onboarding/adapterFailureAdvice.ts`、`electron/capabilityCore/modelOnboarding/envelope.ts` · 单一可用性投影、单一整窗大页路由与 `no_generic_contract` → `selfConnect`（调用脚本 / ComfyUI 工作流）出口均已在库 · **确认了**所有入口统一调 `openApimartConnect()` / `openModelSettingsHome()`，零新增路由事件、零新增自定义缓存。
- 出口：不涉及：本切片把分散在生成框、项目库已有项目横幅、Agent 面板、模型下拉、上手清单、创作改写、分镜策略与新手手册里的旧提示和死胡同统一收口到「连接模型」（`openApimartConnect()`）与「用 AI 帮我接入」（`openModelSettingsHome()`），未新增或收紧任何拒绝或阻塞门禁；任何已打开的大页均可随时按 `Esc` 或点左上「← 来处」无损返回原草稿。

## ★1 用户怎么用

当我已经有在制项目、或者先建了空白项目走进画布/分镜/创作/Agent 面板写下提示词却还没连模型时，我想在手边直接看到统一的「连接模型」入口，知道连一个 APIMart 账户通常几分钟就能搞定且刚才写的草稿不会丢，点过去接好（或返回）时原草稿完好留在原地；如果我之前接过 Key 只是把文本模型关了，在 Agent 面板点一下就能直接启用恢复。

1. **项目库已有项目未连模型（`O1b-library` / `entry.library-banner`）**：已有本地项目且当前没有任何可用模型连接时，顶部横幅显示 `IconPlugConnected` +「还没连模型 · 出图、出视频、Agent 都靠一个 APIMart 账户，通常几分钟连好。」+「连接模型」按钮（删掉旧「助手与画布生成模型分别配置」误导说法）；点击打开整窗「连接 APIMart」大页；老用户只要有任一可用连接（文本或生成模型），横幅与首屏主卡均不出现。
2. **画布/列表/分镜生成框未连模型（`O1a-canvas` / `entry.composer-connect` + `entry.picker-empty`）**：先在提示词框输入草稿（如「一只橘猫坐在窗台上」），左侧模型胶囊显示「未连模型 ▾」，点开下拉显示「还没连模型 · 连接模型」；右侧原发送圆钮位置显示深色主按钮「连接模型」，悬停弹出 `Tooltip`（「出图要先连一个 APIMart 账户（通常几分钟），这段草稿会留着」，按图片/视频/通用节点语义适配动词）；点任一处打开整窗「连接 APIMart」大页（左上角显示 `← <项目名> › 连接 APIMart`），按 `Esc` 或点返回后草稿分字不差留在原输入框内。
3. **顶栏 Nomi 入口 → Agent 面板指路与自愈（`O1c-agent` / `entry.persona-setup` + `entry.agent-pointer` + `entry.kept-recovery`）**：
   - 未连模型且面板收起时，点击顶栏最右 `[data-shell-nomi-entry]`（或按 `⌘J`）展开 Agent 面板；
   - 若没有任何已配 Key 的可恢复文本模型，对话流顶部渲染 Nomi 静态身份行 +「我还没有能用的模型，写分镜、出图、出视频都要先连一个。Nomi 用 APIMart：一个账户全都能用，通常几分钟连好。」+ 指路卡「连接 APIMart / 点一下打开接入页，三步说明和价钱都在那里」，底栏模型钮显示「未连模型」，点击指路卡直接打开整窗大页；
   - 点击底栏模型钮弹出的 `V4ModelPopover` 页脚提供「连接模型」（打开整窗大页）与「去设置」（悬停提示「用 AI 帮我接入」，打开 `Settings › 模型` 首页，严守 §1.8 控件 ≤4 字契约）；
   - 若存在供应商已有 Key 但被禁用的文本模型（`entry.kept-recovery`），面板展示「启用 {{model}}」一键恢复主按钮与「连接模型」次按钮，点击一键启用即刻恢复对话大脑。
4. **全仓其余 6 处说法与去向统一（`entry.copy-unify`）**：
   - `Settings › 通用` 上手清单第 1 步改为「连接模型」且未完成时可直接点击跳往整窗大页（自动先关设置弹窗）；
   - 创作页 AI 编辑无文本模型提示、分镜图片参考无模型提示、分镜执行计划无视频模型卡片与按钮统一改为「连接模型」并指向同一扇门；
   - 新手手册 4 处旧 `Agnes` / 免费网关说法改写为 `APIMart` 三步流程（中英同步，零旧词残留）；
   - `runtime.ts` 中旧称「系统模型管理」统一改为「设置 › 模型」（`Settings › Models`）。

不做：
- 不做 `S6`（粘贴后四项检查行、等待条、零余额充值卡、六种错误卡）；
- 不动 `onb.drop.preset-count`（维持 `missing`）；
- 不动 `ModelSurfaces.board.json`（归属 T-6）；
- 不在顶栏或画布右下角新增「先连一个模型」浮动胶囊（遵守 `NomiEntryTopbar` D1/D5）；不在 Agent 对话流内塞入 API Key 输入框（遵守 §P5「Agent 只指路」）。

已知坑：
- 画布工作区在打开 `ApimartConnectPage` 时由 `NomiStudioApp` 用 `<div className="hidden" aria-hidden="true">` 保活不卸载，切不可把工作区条件卸载否则 TipTap 未落盘草稿与选区状态会丢失。
- `Design Lab` 中 `05-empty.tsx` 在无 Electron 桥的浏览器环境运行：此时 `useHasTextModel()` 返回 `true`（Web/实验室环境视为已接入），因此实验室 3 张空态格保持原有起手 chip 不漂移，而真 Electron 未接入目录返回 `hasTextModel === false` 精确渲染 `O1c-agent` 指路卡。
- `primitives-actions`（`01-workbench.tsx:77`）与 `primitives-forms`（`02-selection.tsx:206,298`）声明了 `NoTextModelRecoveryCard.tsx` 与 `InlineParameterBar.tsx` 的源码行号镜像，改动后必须核验 `node scripts/check-design-lab.mjs --mirrors-only` 零越界。

真实任务：
- T1（画布草稿保活往返）：全新未连模型状态新建空白项目，在图片节点生成框输入「一只橘猫坐在窗台上」，核对左胶囊「未连模型」、下拉「还没连模型 · 连接模型」、右主按钮「连接模型」及悬停提示；点击进入整窗大页核对面包屑 `← <项目名>`，返回画布核对草稿完整保留。
- T2（顶栏 Nomi 入口 → Agent 指路卡 + 模型弹层页脚 + 自愈恢复）：在画布收起 Agent 后点击顶栏 Nomi 入口，核对 `O1c-agent` 指路卡与底栏「未连模型」及弹层页脚「连接模型 / 用 AI 帮我接入」；在存在已存 Key 但禁用文本模型的目录下核对「启用 {{model}}」一键自愈恢复。
- T3（已有项目横幅 + 6 处文案统一 + 新手手册核验）：在已有项目但未连模型状态下核对 `O1b-library` 横幅（中/英/暗色/窄窗）并点击进大页；打开 `Settings › 通用` 点上手清单第 1 步跳大页；打开新手手册核对中英文零 `Agnes` 残留。

指标（目标 → 信号 → 指标）：

| 指标 | 目标 | 量具 | 基线 |
|---|---|---|---|
| 主：从画布/Agent/项目库入口打开接入大页响应与草稿保留率 | 点击连接入口到「连接 APIMart」大页就绪 `response` 中位数 ≤150ms（p95 ≤225ms），`longTasks` = 0；返回后生成框草稿保留率 = `100%` | `pnpm run perf:scenarios -- --id onboarding-connect-open` + `tests/ux/t5-onboarding-s7a.walk.mjs` | 5 轮实测中位数 ~46ms，`longTasks` = 0 |
| 质量：`S7a` 7 元素拍板一致性与旧词清零 | 7 个 `S7a` 元素全部通过 `check:board-parity`；`src/` 中 `系统模型管理`、`Agnes 免费网关`、`无限期免费`、`分别配置` 残留数 = `0` | `pnpm run check:board-parity` + `src/ui/onboarding/onboardingS7aEntries.test.tsx` + `tests/ux/t5-onboarding-s7a.walk.mjs` | 7 项 `missing`，多处旧文案并存 |
| 护栏：老用户与一键自愈零退化 | 已有任一可用模型连接的老用户项目库横幅出现率 = `0%`；已有 Key 被禁用文本模型一键启用成功率 = `100%` | `src/ui/onboarding/onboardingS7aEntries.test.tsx` + `tests/ux/t5-onboarding-s7a.walk.mjs` | 原有 `NoTextModelRecoveryCard` 在 v4 壳未挂载 |

新手 / 老手人设与记录方式：
- 新手人设：刚建空白项目在画布写下第一句提示词、或点开右上 Nomi 想让 AI 拆镜却还没连模型的创作者；老手人设：已连好自定义模型或曾配过 Key 但误关文本模型的创作者。
- 记录方式：`tests/ux/t5-onboarding-s7a.walk.mjs` 真 Electron 逐步断言并输出 `O1a / O1b / O1c` 对照图与多语言/暗色/窄窗截图至 `docs/evidence/2026-11-24-t5-onboarding-s7a/`。

### ★1b 连带界面

- 画布与列表详情生成框（`InlineParameterBar.tsx`、`NodeGenerationComposer.tsx`、`TextNodeComposer.tsx`）及分镜行底栏（`StoryboardComposerParams.tsx`）：共用 `InlineParameterBar` 与 `useDedupedModelSelect`，一处收口同时覆盖画布浮框、生成列表内联框与分镜行底栏。
- 新装机免 Key 种子默认启用态收口（`electron/catalog/dreaminaVendor.ts`、`electron/catalog/volcengineVendor.ts`、`src/ui/onboarding/DreaminaMemberCard.tsx`）：落实 2026-11-06 用户拍板 ✅1（`Onboarding` 板删除清单「新装不再预置即梦、火山语音；没模型就如实显示『未连模型』」），`DREAMINA_VENDOR_SEED` 与 `VOLCENGINE_SPEECH_VENDOR_SEED` 在全新空目录初始 `enabled: false`（与 `COMFYUI_VENDOR_SEED` / `CODEX_LOCAL_VENDOR_SEED` / `LOCAL_TEXT_VENDOR_SEED` 一致）；即梦完成扫码登录后同步置 `enabled: true`（退出置 `false`），火山语音保存凭据时由 `upsertRendererCatalogVendorApiKey` 自动置 `enabled: true`。
- 常驻 Agent 面板 v4（`ProjectAgentResidentShell.tsx`、`AgentPanelV4Panel.tsx`、`AgentPanelV4Composer.tsx`、`NoTextModelRecoveryCard.tsx`）：补接 v4 壳下 `hasTextModel === false` 时的指路卡/自愈卡挂载，以及模型弹层页脚双动作（「连接模型」与「去设置」）。
- 项目库页（`ProjectLibraryPage.tsx`）、上手清单（`OnboardingChecklist.tsx`）、新手手册（`handbookContent.ts` + `HandbookPanel.tsx`）、分镜执行计划条（`StoryboardPlanStrategyPanel.tsx`）、创作 AI 改写提示（`creationAi.ts`）与运行时目录提示（`runtime.ts`）：统一术语与入口。
- 设计实验室镜像检查（`node scripts/check-design-lab.mjs --mirrors-only`）：同步保持 `primitivesActions/states/01-workbench.tsx` 与 `primitivesForms/states/02-selection.tsx` 的 `mirrors` 行号有效。

### ★1c 老用户

- 已有项目且已连好任一可用模型（含 APIMart、别家中转、本地模型、ComfyUI、Codex 本地、已登录即梦）的老用户：`seedVendor` 对已落盘 `model-catalog.json` 中的既有供应商记录（`existingIndex >= 0`）原样保留 `enabled` 字段不覆盖；`ProjectLibraryPage` 不出主卡、不出顶部横幅；画布生成框有可用模型时原样显示模型芯片、参数摘要与发送圆钮；Agent 面板有可用文本模型时原样显示对话流与起手 chip。
- 已有供应商 API Key 但手动禁用了文本模型的老用户：打开 Agent 面板时 `NoTextModelRecoveryCard` 检测到可恢复模型，优先显示「启用 {{model}}」一键启用按钮（`entry.kept-recovery`），无需重填 Key。
- 磁盘项目存档、钥匙串凭据与 `model-catalog.json` 数据结构零变更。

## ★2 谁说了算

| 概念 / 事实 | 唯一 owner | 允许消费者 | 这个「1」靠什么保持 |
|---|---|---|---|
| 是否存在任一可用模型连接 | `src/ui/onboarding/onboardingModelAvailability.ts` | `ProjectLibraryPage`、`JourneyTourController`、`ApimartConnectPage` | 复用 `projectOnboardingConnections`，项目库首屏主卡与已有项目横幅读同一份可用连接布尔值 |
| 文本大脑是否就绪 | `src/workbench/library/useHasTextModel.ts`（读主进程 `getTextBrain`） | `NomiStudioApp`、`ProjectAgentResidentShell`、`OnboardingChecklist` | 单一查询入口，目录变更事件自动重查；无桌面桥的实验室环境返回 `true` 不误报缺失 |
| 生成节点当前 kind 是否有可用模型 | `src/workbench/generationCanvas/adapters/modelOptionsAdapter.ts` → `InlineParameterBar` `modelOptions` | 画布生成框、列表详情框、分镜底栏 | `modelOptions.length === 0 && status !== 'loading'` 唯一决定左端空下拉与右端「连接模型」主按钮 |
| 打开「连接 APIMart」整窗大页 vs 打开「设置 › 模型」首页 | `src/ui/onboarding/apimartConnectRoute.ts`（`openApimartConnect` / `openModelSettingsHome`） | 全仓所有连接入口与 Agent 指路卡/弹层页脚 | 显式函数调用，不在各组件手拼不同事件名或混用弹窗参数 |

- 不靠「东西不见了」猜用户意图：所有跳转均由用户显式点击「连接模型」「连接 APIMart」「用 AI 帮我接入」触发；加载中（`loading`）显示脉冲骨架或留白，绝不闪出未连接按钮。

## ★3 一致与复用

- 历史拍板核对：
  - `2026-11-15` `Onboarding` r8 拍板稿（`O1a-canvas`、`O1b-library`、`O1c-agent`）：逐字逐件对齐。
  - `2026-11-22` `NomiEntryTopbar` 拍板稿（D1 删浮动球、D5 仅待确认且未开面板时出胶囊、`priorDecisions` 不画「先连一个模型」胶囊）：严格遵守，顶栏入口点击展开面板后由面板内 `O1c-agent` 承接指路。
  - `2026-10-30` `D-apimart-only`（APIMart 为唯一内置直连，别家走 `Settings › 模型` 的「用 AI 帮我接入」）：Agent 模型弹层页脚同时给出这两条正门出口。
- 三条路选择：**收成一份**——生成框左端空芯片直接复用现成 `NomiSelect` + `useDedupedModelSelect` 的 `connectVendorOption()`（此前被 `InlineParameterBar` 的旧 `configure` 特例按钮挡死变成死代码，删掉旧按钮后两处合成一处！）；Agent 未连模型指路与一键自愈共用 `NoTextModelRecoveryCard` 单一组件按是否有可恢复模型分支渲染，零冗余新文件（不新增 `use*.ts` 钩子）。

## ★4 全状态

- **加载中（`loading`）**：`InlineParameterBar` 在 `modelCatalogStatus.status === 'loading'` 时画 `data-model-chip-loading="true"` 脉冲胶囊，不闪「未连模型 / 连接模型」；`ProjectLibraryPage` 在 `availabilityLoading` 期间不画顶部横幅；`ProjectAgentResidentShell` 在 `hasTextModel === null` 期间不闪未连模型卡。
- **空 / 未连模型（`empty`）**：
  - 项目库（有项目）：显示 `O1b-library` 信息横幅；
  - 生成框：左「未连模型 ▾」（展开为「还没连模型 · 连接模型」），右主按钮「连接模型」（悬停 `Tooltip`）；
  - Agent 面板（无已存 Key 禁用模型）：显示 `O1c-agent` 说明与「连接 APIMart」指路卡，底栏模型钮写「未连模型」。
- **可一键恢复（`recoverable`）**：Agent 面板检测到已配 Key 但被禁用的文本模型时显示「启用 {{model}}」主按钮（点击进入 `enabling` 品牌加载态，完成后显示 `done` 就绪提示并刷新目录）+「连接模型」次按钮。
- **已连接（`ready`）**：连好后项目库横幅消失，生成框恢复模型名芯片、参数摘要与发送圆钮，Agent 面板恢复正常空态起手 chip 或对话流。
- **取消 / 返回（`return`）**：从任意入口打开大页后点「← 来处」或按 `Esc`，立即回到原项目、原工作区模式、原节点与原草稿。
- **能力不可用与非通用协议出口（`F-D`）**：不用 APIMart 的用户走「去设置 / 用 AI 帮我接入」进入 `Settings › 模型`；遇到非通用 HTTP / 私有签名 / 3D 等 `no_generic_contract` 能力边界时，结构化指向 `selfConnect`（调用脚本 / ComfyUI 工作流），见 §6 核对表。
- **防溢出与防拆词**：横幅标题与说明同属一段内联流式文本（`[text-wrap:pretty]`），英文与窄窗自然折行不挤成竖条；句中引号名称使用 `whitespace-nowrap` 包裹不跨行劈裂。

## 5 中途表

| 状态 | 停住不动 | 关窗 | 断网 | 重启 App | 连续猛点 |
|---|---|---|---|---|---|
| 画布生成框输入草稿后点「连接模型」 | 工作区 DOM 保活隐藏，TipTap 草稿与节点状态原封不动 · 不花钱 · 无回执 | 节点草稿已随编辑器 `onChange` 写入项目画布 store / 持久化 · 不花钱 · 无回执 | 本地跳转大页不依赖外网，返回后草稿仍在 · 不花钱 · 无回执 | 已持久化的节点提示词重启打开项目后仍在，未连模型按钮照常显示 · 不花钱 · 无回执 | 连点「连接模型」只打开同一个整窗大页实例 · 不花钱 · 无回执 |
| Agent 面板指路卡 / 一键启用恢复 | 指路卡纯静态展示；一键启用单次写本地目录并广播刷新 · 不花钱 · 目录刷新 | 未点启用不改目录；已启用落盘后保留 · 不花钱 · 无回执 | 指路卡跳转与本地启用已存 Key 模型均无需外网 · 不花钱 · 无回执 | 重启后按真实目录状态决定显示指路卡或正常面板 · 不花钱 · 无回执 | 启用中 `loading` 自动禁用按钮防重入 · 不花钱 · 单次写盘 |
| 项目库已有项目横幅 / 上手清单第 1 步 | 静态展示 · 不花钱 · 无回执 | 不写盘 · 不花钱 · 无回执 | 离线正常显示与打开大页 · 不花钱 · 无回执 | 未连模型且有项目时横幅照常显示 · 不花钱 · 无回执 | 从设置上手清单点击先关设置弹窗再开单一整窗大页 · 不花钱 · 无回执 |

## 6 外部数据与失败（含 `#1586` `F-D` 4 条反馈逐条核对）

- 本切片自身不新增外部网络请求；所有入口统一汇入 Slice 1 的 `ApimartConnectPage` 或现有的 `Settings › 模型` 首页。
- **`#1586` `F-D`（4 条 `noGenericContract` /「这一步没成功」用户反馈）在 T-5 + 现有 Agent 接入链下的端到端核对表**：

| 反馈编号 | 原始用户痛点现象 | 旧路径为什么卡死用户 | 现行 T-5（`E0 + S7b + S7a`）+ Agent 接入链的真实落点与代码锚点 | 核验状态 |
|---|---|---|---|---|
| `NF-1117-0001` | 新手只想出图/出视频，进接入流程撞上 `noGenericContract` 不知道什么意思 | 旧入口把所有用户推进手动填供应商地址/协议自检，选到无通用标准协议的能力时抛出协议报错 | ① 未连模型创作者在首屏主卡、横幅、生成框「连接模型」、Agent 指路卡一键直达 `ApimartConnectPage`（内置 88 个已配平模型，粘贴 Key 即用，**零协议编译**）；② 仅当接入自定义服务且命中 `no_generic_contract` 时，`electron/capabilityCore/modelOnboarding/envelope.ts` `noGenericContractFailure` 与 `src/ui/onboarding/adapterFailureAdvice.ts:44-59` 明确给出人话原因并指向 `selfConnect`（`Settings › 模型` 调用脚本），禁止诱导重试内置模板 | 已由 `noGenericContract.test.ts` + `onboardingS7aEntries.test.tsx` 锁死 |
| `NF-1115-0001` | 用第三方中转站/视频接口验证时报无通用契约，改地址改 Key 反复撞墙 | 旧界面把「该类能力在通用 HTTP 模板无标准端点」混同于连接配置错误，用户反复改 URL | `src/ui/onboarding/adapterFailureAdvice.ts:39-59` 优先识别 `selfCheckReason === 'no_channel'` 与 `compileFailureReason === 'no_generic_contract'`，映射 `reasonKey: 'noGenericContract'` + `action: 'selfConnect'`（直接走调用脚本 / ComfyUI 工作流，不诱导改地址或试 `openai-compatible`）；别家常规 HTTP 服务则从主卡「去设置」或 Agent 弹层「用 AI 帮我接入」走声明卡流程 | 已由 `noGenericContract.test.ts` + `adapterFailureAdvice` 单测锁死 |
| `NF-1107-0004` | 3D / 特殊多步签名模型在接入时卡在通用协议不兼容 | 3D 与多步签名 SDK 在通用 REST 声明卡外无统一标准端点，旧手工表单既接不通又没给真出口 | 主进程 `noGenericContractFailure(modelId)` 点名具体模型与缺失能力类别（signature / non-HTTP / SDK / steps），出口唯一指向 `Settings` 中的 `Call script` / 本地 ComfyUI 工作流，且严禁复活手工多字段协议配置表单 | 已由 `noGenericContract.test.ts:13-30` 锁死 |
| `NF-1016-0001` | 接入或调用时报笼统「这一步没成功」，创作者看不出是没连模型、Key 错还是协议不支持 | 多处入口各自弹笼统失败串或跳往空白模型目录，缺少按真实状态分流的唯一指路 | ① 未连模型前置分流：生成框直接变「连接模型」、Agent 面板直接出 `O1c-agent` 指路卡、创作/分镜/运行时提示全部点名具体去向；② 已有 Key 仅文本模型被关时 `NoTextModelRecoveryCard` 给一键「启用 {{model}}」；③ Agent 接入工具层 `envelope.ts` 按结构化 `code`（`credential_rejected` / `endpoint_unreachable` / `no_generic_contract` / `route_conflict`）与 `adapterFailureAdvice.ts` 分流到唯一可执行动作，不再拿一句笼统失败糊弄用户 | 已由本切片单测 + 真机走查闭环验证 |

## ★7 性能

1. **新增/变更用户操作**：在画布含节点的真实工作区中渲染无模型态底栏（左空 `NomiSelect` + 右「连接模型」主按钮），点击「连接模型」或从 Agent 指路卡切入整窗 `ApimartConnectPage` 并返回原草稿。
2. **最坏规模**：目录含全部内置种子（APIMart 88 个活跃模型），E10 画布 10 个节点同时在场，切换整窗接入大页再返回。
3. **操作预算**：
   - 点击连接入口 → 整窗「连接 APIMart」大页输入框可见再过两帧（`response`）：**中位数 ≤ 150ms**（尾部 p95 ≤ 225ms），`longTasks` = **0 个**；
   - `InlineParameterBar` 在 `modelOptions.length === 0` 时跳过阴影根节点宽度拟合观察器（`yielding = false`），无模型态底栏挂载额外布局测量开销 = **0 次**。
4. **性能场景与量具**：复用官方登记场景 `tests/perf/scenarios/onboarding-connect-open.json`（`pnpm run perf:scenarios -- --id onboarding-connect-open --out docs/evidence/2026-11-24-t5-onboarding-s7a/perf-onboarding-connect-open.json`），随仓提交 5 轮真机实测原始 JSON 核验满足预算。

## 8 真实条件

- [x] 中文界面（`zh-CN`）：真 Electron 窗口实测 `O1a-canvas`（含悬停提示与下拉空态）、`O1b-library`、`O1c-agent`（含顶栏入口展开与弹层页脚）、`entry.kept-recovery`、上手清单第 1 步与新手手册。
- [x] 英文界面（`en`）：真 Electron 窗口实测生成框 `Connect` + 悬停提示、项目库横幅自然换行、Agent 指路卡与英文手册零 `Agnes` 残留。
- [x] 暗色模式（`dark`）：真 Electron 窗口实测 `O1a-canvas`、`O1b-library`、`O1c-agent` 暗色对比度与边框 token。
- [x] 最小 / 窄窗口（`1024×700` / `1100×690`）：真 Electron 窗口实测项目库横幅不挤竖条、Agent 窄面板（`320px`）指路卡不横向溢出。
- [x] 草稿保活与老用户自愈：真 Electron 实测画布输入提示词 → 点「连接模型」进大页 → `Esc` 返回后提示词一字不差保留；已配 Key 禁用文本模型一键启用恢复。
- [ ] Windows 真机窗口控件区：`unverified`（当前在 macOS 实测）。
- [ ] 真付费线上模型调用：`unverified`（本切片为入口指路与文案统一，零计费请求）。

## 拍板图清单

- 清单路径：`docs/design/boards/2026-11-07-onboarding/Onboarding.board.json`
- 本切片翻转为 `implemented`（7 项 `S7a` 元素，全部绑定 `tests/ux/t5-onboarding-s7a.walk.mjs` 断言）：
  1. `entry.composer-connect`（`board:Onboarding/entry.composer-connect`）
  2. `entry.persona-setup`（`board:Onboarding/entry.persona-setup`）
  3. `entry.library-banner`（`board:Onboarding/entry.library-banner`）
  4. `entry.agent-pointer`（`board:Onboarding/entry.agent-pointer`）
  5. `entry.picker-empty`（`board:Onboarding/entry.picker-empty`）
  6. `entry.copy-unify`（`board:Onboarding/entry.copy-unify`）
  7. `entry.kept-recovery`（`board:Onboarding/entry.kept-recovery`）
- 保持 `missing` 不动（严格遵守切片边界）：`S6` 全部 13 个元素（`depart.key-input`、`wait.banner`、`wait.return-line`、`return.check-rows`、`return.back`、`topup.card`、`error.key-invalid`、`error.key-format`、`error.no-balance`、`error.offline`、`error.site-blocked`、`error.keychain`、`error.legacy-copy`）及 `onb.drop.preset-count`。

## ★9 验收与回滚

- **独立验收方式**：由非 `t5-onboarding-s7a-impl` 的独立验收线在干净工作树运行：
  1. `./node_modules/.bin/vitest run --maxWorkers=2 src/ui/onboarding/onboardingS7aEntries.test.tsx src/ui/onboarding/onboardingModelAvailability.test.ts src/ui/onboarding/ApimartConnectPage.test.tsx electron/capabilityCore/modelOnboarding/noGenericContract.test.ts`
  2. `pnpm run check:board-parity && pnpm run check:tokens && pnpm run check:controls && pnpm run check:icon-semantics && pnpm run check:i18n && pnpm run check:walkthroughs && pnpm run check:perf-scenarios && node scripts/check-design-lab.mjs --mirrors-only`
  3. 真 Electron 走查 `node tests/ux/t5-onboarding-s7a.walk.mjs` 复核 7 项 `board:Onboarding/entry.*` 断言、草稿往返保活与 `docs/evidence/2026-11-24-t5-onboarding-s7a/` 对照截图。
- **动手前写全的验收清单与反例**：
  1. **反例 C1（生成框未连模型仍画灰圆钮或丢草稿）**：当 `modelOptions` 为空且非 `loading` 时，若右端仍渲染禁用的圆形 `↑` 按钮而非可点的「连接模型」主按钮，或点去大页返回后提示词草稿丢失，单测与 `board:Onboarding/entry.composer-connect` 立即翻红。
  2. **反例 C2（模型框空态死胡同或旧词残留）**：点击生成框左端「未连模型」胶囊展开下拉时，若不出现「还没连模型 · 连接模型」或点击后未触发 `openApimartConnect()`，单测与 `board:Onboarding/entry.picker-empty` 立即翻红。
  3. **反例 C3（项目库已有项目横幅误扰老用户或留旧『分别配置』文案）**：已有任一可用生成/文本模型连接时，若已有项目的项目库仍显示 `data-model-banner`，或未连模型时文案仍含「分别配置」，单测与 `board:Onboarding/entry.library-banner` 立即翻红。
  4. **反例 C4（Agent 面板内嵌配置表单或丢掉一键自愈）**：当 `hasTextModel === false` 时，若 Agent 对话流出现 `<input>` 表单（违反「Agent 只指路」），或当存在已配 Key 禁用文本模型时不出现「启用 {{model}}」按钮，单测与 `board:Onboarding/entry.agent-pointer` / `entry.kept-recovery` 立即翻红。
  5. **反例 C5（手册/运行时旧词复发）**：若 `handbookContent.ts`（中/英）出现 `Agnes` / `免费网关` / `无限期免费`，或 `runtime.ts` 出现 `系统模型管理`，单测与 `board:Onboarding/entry.copy-unify` 立即翻红。
  6. **反例 C6（`F-D` `no_generic_contract` 误引回内置模板）**：若 `noGenericContractFailure` 或 `adapterFailureAdvice` 对 `no_generic_contract` 返回 `openai-compatible` 建议或非 `selfConnect` 动作，`noGenericContract.test.ts` 与 `onboardingS7aEntries.test.tsx` 立即翻红。
- **回滚方案**：纯渲染层入口指路、文案与清单状态更新，零磁盘存档或钥匙串格式变更；单 commit `git revert` 即可完整回退至 Slice 1 状态。

### 功能分类

- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 数据格式
- [x] 新增功能 / 性能
