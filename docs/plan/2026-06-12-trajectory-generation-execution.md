# 生成轨迹图（ViMax 化）执行方案

日期：2026-06-12
前置：`docs/plan/2026-06-12-vimax-trajectory-into-agent.md`（方向已拍板：A 为主，B 为可选边语义非默认；用户确认三能力可行性后要求出完整方案）
状态：方案定稿，待用户过目后实施

---

## 1. 通俗讲解：做完之后是什么体验

今天你对 Agent 说「把这个故事做成视频」，它给你一排镜头图节点——然后每一步都要你自己想：角色长得一致吗？图怎么变成视频？镜头怎么衔接？

做完这个方案，同一句话得到的是**一张完整的生成轨迹**：

```
[角色卡:男主]──character_ref──→[镜头1关键帧]──first_frame──→[镜头1视频]
[角色卡:女主]──character_ref──→[镜头2关键帧]──first_frame──→[镜头2视频]
[场景卡:厨房]──style_ref────→[镜头1/2关键帧]
```

- 男主出现在 5 个镜头里 → 只有**一张**男主定妆卡，5 个关键帧都引用它（一致性来源）；
- 点「批量生成」→ 定妆卡先出图（第 1 波，并行）→ 关键帧拿着定妆图出图（第 2 波）→ 视频拿关键帧当首帧出片（第 3 波）——已有的依赖波次调度器自动排程，你全程看得见每一步在画布的哪里；
- 镜头 1→镜头 2 是连续动作？把镜头 1 视频**连一条边**到镜头 2 视频，生成镜头 2 时自动抽镜头 1 的尾帧当首帧（不连就互不影响——B 是可选能力，Agent 只在连续动作时建议，绝不强加）。

## 2. 用户看到的 UI 变化（穷举）

| 位置 | 变化 |
|---|---|
| 画布助手计划卡 | 拆镜头计划从平铺节点列表变为**三层分组**：「参考 N 张 / 关键帧 M 张 / 视频 M 条 · 边 K 条」，每层可展开看提示词/模型/参数；仍是一次「确认全部」 |
| 画布 | 批准后节点按**列分层排布**（参考列→关键帧列→视频列），与画布上已有节点不重叠（顺修审计 bug D） |
| 边 | 新边带语义色/标签（角色参考/风格参考/首帧）；video→video 边显示「尾帧接力」标签 |
| 批量生成 | 无新 UI——现有「按依赖波次调度」自动生效；等待中节点显示「等待参考就绪」（现有语义） |
| 其它 | 无。不动创作区、预览区、模型接入 |

## 3. 技术讲解：现状基建盘点（为什么改动量小）

| 能力 | 现状（file:line） | 结论 |
|---|---|---|
| 依赖图执行（拓扑波次） | `runner/dependencyWaves.ts:2`「无依赖并行(第1波)，有依赖等前置完成」；`run_generation_batch` 已用（`applyCanvasToolCall.ts:164`） | ✅ 直接复用 |
| 边语义 | `runner/generationReferenceResolver.ts:65-89` 已支持 `first_frame/last_frame/style_ref/character_ref/composition_ref` 五种 edge.mode，分别注入对应参考槽 | ✅ 运行时已就绪；**缺口=Agent 计划边不带 mode** |
| 节点 kind | `model/generationNodeKinds.ts`：character→cast、scene→scene 分类映射已有；character/scene `agentCreatable` **已是 true**（registry.ts:83/98，无需改）；keyframe kind `agentCreatable` 缺省 false——**关键帧层统一用 image kind**，不碰 keyframe | ✅ 复用，零开关改动 |
| 原子计划 | c493929：create_canvas_nodes 带 edges 一次批准/落地/对账 | ✅ 直接复用 |
| 抽帧 | 主进程导出链路有 ffmpeg（`electron/export/`） | 复用二进制；**缺口=抽帧 IPC** |
| 计划卡 | `AgentPlanCard` 平铺节点列表 | 缺口=分层渲染 |
| 布局 | `applyCanvasToolCall.ts:18 gridPosition` 纯 index 网格不避让（审计 bug D） | 缺口=分层布局+避让 |

## 4. 范围：六个切片

### T1 边语义进 Agent 工具契约（地基，~0.5 天）
- `electron/ai/canvasTools.ts` + `agentChatV2.ts`：`plannedEdgeSchema` 增可选 `mode: z.enum(['first_frame','last_frame','style_ref','character_ref','composition_ref'])`，描述写明每种语义与适用层间关系。
- `applyCanvasToolCall.ts`：create 携带边/`connect_canvas_edges` 落地时把 mode 写进 store 边。评审核实：store 层 `connectNodes(source,target,mode?)` 与边类型 mode 字段**已就绪**（canvasStoreTypes.ts:49 / generationCanvasTypes.ts:167）；缺的只是 agent 工具层 `generationCanvasTools.connect_nodes`（:38/:76 仅 Pick source/target）的透传——补一个参数。
- `reconcile.ts`：边对账比对 source/target/mode 三元组（mode 缺省视为通配，向后兼容旧轨迹）。
- 单测：带 mode 的边落地/对账回归。

### T2 计划模板升级——Agent 学会「先想轨迹再想镜头」（核心，~1.5 天）
- `generationCanvasAgentClient.ts` system prompt + storyboard skill（`storyboardLauncher.ts` 注入的 STORYBOARD_PLANNER_SKILL，主进程侧 skill 文本）改为四步规划协议：
  1. **识共享元素**：通读全部镜头，列出复用角色/场景（出现 ≥2 次才建卡；一个元素只建一张卡）；
  2. **建参考层**：character/scene kind 节点（落 cast/scene 分类，与定妆链路同类）；
  3. **建关键帧层**：每镜头一个 image 节点，连 `character_ref`（角色卡→关键帧）与 `style_ref`（场景卡→关键帧）边；
  4. **建视频层**：每镜头一个 video 节点，连 `first_frame`（关键帧→视频）边；**video→video 接力边默认不连**，仅当相邻镜头为同场景连续动作时在 summary 里建议并连（用户可删）。
- 提示词派生模板（G4）：关键帧 prompt 含机位/构图/光线；视频 prompt 含运镜/时长/动作——写进 skill 的输出规范。
- 模型分配：参考层/关键帧层用图像模型（含「全能参考」类多图模式），视频层用视频模型——沿用现有「可用模型清单」机制，多参考槽数量按所选模型 archetype 实际能力（清单里已带）。
- kind 约定：参考层 = character/scene（agentCreatable 已开）；**关键帧层 = image kind**（keyframe kind agentCreatable 缺省 false，不启用、不碰）。
- **守不变量**：单层拆镜（用户只要镜头图时）仍可用——规划协议按用户意图分支，不强制三层。

### T3 计划卡分层渲染（~0.5 天 + mockup 前置）
- **R8 前置**：计划卡三层分组 + 边语义标签是用户可见新 UI——先出 HTML mockup（含边语义色/标签的 token 选型）给用户拍板，再实现并对账；
- `agentPlanSummary.ts`：按 kind 分组（参考/关键帧/视频）+ 边按 mode 计数；
- `AgentPlanCard.tsx`：三层分组展示（沿用现有 chip/prompt 编辑能力），头部摘要「N 参考 · M 镜头 · K 边」；**接力边（video→video）单独成行、带勾选框**——用户可在批准前直接勾掉某条接力边（真实用户评审：「可删」必须有看得见的删除入口）。

### T4 轨迹分层布局 + 避让（~0.5 天，顺修审计 bug D）
- `applyCanvasToolCall.ts`：`gridPosition` 升级为 `trajectoryLayout(nodes, existingNodes)`——按层分列，**层由纯函数推导（评审必改：来源显式定义）**：`layer(node) = kind∈{character,scene} → 0（参考列）；kind=image → 1（关键帧列）；kind=video → 2（视频列）`，与边方向交叉校验（出现 video→image 等逆层边时按 kind 为准）；无可推导层（如纯文本节点混入）退回现有网格。原点取已有节点包围盒右侧/下方空区，AABB 不相交；
- 单测：与既有节点不重叠、三层列序正确、纯镜头计划退回网格。

### T5 尾帧接力适配器（B，可选边语义，~1.5 天）
- 语义定义：**video 源节点 + `first_frame` 边 = 用源视频「尾帧」作为目标视频首帧**（接力场景恒为尾帧，无需新 mode；文档+边标签写明）。
- **评审必改 ①（现状行为变更要显式封堵）**：今天 video 源走 first_frame 边时 `findNodeResultUrl`（resolver:19-31）会拿**视频 URL 或 thumbnailUrl（≈首帧封面）静默注入** firstFrameUrl——这是用封面冒充尾帧。T5 必须让 resolver 按**源节点 kind 分流**：video 源 → 返回待抽帧占位（不再回退 thumbnail）；image 源 → 现行为不变。封堵写回归测试。
- **评审必改 ②（URL 白名单）**：`asUrl`（resolver:13-17）只放行 http(s)/`/`/blob:，会丢弃 `nomi-local://`——白名单补上该协议（全仓 grep 同型校验点一并核）。
- **评审必改 ③（远程视频本地化）**：video 结果可能是 vendor 远程 http URL——抽帧 IPC 输入前先走**既有资产本地化管道**（生成结果落盘 assets 的同一条路）拿本地路径；纯远程且本地化失败 → 如实报错。
- 主进程：`nomi:media:extract-frame` IPC——ffmpeg 二进制复用打包的 `@ffmpeg-installer`（`ffmpegRunner.ts:184-207` `resolveFfmpegPath` 已导出）；抽帧落 `assets/frames/<hash>.png`，返回 `nomi-local://` URL；幂等（同视频同位命中缓存）。
- 渲染层：`generationRunController` 提交生成前 await 抽帧把占位换成真实 URL；源视频无结果 → 现有「参考未就绪」拦截（依赖波次天然排序，评审核实 dependencyWaves 对所有边不分 mode 分波 ✅）。
- 失败路径：抽帧/本地化失败 → 节点 error 走 `classifyGenerationError` 如实显示，不静默回退纯文生视频。
- 单测：resolver 按 kind 分流/封 thumbnail 回退/nomi-local 放行；IPC 幂等。

### T6 验收与评测锁（~1.5 天）
- eval 新 case：固定 3 镜头双角色故事 → 断言计划含「2 角色卡（去重）+3 关键帧 +3 视频 + 正确 mode 边」。评审核实：eval 入口现成（`evals/datasets/storyboard.mjs` + `eval:run`），但 **expect 词表需扩**（`grading.mjs` 现仅 createdShots/kind/minChainEdges/category，要加 角色卡去重/边 mode 断言词）——工作量已计入本切片；
- 真实 E2E（接入即验证）：3 镜头轨迹一键批准 → 批量生成 → 三波全绿 → 视频出片（花真实额度，**额度预估在 T5 完成时即向用户报备**，不等到最后）；
- design-fidelity：计划卡分层 DOM 断言 + 轨迹布局不重叠几何断言；
- 五门全过。

## 5. 不动项

- `dependencyWaves` 调度器、提议事务/对账/整笔撤销机制（S6 体系）——只消费不改；
- 手动建节点/连边/单节点生成的全部现有行为；
- 定妆链路（立角色卡）入口——T2 产出的角色卡与其同类同分类，不做第二套；
- 模型接入/档案/mapping 体系；
- 不引入任何新第三方库（ffmpeg 用导出链路现有二进制）。

## 6. 回滚策略

- T2 计划模板是纯 prompt/skill 文本——回退 = 还原文本，零数据迁移；
- T1 边 mode 为可选字段——旧轨迹/不带 mode 的边语义不变（对账通配兼容）；
- T5 由「video 源 + first_frame 边」存在性驱动——没人连这种边 = 零行为变化；IPC 独立模块可整体摘除；
- T3/T4 纯渲染层，逐个 commit 可独立 revert。

## 7. 验收门

1. 五门（filesize/lint/typecheck/test/build）全绿；
2. 新增单测：边 mode 落地/对账、trajectoryLayout 避让、抽帧 resolver/IPC、计划分组（≥10 个断言）；
3. eval：共享元素识别 case 通过；
4. 真实 E2E：3 镜头轨迹全链路出片（按接入即验证纪律，主进程埋点取证）；
5. design-fidelity：计划卡分层 + 布局不重叠断言绿；
6. R13 体感走查：J1 主链路用轨迹规划重走一遍，截图人眼对账。

## 8. 风险与边界（如实交代）

| 风险 | 应对 |
|---|---|
| LLM 识别共享元素漏/误（同名异人、代词指代） | eval case 锁底线；计划卡是人审关卡——错了改完再批 |
| 用户模型参考槽不足（如不支持多图参考） | 模型清单已带 archetype 能力，T2 让 agent 按能力降级（无多参考 → 只连角色卡一条边）；不支持 i2v 的模型按现有「需要首帧」拦截 |
| 一致性效果依赖模型能力（论文用 Veo3.1 级） | 工程只保证「参考确实喂进去了」（对账可见）；效果按接入即验证实测，不承诺超出模型上限 |
| 三层轨迹节点数 ×3，画布密度上升 | 分层列布局 + 现有分类侧栏（参考卡归 cast/scene 分类，不挤分镜区） |
| 真实 E2E 花额度 | T6 执行前明示预估并征得确认 |

## 9. 二期（本期不做）

- **过渡视频锚定空间**（同场景多机位）：复用 T5 抽帧适配器 + 新计划模式（机位 A 图 → 过渡视频 → 抽帧 → 机位 B 锚），等一期真实效果数据再立项；
- best-of-k VLM 质检（3 倍额度，需拍板）；
- 层级故事分解 + RAG（百镜头长片场景才需要）。

## 10. 工作量与顺序

T1(0.5) → T2(1.5) → T3(0.5+mockup) → T4(0.5) → T5(1.5) → T6(1.5)，合计 ~6 天；T1-T4 与 T5 无文件冲突可并行。每切片独立 commit + push（R11）。

## 10b. 六角色评审回填（2026-06-12）

已评审并回填 5 项必改：T5 的 thumbnail 静默回退封堵/`asUrl` 放行 nomi-local/远程视频本地化、T4 层推导规则显式化、T3 前置 mockup + 接力边勾选入口、T6 评测词表扩展工作量。两处方案断言修正：character/scene agentCreatable 已为 true（非「待打开」）；关键帧层定为 image kind（keyframe kind 不启用）。store 边 mode 字段已就绪（canvasStoreTypes.ts:49），T1 仅补工具层透传。

## 11. 开源代码细读回填（占位）

ViMax repo（HKUDS/ViMax）代码级结论由后台研究 agent 回填：依赖图数据结构/排程实现、抽帧与过渡视频函数、镜头 spec 字段表、可借鉴 prompt 模板。回填后若与本方案冲突，以「不动 Nomi 内核」为先，只吸收 prompt/字段设计。
