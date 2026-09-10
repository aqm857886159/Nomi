# 2026-09-10 用户走查反馈分诊（17 条）

> 来源：2026-09-10 用户真机走查（5 张截图 + 17 条文字反馈）。
> 本文只做分诊：现象 → 代码级根因（file:line 已实核）→ 修法 → 量级 → 批次建议。
> 动手前待用户拍板批次。分支：从最新 origin/main 新建 `task/ux-feedback-20260910`。

## 总览：六个主题

| 主题 | 条目 | 性质 |
|---|---|---|
| T1 Agent 面板（聊天框） | #6 上下文、#7 分段/按钮漂移/popover、#5 skill、#4 生成前确认 | 缺功能 + 交互缺陷 |
| T2 画布节点交互 | #10 浮框漂移、#12 底部过挤、#11 ×N 占位、#5 加号遮挡、#16 文本节点 | 交互缺陷 + 整合 |
| T3 画布性能与数据链路 | #8 框选卡顿、#10 draft 不对应 | 性能 + 数据错位 |
| T4 时间轴与布局 | #2 缩放/遮挡、#13 宽度漂移、#14 拉环、#3 空间浪费 | 布局缺陷 |
| T5 模型接入（apimart） | #4 key→模型列表、验证失败 | 回归（被诚实门拦死） |
| T6 素材与语言 | #9 @/拖拽、#17 资产交互、#1 英文提示词 | 缺功能 + 约定 |

---

## T1 Agent 面板

宿主：`src/workbench/ai/ProjectAgentResidentShell.tsx`；composer：`src/workbench/ai/v4/AgentPanelV4Composer.tsx`；转录：`src/workbench/ai/lane/laneViewModel.ts`。

### 1.1 输入框不自动长高（反馈 #7 前半）
- 根因：`AgentPanelV4Composer.tsx:126-132` 高度 = 硬换行数 ×20px，只数 `\n` 不测软换行；长句 wrap 仍算 1 行，内部滚动。
- 修法：改 scrollHeight 自适应（`el.style.height='auto'; height=el.scrollHeight` + max 封顶），标准做法。
- 量级：S。

### 1.2 发送/模式按钮漂移（反馈 #7）
- 根因：`AgentPanelV4Composer.tsx:209-285` 底栏左聚拢 flex、无 `ml-auto` 右锚定；模型钮 `maxWidth:164` 可收缩，模型名长度变化时整簇平移。
- 修法：底栏 `justify-between`，左簇（+/模型）/右簇（模式+发送）分组锚定；模型钮固定宽或截断。
- 量级：S。

### 1.3 popover 点外部不关闭（反馈 #7）
- 根因：手写 popover（`ProjectAgentResidentShell.tsx:98,374-379,458`），只有 Escape + 原按钮 toggle 两条关闭路径，从未实现 outside-click。
- 修法：加 document pointerdown 监听（ref contains 判断）或迁 Radix Popover（注意 framework-boundary 门岗）。
- 量级：S。

### 1.4 一条回复拆成多段气泡（反馈 #7）
- 根因：`laneViewModel.ts:259-263` 每段 `assistant-text` part 各推一个独立气泡；`agentPanelV4Collapse.ts:111` 只折叠 tool/thinking，不合并连续 assistant 文本；`AgentPanelV4Panel.tsx:270` gap-2.5 拉开间距。
- 修法：转录视图层合并「同一回合内被 tool part 分隔的 assistant 文本」为同一气泡（分隔回合仍以 user 消息为界）；保留 tool 行在段间的展示。
- 量级：M。

### 1.5 Skill 不可见 + 只能单选（反馈 #6）
- 根因：skillKey 确实随消息发出（`useAgentPanelV4Actions.ts:160`），但 `laneViewModel.ts:255-257` 用户气泡不带 chip、回复流无「已加载技能」凭据 → 用户以为没用。单选是 store 单值（`workbenchStore.ts:130` `creationActiveSkill:{key,name}|null`）+ `:334` 提示词互斥清空。
- 修法：① 用户气泡尾部渲染 skill chip（数据已随行，只差展示）；② 发送后回复头部加「已使用技能：X」凭据行；③ 多选改 store 数组 + 系统提示拼接多技能（涉及互斥语义重设计）。
- 量级：①② S；③ M（需先确认产品语义：技能互斥是否本意）。

### 1.6 生成前未确认、默认模型未选中（反馈 #7 权限）
- 根因：`agentPanelV4Types.ts:217-227` 默认档 `safe-auto`；`electron/shared/agentLane/laneApproval.ts:95-125` 预检里 `capabilityMayReuseSafeApproval` 命中会话级 grant 即 auto-granted 不弹卡；图/视频默认模型可为空='自动选'（`agentPanelV4ModelRows.ts:93-117`），agent 自选模型无提示。
- 修法：① 生成类工具（花钱）从「可复用安全审批」白名单剔除，每次确认；② 「自动选模型」时确认卡必须显示实际将用的模型再放行；③ 排查用户是否曾点「本会话不再问」导致整会话放行。
- 量级：M。**需用户拍板**：默认档是否改回「每次生成必确认」。

---

## T2 画布节点交互

### 2.1 节点下浮框漂移/截断/参数挤（反馈 #10）
- 根因：`nodes/useComposerViewportPlacement.ts:28-93` 用 ResizeObserver+MutationObserver 全场监听 + 障碍避让算法，任何布局变化都重定位 → 来回漂移；宽度不保证不出视口；底栏单行挤（`NodeGenerationComposer.tsx:404-435`）。
- 修法：锚定策略改为「跟随节点 rect，clamp 在视口内」，去掉障碍避让重定位（只做翻转 above/below）；参数区换行分组（时间/运镜/优化三组）。
- 量级：M。

### 2.2 节点底部按钮整合（反馈 #12）
- 现状：`NodeFloatingToolbar.tsx` / `NodeParameterControls.tsx` / `NodeGenerationComposer.tsx:417-419`（运镜在 composer 底栏）。
- 修法（按用户方案）：底部只留 模型+×N+生成主链路 icon 化（hover title 已有），「运镜」「更多」收进右上角浮条；沿用现有 icon+title 结构改组装。
- 量级：M。**需先出样张**（P5/R8）。

### 2.3 视频节点后「几个图片」占位（反馈 #11）
- 根因：`NodeResultStack.tsx:337-339` → `CardStackPeeks.tsx:36-58` 是**版本历史堆叠**（versionCount）伪卡片，图片视频同款，与「生成 ×N」无关，造成误解。
- 修法：peek 卡按节点媒体类型用对应图标/缩略；「生成几个」选择器已有通用件（`NodeGenerationComposer.tsx:423-435` GENERATION_VARIANT_COUNTS），统一为 ×1/×2/×4 且按执行类（图/视频/音频）过滤。
- 量级：S-M。

### 2.4 左缘工具条「+」hover 遮挡（反馈 #5）
- 根因：`CanvasToolbar.tsx:309` 容器 z-[8]、更多菜单 z-[9]；节点 composer z-[8]、浮条 z-[12]（`NodeFloatingToolbar.tsx:23`）→ 后挂载节点/composer 盖住菜单；且 hover 菜单无 hit-area 缓冲，指针穿缝隙即关。
- 修法：更多菜单提升 z 到浮条之上（z-[13]+），加 8px hit-area 缓冲带。
- 量级：S。

### 2.5 文本节点收进加号（反馈 #16）
- 根因：`canvasToolbarModel.ts:60` `{id:'text', placement:'more'}`，一行改回。
- 修法：placement 改 `'resident'`。
- 量级：XS。

---

## T3 画布性能与数据链路

### 3.1 框选卡顿（反馈 #8）
- 根因：React Flow 框选（`GenerationCanvasReactFlowViewport.tsx:188-198`）拖框过程每次 selection change 同步全量进 Zustand（`GenerationCanvasReactFlow.tsx:457-491`）→ 全部订阅组件重渲；`onlyRenderVisibleElements` 未开。
- 修法：框选过程用本地预选高亮、松手才 commit 到 store；开 `onlyRenderVisibleElements`；节点组件 memo 化核对。
- 量级：M（需 Playwright 实测前后帧率）。

### 3.2 draft 不在画布 / 参数框不对应（反馈 #10 后半）
- 根因：agent 产 draft 是 storyboard designs（`status:'draft', committed:false`，`agent/storyboardAnchorPolicy.ts:54`），未物化故画布无节点——这是**设计现状**但用户完全不可见；Tasks 面板 draft 卡的模型/提示词取 run 行快照（`taskCenterProjection.ts`）而非实际节点 meta，agent 重试后错位。
- 修法：① draft 卡加「在画布上的落点预览」或点击直接物化为可见节点；② 卡参数改读实际执行节点的 meta 快照，并在 agent 重试时重绑定。
- 量级：M。**需用户拍板**：draft 点击后是「物化上画布」还是「浮层预览」。

---

## T4 时间轴与布局

### 4.1 时间轴不能缩 + 工具条遮挡（反馈 #2）
- 根因：工具条 `TimelinePanel.tsx:343-347` 是 `absolute top right z-[8]` 浮层，标尺无预留行 → 直接盖内容；高度钳制 140–300（`workbenchStore.ts:61-72`），面板内无折叠按钮（`:75,81` onCollapse 被弃用），折叠只能靠画布底部把手。
- 修法：① 工具条从浮层改为独立头部行（参与布局不重叠）；② 恢复面板内折叠按钮，高度下限放开（折叠到 header-only）。
- 量级：M。

### 4.2 时间轴宽度随 agent 面板漂移（反馈 #13）
- 根因：`GenerationWorkspace.tsx:61,80-81,128` 时间轴 `col-span-full` 横跨 agent 列；agent 列宽用 framer-motion 弹簧动画改 grid，时间轴跟着动并盖画布。
- 修法：时间轴只占画布列（span 改为画布列），agent 面板列独立。
- 量级：S。

### 4.3 左右拉环不可见（反馈 #14）
- 根因：拉环**已实现**（`AssistantPane.tsx:25-38`）但视觉只有 0.5px 发丝线，generation 模式下几乎不可见 → 用户视为没做。
- 修法：做成可见拉环造型（把手柄/加宽热区 + hover 高亮），符合拖拽 affordance。
- 量级：S。

### 4.4 顶部/左轨空间浪费（反馈 #3）
- 根因：`GenerationWorkspace.tsx:38,54` agent 面板常驻（min300/max600，`assistantWidthBounds.ts:17-34`）+ 左轨 60px 恒占，画布/预览被压缩。
- 修法：① agent 面板可折叠到 icon 条；② 左轨 hover 展开式（默认收窄）；③ 画布区 min 宽度底线重算。
- 量级：M。**需先出样张**（P5/R8）。

---

## T5 模型接入（apimart）— 回归

### 5.1 填 key 后模型全部消失（反馈 #4 前半）
- 根因链（已实核）：apimart 种子本是 `credentialMode:'direct-key'`（`electron/catalog/apimartVendor.ts:28`、`builtinVendorSeeds.ts:89-103`，设计 = 填 key 即解锁全部预置模型）；但 `rendererCatalogMutation.ts:132-145` 强制 `enabled:false` + `verificationPending`，注释明言「key 永不晋升 vendor，只有 certification 能翻转」；`credentialPublication.ts:13-18` 凭据 disabled 时把 vendor 整体 de-publish → `modelCatalogCache.ts:120-126` 把该家模型全部从选择器与 agent 可用清单剔除。**直连实际可用，目录却隐藏** —— 与用户描述完全吻合。
- 修法：给 direct-key 供应商一条「key 落盘即发布 curated 模型」通路（不要求 certification），保留 certification 作为可选的额外信任层；`generationProviderBootstrap.ts:106-112` 同步放行。
- 量级：M（动主进程目录逻辑，需 contracts + 单测）。

### 5.2 验证转圈后全失败（反馈 #4）
- 根因：`validateCandidateCredential.ts:12-29` 存 key 前强制 `GET /v1/models` 探测（12s 超时），而 apimart 对该端点回 401（`vendorBaseFallback.ts:153` 已有注释确认）→ 转圈=12s 超时，全失败=认证运行也用错误判据。**用 /v1/models 可达性当 key 有效性判据，对 apimart 不成立**。
- 修法：per-vendor 验证策略：apimart 改用一次最小成本的真实生成探测（或跳过预验证、首用失败再报）；验证文案如实报错。
- 量级：M。
- 附注：「通过 MCP 链接测试」属另一条线（`mcpVerify.ts:60` 只管 CLI 握手），与 key 直连验证解耦；本轮先修 direct-key 通路。

---

## T6 素材与语言

### 6.1 输入 @ 无反应 + 素材无法拖入（反馈 #9 前半）
- 根因：V4 composer 是纯 `<textarea>`（`AgentPanelV4Composer.tsx:177-201`），**从未接 @ mention**，占位文案先行于功能（文案承诺来自 `i18n/locales/agentPanelV4.ts:374`）；mention 能力只存在于 Tiptap 的 PromptEditor（`assets/PromptEditor.tsx:94-215` + `AssetMentionNode.tsx`）。
- 修法：两条路——A：composer 换 Tiptap（复用现成 mention，但引入编辑器依赖到 agent 面板）；B：textarea 上自建 @ 触发浮层（轻但不统一）。**需用户拍板**（R3 对比表：A 统一性最好、改动大；B 快、维护两套）。
- 拖拽：节点 drop 只认 `'Files'` 与 `WORKSPACE_FILE_DRAG_MIME`，不认 `ASSET_LIBRARY_DRAG_MIME`（`useNodeAssetDrop.ts:49-50` vs `assetLibraryDrag.ts:7`）→ 加 MIME + PromptEditor/composer 加 drop 处理。
- 量级：A=M，B=S；拖拽=S。

### 6.2 资产库与剪辑区交互消失（反馈 #17）
- 现状：素材→时间轴 drop 通道**存在**（`TimelineTrack.tsx:311` → `addAssetToTimeline.ts:109-123`，画布/项目素材同通道）；用户感知「没了」大概因为①资产库面板入口状态、②拖拽 MIME 不通（同 6.1）、③反馈 #13 时间轴遮挡让拖拽目标不可达。需真机复测确认到底是哪环断了。
- 量级：S（修 6.1 + 复测走查）。

### 6.3 提示词出英文（反馈 #1）
- 根因：`electron/harness/context/agentContext.ts:53-70` 语言规则跟 `getDesktopLocale()` 走，判成 en 时系统提示明确要求「Respond in English…applies to every prompt」；`canvasSystemPrompt.ts:17` 只说「与用户同语言」，约束弱 → locale 误判/英文环境即输出英文提示词。
- 修法：提示词（要送进生成模型的 prompt）单独加硬约定「提示词一律中文」，与回复语言解耦；系统提示加反例约束。
- 量级：S。

---

## 批次建议（待拍板）

| 批次 | 内容 | 理由 |
|---|---|---|
| B1 立即可修（S/XS，一轮 PR） | 1.1 1.2 1.3 2.4 2.5 4.2 4.3 6.3 | 单点、根因清晰、低风险 |
| B2 模型接入修复（M） | 5.1 5.2 | 用户明确「其实已经可用但看不到」，阻塞生成主线 |
| B3 画布体验（M，需先出样张） | 2.1 2.2 2.3 3.1 | 2.2/4.4 涉 UI 重组，先 mockup 拍板 |
| B4 Agent 面板深改（M） | 1.4 1.5①② 1.6 3.2 | 1.6 需拍板默认权限档 |
| B5 素材链路（M） | 6.1 6.2（含 @ 方案 A/B 拍板） | |
| B6 布局重组（M，需样张） | 4.1 4.4 1.5③ | |

## 已拍板（2026-09-10 用户确认）
1. 生成确认（1.6）：保留自动档，但「agent 自动选模型」时确认卡必须显示实际将用的模型才放行；手动指定过模型不重复打扰。
2. @ 引用（6.1）：composer 换 Tiptap 统一（复用 PromptEditor mention，B5 批次）。
3. draft 交互（3.2）：点击 draft 卡直接物化上画布（B4 批次）。
4. 批次：B1（单点小修）+ B2（apimart 模型接入）先行；B3/B6 样张后跟进。

## 本轮执行记录（B1+B2）
- 分支：`task/ux-feedback-20260910`（从最新 origin/main）。
- 状态：进行中。

## 验收门（全批次通用）
- contracts 全门 + focused tests；涉及画布/时间轴/agent 面板的走 J1-J5 真实旅程走查（R13）+ 与本表逐项对账（P3）；模型接入改动跑真实 apimart key 端到端验证（填 key → 列表出现 → agent 可选 → 真实生成一张）。
