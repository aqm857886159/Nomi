# 分镜方案用户审计（2026-10-05）

> 审计线 A-sb。只审计、不改产品代码、不花钱。基线：`origin/main` 含 #1026（分镜画幅落地 / 合并参数修复），在其上重新构建后取证。
> 取证脚本：`tests/ux/audit-storyboard.walk.mjs`（零额度回环夹具、出网闸开着、窗口全程在屏幕外）。
> 复现：`pnpm run build && NOMI_AUDIT_LOCALE=zh-CN node tests/ux/audit-storyboard.walk.mjs`（en 同理）。产出 `tests/ux/shots/audit-storyboard/<zh-CN|en>/*.png` + `observations.json`（实测数字都在里面）。
> 中英各走一遍主路径（1280×800），再各走一次最小窗口 1100×690（`30-` 到 `33-` 号截图）。每张截图都自己看过。
> 本报告里的「截图」默认指 `tests/ux/shots/audit-storyboard/zh-CN/`，英文轨同名在 `en/`。（截图目录被 .gitignore 排除、不入库；跑上面的走查脚本即可原样重新生成。）

## 0. 先读这个

**一句话**：「跨镜头要一致的」这块（参考卡 / 锚）今天是**半个功能**：它能列、能改、能单独生成，但**没有任何东西把它的结果用到镜头上**，也没有任何东西规定「先它、后镜头」。用户反馈的 11 条里，有 6 条是这一个底层缺口的不同症状（U2、U3、U4、U8、U10、U11 中的一部分）。另外两块独立的问题：表格交互（浮条结构、勾选框语义、移除入口、菜单被裁）和 Agent 起草协议（镜号被锚占掉、id 撞名、「下一轮再补」诱导新建第二份）。

**为什么会这样（不是 bug 而是 09-30 的有意删除）**：`docs/plan/2026-09-30-storyboard-outbound-owner.md` 用户拍板「一镜发出去的 = 这一行写的提示词 + 这一行上看得见的参考图，别的什么都不加」，同 commit 删了按 `anchorIds` 自动连图 / 追加文字。删得对（防「巨龙变人物」）；但**替代物没补**：v6 合同 §2.8「拆分镜时把锚自动填进该镜的参考槽（可见、可改的普通绑定）」从来没实现过。结果是锚的图出来了，却到不了任何一镜。`storyboardPlan.ts:404` 的注释原话：「定妆卡不再喂给任何镜」。这条与用户 10-05 的「上面的参考图生成好之后，下面的镜头应该自动引用它」直接相反，与 v6 合同 §2.8 / §2.10(b) 一致——所以修法不违背 09-30 的拍板，只要新增的绑定是**行上看得见的**。

## 1. 用户 10-05 原话 11 条逐条结论

> 状态栏说明：问题类 = 功能用不了 / 选不到参数 / 心智不一致 / 设计遗漏 / 使用逻辑错；严重度 S1 阻断创作、S2 明显错且常撞、S3 小毛病。

### U1 Agent 做分镜方案常做错：往左边建好几个方案、数量不对、最后才合到一个

| 项 | 内容 |
|---|---|
| 用户以为会怎样 | 一句话 → 一份方案，镜数是我说的数 |
| 实际怎样 | 零额度脚本化大脑（只脚本化模型，宿主 / 工具 / 渲染层全是真的）复现了三件事，**都是宿主行为，不依赖模型是否聪明**：①仅参考卡的草稿，宿主回执里写「镜头请在**下一次** draft_shots 调用里补」，模型照做第二次不带 operationId → 左栏多一份（`29-sidebar-several-plans-for-one-request.png`：一次请求 → 「阿哲」「开场」两份，加上先前的共 4 份）。②Agent 建的方案 2 镜，行号从 **03、04** 起，标题栏却写「2 镜」（`28-agent-plan-rows-numbered-from-3.png`，en 同）。③模型对「改第 1 镜」自然写 `shot-1`，实际改到的是**第一张角色参考卡的描述**（`observations.json` P10：afterPatchShot1.anchors[0].description 被改，镜头没动）。 |
| 复现步骤 | 跑 walk 的 P10；或自己：创作页让 Agent 起草「先立角色再排镜头」，看左栏方案数与行号 |
| 证据 | `28-`、`29-` 截图；`observations.json` → P10-agent-drafts.toolResult1（模型看到的 id：锚是 `shot-1`、`shot-2`，真正的镜是 `shot-3`、`shot-4`） |
| 代码 | 新建永远发新 id：`electron/capabilityCore/mcpGenerationTools.ts:472`（`op-<uuid>`）；诱导第二次新建的提示：同文件 `:497`；镜号 = 在锚和镜混排数组里的位置：`electron/capabilityCore/mcpGenerationMultiShot.ts:457`（`index+1`）；Agent 面对的是一个动词做五件事：`electron/shared/agentCapabilities/verbs/writeVerbs.ts:194`（useWhen 只说 shotId，不说 operationId）；SKILL 的镜数规则「短故事 6–10、宁可多切」与用户点名镜数打架（`skills/workbench-storyboard-planner/SKILL.md` 第 1 步）；左栏方案的落点 `src/workbench/creation/storyboard/agentStoryboardDesign.ts:30-62` |
| 问题类 | 使用逻辑错（S1，Agent 线最痛的那条）+ 设计遗漏 |
| 根因判断 | **同一个根因**：「方案」的创建 / 修订协议是个两步仪式（先建、再用返回的 id 补），而 id 与镜号的命名空间又把锚和镜混在一起。「多份方案」「数量不对」「改错对象」是这一个协议的三个症状。 |
| 真模型才能复现的部分 | 模型是否会第二次不带 operationId、是否把 2 镜说成 4 个，是概率；**宿主不拦 / 还鼓励**是确定的。没花钱去复现，结论是读码 + 脚本化大脑轨迹。 |
| 修法建议 | 见批 B6：创建时宿主按「这一轮对话 / 这篇文稿」判定是否已有 Agent 方案并复用或回问；镜号只数镜；锚 id 用独立前缀；删掉「下一次 draft_shots」那句提示；SKILL 加「用户点名镜数就按它」。 |

### U2 「跨镜头一致」里的参考卡没有比例选项和其他参数，没按模型做全

| 项 | 内容 |
|---|---|
| 用户以为会怎样 | 参考卡像镜头行一样，选了 GPT Image 2 就能选比例 / 清晰度 / 张数 |
| 实际怎样 | 展开后参考卡底栏只有：类型四枚、载体开关（「参考图 / 仅提示词」）、「参考卡生成模型」。选了 GPT Image 2 之后底栏**一个字不变**（`03-`、`05-`）。同一个模型放在镜头行的「⋯」里有「比例 / 清晰度 / 生成音频 / 返回尾帧」（`08-`）。整片比例也不进参考卡的实际出图（锚节点参数只来自 `anchor.params`，而 `anchor.params` 没有任何界面可写）。 |
| 复现 | 创作页 → 打开方案 → 「跨镜头要一致的」→「全部展开」→ 选模型 |
| 证据 | `03-anchors-expanded.png`、`05-anchor-after-gpt-image-2.png`、`08-shot-more-params-popover.png`；`observations.json` P2（heroBarBefore 与 heroBarAfterGptImage2 逐项相同） |
| 代码 | `src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx:333-400`（底栏 = ANCHOR_KINDS + 载体 + 模型，没有模式 / 参数）；对照 `shotRow/ShotComposerBar.tsx`（镜头行的模式 / 参数 / ⋯）；`src/workbench/generationCanvas/agent/storyboardPlan.ts:235`（锚节点的 `params` 只读 `anchor.params`） |
| 问题类 | 选不到参数（铁律 ⑪ 违反：档案声明了参数，锚这个入口选不到）。S2 |
| 根因判断 | 与 U9 / U11 **不是同一个**：这是「锚行是第二份手写底栏、没复用镜头行的 ComposerBar」。另见 U3 的伴生问题 A2（改了锚的模型，节点不跟着变）。 |
| 修法建议 | 批 B3：锚行直接用镜头行同一个底栏组件（按档案出参数）；锚的写回节点走与镜头同一个投影函数（含模型）。 |

### U3 点「生成剩余」直接去生成视频，和设计不一致（设计顺序是什么？）

| 项 | 内容 |
|---|---|
| 设计顺序 | 分镜表提示行写着「先生成参考卡锁住长相，再生成镜头」（`storyboardEditor.spendHint`，v6 合同 §1 第 2 条同句）。付费卡设计 `docs/plan/2026-09-30-paid-card-per-shot.md` 的原则：「点了的生成、去掉的不生成」，每一项可见可去。 |
| 实际怎样 | 「生成剩余」= 把所有未生成的**镜**一次建节点、一次问钱。2 张没生成的参考卡**不在这一批里**，也不在对话框里；对话框只写「将生成 4 个素材 · 预计约 1 分钟 · 会消耗模型额度」，没有清单、没有种类拆分、没有哪一项可以去掉（`10-generate-remaining-dialog.png`）。批量执行前锚是没有结果的，镜头也不等锚。 |
| 复现 | 打开含未生成参考卡的方案 → 点页脚主按钮 |
| 证据 | `10-generate-remaining-dialog.png`；`observations.json` P5：dialogText；`createdByCancelledBatch` 里有 3 个 video + 1 个 image，`anchorNodesCreated: 0` |
| 代码 | `src/workbench/creation/storyboard/exec/storyboardRowActions.ts:319`（`runStoryboardBatch`：rows 只含镜）；`exec/storyboardRowStatus.ts` 的 `deriveStoryboardBatch`（锚不参与）；对话框文案来自 `generationCommon.batchPlan` + `describeGenerationCost`（`src/workbench/generationCanvas/components/batchPlanPreview.ts:171-181`） |
| 问题类 | 使用逻辑错 + 心智不一致。S1 |
| 根因判断 | 与 U4 同根（锚不被消费，所以也就没有「先后」可言）；对话框无清单是另一件事（与付费卡「逐项」原则不一致，Agent 路用的是逐镜付费卡，表格路用的是无清单对话框）。 |
| 修法建议 | 批 B2：批次 = 阶段（参考卡 → 镜头），对话框列项、可逐项去掉；需出样张。 |

### U4 没有自动引用：参考图生成好后，下面的镜头应该自动引用

| 项 | 内容 |
|---|---|
| 实际怎样 | 「后巷」生成成功（`21-`）后，引用它的镜头参考槽仍是空的；镜头默认模式是「文生视频 · 不吃参考」，连槽都没有（`23-shots-after-anchor-generated-no-auto-reference.png`）。锚条上也没有「被 N 镜引用」（`anchorsListedByAnchorIds` 里明明写着镜 1、2 引用了它）。想引用只能：每一镜 → 切到带参考槽的模式 → 打开槽 → 从「画布」分区里挑那张图（`24-`），3 个锚 × 10 镜 = 30 次。 |
| 复现 | walk P8 |
| 证据 | `21-`、`23-`、`24-`；`observations.json` P8：shot1Bindings 为空、shotRefStates、anchorsListedByAnchorIds |
| 代码 | `src/workbench/generationCanvas/agent/storyboardPlan.ts:404`（单镜落画布「不再顺手建它引用的定妆卡」）、`exec/storyboardRowStatus.ts` 注释「现在没有任何自动连边」；Agent 起草时的绑定只对**已有 referenceUrl** 的锚做（`src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:64`，「AI draft admission only」）；`anchorIds` 无任何作用（09-30 文档第 6 条） |
| 问题类 | 设计遗漏（v6 合同 §2.8 / §2.10(b) 已拍板、从未落地）。S1 |
| 根因判断 | 批 B1 的核心：缺一个「锚出图 → 写进引用它的镜的参考槽（可见绑定）」的单一 owner。 |
| 修法建议 | 见 B1 与「需拍板 D1」。 |

### U5 点开引用弹出的页面「很离谱」：没地方去掉参考图，页面很乱

我把「点开一个引用」在表里能触发的三处都走了，三处都有问题：

| 入口 | 实际 | 证据 |
|---|---|---|
| 点参考槽的缩略图 | 浮层把「已放 N 个」列表、「忽略特征」输入框和素材选择器叠成一个 320px 长条，**浮在下一行的提示词上面**（`13-`）；删除只有 20px 的浅灰垃圾桶（`removeButton`：20×20，颜色 ≈ ink-30）；缩略图本身**没有 ×**（`tileHasInlineRemove: 0`，`14-`）。浮层高度随素材增多往上长，我手动走（素材更多时）它顶到了窗口标题栏（y=8，盖住项目面包屑）。 | `12-`、`13-`、`14-` |
| 双击提示词里的 `@图片1` 引用 | 弹出全屏灯箱，**只有一个「关闭预览」**，没有移除 / 替换 / 这张图在哪一槽（`lightboxControls: ["关闭预览"]`）。单击只是选中芯片。 | `16-chip-double-click-lightbox.png` |
| 在槽里删掉绑定之后 | 提示词里的 `@` 芯片**还在**（从「图片2」变成无名的「参考图」），槽已空——两个事实来源不同步 | `17-binding-removed-chip-remains.png` |

| 项 | 内容 |
|---|---|
| 代码 | `shotRow/ShotReferenceSlotPopover.tsx:69-110`（列表在选择器之上、垃圾桶 `text-nomi-ink-30`）；`shotRow/ShotReferenceZone.tsx` 缩略图按钮只做 toggle 浮层；灯箱 `StoryboardPlanEditor.tsx:724`（`AssetPreviewDialog`，无动作）；芯片与绑定的两个来源：`shotRow/useShotMentionSource.ts` |
| 问题类 | 心智不一致 + 功能用不了（移除找不到）。S1 |
| 根因判断 | 同一个「引用」有四种表示（槽缩略图、浮层列表、提示词 `@` 芯片、灯箱），没有一个统一的「这张引用」对象 / 动作集。是一个批（B4），不是四个。 |
| 修法建议 | 批 B4：一个引用的动作集（查看 / 替换 / 移除 / 忽略特征）统一，缩略图上直接有 ×；灯箱带同一动作集；芯片与绑定单向同步（删一边另一边跟着）。需出样张。 |

### U6 表格交互：点左边的对勾，结果是「跳过」

| 项 | 内容 |
|---|---|
| 实际怎样 | 行首唯一可见的复选框含义是「本次跳过」：勾上后整行变 60% 透明 + 出现「本次跳过」标签（`18-checkbox-means-skip.png`）。aria：「本次跳过镜 2」；页脚「生成剩余」不显示数字，所以勾了之后也看不出少跑了几镜（`footerBefore`/`footerAfter` 相同）。行的真正「选中」是点行（无复选框），选中态没有可见高亮。 |
| 附带的另一个真 bug：选中行后浮条看不见 | 浮条 `sticky bottom-2` 被放在 `overflow-hidden` 的表格容器**里面**，sticky 失效，浮条跟着内容走：选中第 1 行时它在 y=1019（页脚在 730），**滚到最底才看得见**（`19-`、`20-`；`toolbarAtTop.visiblePx: 0`）。这就是账本里的「点击选择后反而隐藏」（PLAN-S2-06）的真实机理。 |
| 代码 | 勾选框：`shotRow/StoryboardShotRow.tsx:238`（`skip.aria`，`i18n skip` 块）；浮条：`StoryboardShotTable.tsx:273`（`overflow-hidden`）、`:453`（浮条是它的子元素）、`StoryboardSelectionToolbar.tsx:57`（`sticky bottom-2`） |
| 问题类 | 心智不一致（勾选框=跳过，S2）；功能用不了（浮条看不见，S1）。两个独立根因。 |
| 修法建议 | 批 B5：浮条移到表格容器外（逻辑修，不用样张）；勾选框改回「选中」，「跳过」收进浮条 / 行菜单（改交互，要样张，见 D3）。 |

### U7 有了缩略图之后删不掉

| 项 | 内容 |
|---|---|
| 实际怎样 | ①镜头已生成后，画面格悬停动作只有「重生成 / 放大 / 锁定 / 用作…」，没有「清除结果」（`25-`，`frameActions`）；行菜单只有插入 / 复制 / 移到场 / 锁定 / 交给 Agent / **删除整镜**（`27-`）。想去掉缩略图只能重生成（再花一次钱）或删整镜。②参考卡出图后同理，只能重生成 / 锁定。③参考槽缩略图没有 ×（见 U5）。④「用作…」菜单在最后一行被表格 `overflow-hidden` 截掉，「设为首帧」整项看不见（`26-`，`useAsMenu[*].clipped: true`）。 |
| 代码 | `shotRow/StoryboardFrameActions.tsx:225-250`；`anchorZone/StoryboardAnchorRow.tsx` 的 actbar；菜单被裁与 U6 浮条同一个容器 `StoryboardShotTable.tsx:273` |
| 问题类 | 功能用不了。S2 |
| 修法建议 | 批 B5：结果上有「移除」（移除 = 回到未生成态、可撤销；历史版本仍在变体抽屉里）；浮层菜单走 portal。要样张（新动作位置）。 |

### U8 生成视频的逻辑有问题（具体是什么）

我能钉死的具体问题（按严重度）：

1. **批量不分先后**（U3/U4）：3 条视频与 1 张图同一批同时提交，没有「参考卡先」，也没有「镜 N 的尾帧 → 镜 N+1 的首帧」这类跨镜依赖（`storyboardPlan.ts` 注释：「不连 shot→shot 链……镜头连贯靠共享锚参考」——而共享锚参考恰好是 U4 说的没接上的那条）。账本 PLAN-S2-03 说的「批量生成剩余时没有等待跨镜一致性」就是这个。
2. **默认模式让参考根本进不去**：Agent / 拆分镜起草的视频镜默认「文生视频」，参考槽整个不渲染，行上只说「不吃参考 · 切「首帧」模式可挂参考」（`02-`、`23-`）。引用锚的镜头默认就是不吃锚的模式。
3. **取消 = 没发生，但画布上多了节点**：点「生成剩余」→ 在对话框里点「取消」，4 个空闲节点已经建在画布上（`11-after-cancel-nodes-left-behind.png`；`nodesBefore 1 → nodesAfterCancel 5`）。代码是「先全部 materialize、再问钱」：`storyboardRowActions.ts:357` 在 `confirmAndRunPlan` 之前。Agent 路的行号也被偏移（U1②）：节点标题「镜头 3 / 镜头 4」。
4. **对话框不说清**：混合批写「4 个素材」不分图 / 视频，没有逐项清单（见 U3）。
5. **失败文案**：夹具里请求被出网闸拦下，行上显示「这一镜可能已被服务商收下，结果没法确认」。这是闸造成的，**不算产品证据**；但这句话的失败药丸在窄画面格（142px）里折成四行、溢出画面格下沿（探查阶段看到，正式跑里该状态未出现，列为待确认）。
6. **英文下行内「生成」按钮被截断**：Agent 方案（Kling）的行，「Generate」按钮右端被裁（`en/28-…png`，右侧 830px 处只剩「Generat」），与模型名「Kling 3…」同一条被挤的底栏。

| 问题类 | 使用逻辑错（1、3）+ 设计遗漏（2）+ 心智不一致（4）+ 小毛病（5、6）。S1 到 S3 |
| 根因判断 | 1、2 与 B1 同根；3 是「先副作用后确认」独立根因（批 B2 一起修）。 |

### U9 跨镜头的参数选择不完整

「跨镜头」有两个意思，两个都不完整：

| 范围 | 实际 | 证据 |
|---|---|---|
| 「全部镜头」批量条 | 只有四个控件：类型 / 模型 / 时长 / 画幅；画幅选项是一份**固定列表**（按模型默认 / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 3:2 / 2:3），不随模型；清晰度、生成音频、返回尾帧等逐镜参数只能一镜一镜在「⋯」里改（10 镜 = 10 次） | `09-`、`observations.json` P4 |
| 多选浮条 | 只有「统一模型」，没有统一参数 | 浮条代码 |
| 参考卡（同 U2） | 无任何参数 | `03-` |
| 另：「⋯」里比例显示英文原值 `adaptive` | 中文界面出现英文原值（`shotParamPopover`: 「比例 / adaptive / 清晰度 / 720p」），语言轨不一致 | `08-` |

代码：`src/workbench/creation/storyboard/StoryboardBulkBar.tsx:120-122`（`ASPECT_OPTIONS` 固定表 + 计划比例）；`StoryboardSelectionToolbar.tsx`。问题类：选不到参数（⑪）。S2。与 U2 不同根（批量条的作用域模型 vs 锚行没复用底栏）。#1026 已让落画布按模型真实键落，但批量条的**选项**还是固定表。
修法建议：批 B7，批量 / 多选作用域上的参数 = 所选镜所在模型们的**公共可选集**（档案派生），选不了的整枚不出现并说明。

### U10 （补充）「生成视频的逻辑也有问题」
同 U8，已合并；这里再列一条用户可能指的：**视频镜的「生成」与「图片+视频」两个入口语义不同**——图片+视频镜点生成走依赖波次（首帧先、视频后，一次确认），纯视频镜直接发；用户看不出这一镜点了会产生 1 次还是 2 次花费（`generateShotRow` 的两支，`storyboardRowActions.ts:150-165`）。待用户补充具体现象后再确认，目前记为「已合并到 U8，另 1 条待确认」。

### U11 （补充）「跨镜头的参数选择也不完整」
同 U9，已合并。

## 2. 我自己挖出来的（不限于 11 条）

每条都进了账本候选。

| 编号 | 现象 | 证据 / 代码 | 类 | 严重 |
|---|---|---|---|---|
| A1 | 选中行后浮条看不见（sticky 失效） | 见 U6；`StoryboardShotTable.tsx:273/453` | 功能用不了 | S1 |
| A2 | 参考卡改了模型再重试，节点仍用旧模型：计划里 hero 是回环图片模型，画布节点仍是 `gpt-image-2`/`apimart`（`22-`；`observations.json` P8.heroPlanModel vs heroNode.model） | `exec/storyboardRowActions.ts:296`（`syncAnchorNodeWithCard` 只同步提示词 / 标题 / 特征 meta，不同步模型 / 参数）。界面说的 ≠ 发出的（⑩） | 使用逻辑错 | S1 |
| A3 | 取消批量后残留空闲节点 | 见 U8-3 | 使用逻辑错 | S2 |
| A4 | `startPlaybook` 在 c8060fee5 上起不来（读被删的 `POLL_INTERVAL_MS`）。**最新 main 已修**（`invariants.mjs:173` 已改读 `useActiveProductionRun.ts`），记录为「已在途修复」 | `tests/ux/full-walk/invariants.mjs` | 设计遗漏（走查基座） | S3 |
| A5 | Agent 方案镜号被锚占掉 + 锚 id 与镜 id 同名空间（`shot-1` 是锚）→ 改错对象 | 见 U1 | 使用逻辑错 | S1 |
| A6 | 锚在提示词 `@` 菜单里不出现：菜单分组是「某镜结果 / 素材库」；锚出图后只以「画布」分区里的普通结果出现（`15-`、`24-`），没有「这是林薇」的身份 | `shotRow/useShotMentionSource.ts` | 心智不一致 | S2 |
| A7 | 提示词里的引用芯片与槽绑定不同步（删槽后芯片残留） | 见 U5 | 使用逻辑错 | S2 |
| A8 | 同一个东西四个名字：「跨镜头要一致的」/ 参考卡 / 参考图（载体开关）/ 锚；而载体开关叫「参考图」且与四枚「类型」并排、外观一样，读起来像第五种类型（`03-`；英文「Reference image」同） | i18n `storyboardEditor.consistencyTitle / anchor.visual` | 心智不一致 | S2 |
| A9 | 页脚主按钮「生成剩余」不显示数量（i18n 定义里有 `{{count}}` 却没用）；勾「跳过」后无任何数字变化 | `storyboardEditor.footer.generateRemaining` | 心智不一致 | S3 |
| A10 | 英文 / 窄行：底栏「Generate」被截（`en/28-…`）；模型名截成「Kling 3…」 | `shotRow/ShotComposerBar.tsx` 让位表 | 心智不一致 | S3 |
| A11 | 「⋯」里比例显示 `adaptive` 英文原值（中文界面） | `08-` | 心智不一致（语言轨） | S3 |
| A12 | 每次生成都在项目素材里落一份 `embedded-*.jpg`，槽选择器「项目素材 · 最近」被这些重复文件塞满（探查阶段看到同一张图重复多份） | `24-` 同类截图；待另查 | 设计遗漏 | S3 |
| A13 | 最小窗口 1100×690：镜头行底栏被右边缘裁掉——「5 秒」半截，「⋯」和每行的「生成」按钮**整个看不见**（`33-min-window-selected-row.png`、`30-`；`observations.json` P11 无横向页面滚动，是行内容被容器裁掉而不是页面溢出）。选中行后的浮条同样不在视野里（A1） | `shotRow/ShotComposerBar.tsx` + `StoryboardRowShell.tsx` 的列宽（Agent 面板展开 + 最小窗口） | 功能用不了 | S1 |

## 3. 按根因合批（推荐顺序）

> 「改哪层」写的是**共享边界**（P2）。「样张」按 `visual-changes-need-design-canvas-approval`：新界面 / 改交互要出 Claude Design 样张，纯逻辑 bug 不要。与在做的两条线的冲突：L-aspect（分镜 / 文稿方案的整片比例、修订合并）、L-laws（参数控件去重、起草时拒绝越界参数、「⋯」菜单关闭）。

| 批 | 根因 | 改哪层（共享边界） | 样张 | 预计碰的文件 | 与 L-aspect / L-laws |
|---|---|---|---|---|---|
| **B5a 浮条与被裁菜单**（先做，最小） | 选中浮条在 `overflow-hidden` 容器内，sticky 失效；行内弹出菜单未走 portal | 表格容器边界：把浮条挪出容器、菜单走统一 portal | 否（纯逻辑 / 结构） | `StoryboardShotTable.tsx`、`StoryboardSelectionToolbar.tsx`、`shotRow/StoryboardFrameActions.tsx` | 低；L-laws 的「⋯ 菜单关闭」同在行菜单，需约定谁动 `StoryboardShotRow.tsx` 的菜单 |
| **B6 Agent 起草协议** | 创建 / 修订是两步仪式 + 镜号与 id 命名空间混排 + 宿主提示诱导二次新建 | 宿主 `draft_shots` create 边界 + `storyboardPlanFromDraftSubjects`：镜号只数镜；锚 id 独立前缀；同一轮 / 同一文稿已有 Agent 方案时复用或回问；删「下一次 draft_shots」提示；SKILL 镜数规则 | 否 | `mcpGenerationTools.ts`、`mcpGenerationMultiShot.ts`、`agentStoryboardDesign.ts`、`skills/workbench-storyboard-planner/SKILL.md`、`verbs/writeVerbs.ts` | **高**：L-aspect 在改修订合并（`generationPlanPatch.ts`、`storyboardSubjectAdapter.ts`）；L-laws 在改起草拒绝越界参数（`writeVerbs.ts`）。同文件，排队 |
| **B3 参考卡复用镜头底栏 + 写回同步** | 锚行是第二份手写底栏；锚的写回不同步模型 / 参数 | 把镜头行 ComposerBar 抽成共用组件，锚行与镜头行共用；锚的写回走与镜头同一个投影函数 | 是（锚行加参数区） | `anchorZone/StoryboardAnchorRow.tsx`、`shotRow/ShotComposerBar.tsx`、`exec/storyboardRowActions.ts`、`exec/storyboardProjection.ts` | **高**：L-laws 的「参数控件去重」就是同一个组件，应并入同一条线；L-aspect 的整片比例要落到锚上 |
| **B1 锚 → 镜头的可见绑定**（核心） | 锚出图后没有任何 owner 把它写进引用它的镜的参考槽；默认模式不吃参考 | 计划层单一写口：锚得到结果（或起草时）→ 给 `anchorIds` 里的每一镜在**可见槽**加绑定，必要时按档案选一个带槽的模式；绑定长得和手填的一模一样（v6 §2.8） | 小：只需一行可关闭提示（合同已写）；若采纳「自动切模式」要样张 | `storyboardAnchorPolicy.ts`、`workbenchDocumentSlice.ts` / `storyboardProjection.ts`、`exec/storyboardRowStatus.ts`、`anchorZone/StoryboardAnchorStrip.tsx`（「被 N 镜引用」恢复） | 中：碰 `referenceBindings`，L-aspect 不碰它；与 B4 共用绑定模型，建议同一条线 |
| **B2 「生成剩余」阶段化 + 先确认后落节点** | 批次只有镜；对话框无清单；先 materialize 后确认 | `runStoryboardBatch` 与批量对话框：阶段 = 参考卡先、镜头后，一次对话框逐项列出、可去掉；确认前不建节点（取消 = 没发生） | 是（对话框 / 付费卡的表格版，要与付费卡逐项原则对齐） | `exec/storyboardRowActions.ts`、`exec/storyboardRowStatus.ts`、`components/batchPlanPreview.ts`、`StoryboardPlanEditor.tsx` | 中：付费卡线（花钱语义）要先对一下；L 两线不碰 |
| **B4 引用的统一动作集** | 同一个引用四种表示、动作不统一、两个事实来源 | 一个「引用」对象 + 一套动作（查看 / 替换 / 移除 / 忽略特征）；芯片 ↔ 绑定单向同步 | 是 | `shotRow/ShotReferenceZone.tsx`、`ShotReferenceSlotPopover.tsx`、`useShotMentionSource.ts`、`StoryboardPlanEditor.tsx`（灯箱）、`assets/AssetPreviewDialog` | 低；与 B1 同绑定模型 |
| **B5b 勾选框语义 + 结果可移除** | 勾选 = 跳过；结果上没有移除 | 行选择模型：勾选 = 选中，「跳过」移到浮条 / 行菜单；结果「移除」动作 | 是（改交互） | `shotRow/StoryboardShotRow.tsx`、`StoryboardFrameActions.tsx`、`StoryboardShotTable.tsx` | 中：同 B5a 的文件 |
| **B7 批量 / 多选参数** | 批量条是四个固定控件，选项是固定表 | 批量 / 多选作用域上的参数 = 所选镜所在模型的公共可选集（档案派生） | 是 | `StoryboardBulkBar.tsx`、`StoryboardSelectionToolbar.tsx`、`storyboardBulkModelScope.ts`、`electron/shared/storyboard/storyboardShotScope.ts` | **高**：L-aspect 刚改过批量条 / `storyboardShotScope`，等它合了再做 |
| **B8 窄窗 / 语言轨** | 最小窗口 / 英文下行底栏把「生成」挤出视野（A13、A10）；`adaptive` 原值；页脚无数量；多名词 | 底栏让位表（保证「生成」永远可达）；档案值的显示文案；i18n | 否（文案统一要一句话拍板） | `ShotComposerBar.tsx`、`composerBarGeometry.ts`、`i18n/locales/storyboardEditor.ts` | 低 |

推荐顺序：**B5a → B8 的「生成」可达部分（S1，和 B5a 同属「表格结构」）→ B6 → B3（并入 L-laws 的去重）→ B1 + B4（同一条线，绑定模型共用）→ B2 → B5b → B7 → B8**。理由：B5a、B8 的可达性部分和 B6 是「现在就在伤人且最小 / 最独立」的；B3 要先于 B1，因为 B1 之后锚行也会展示它被谁引用、需要稳定的底栏；B2 依赖 B1（有了自动引用，阶段才有意义）；B7 等 L-aspect。

## 4. 需要用户拍板的设计问题

| # | 问题 | 选项（代价） | 推荐 |
|---|---|---|---|
| D1 | 锚出图后镜头是否**自动**引用？两份旧设计打架：`2026-09-05-storyboard-two-state-generation-design.md`「默认不自动引用、提供显式开关」vs v6 合同 §2.8 / §2.10(b)「自动填，且可改」；09-30 又拍板「别的什么都不加」 | ① 自动写进**可见**的参考槽绑定（和手填一样，可删可换，首次落地一行可关提示）——**不违反 09-30**，因为发出去的仍是「行上看得见的」，代价：要决定「默认模式不吃参考」时是否自动切到带槽的模式；② 每份方案一个显式开关（默认关）——最保守，但用户要的「自动」就要自己找开关；③ 保持手动（现状）——30 次点选 | ① |
| D2 | 「生成剩余」要不要先出参考卡？ | ① 一个按钮分阶段：对话框列出「参考卡 2 张 → 镜头 4 个」逐项可去掉（符合「点了的生成、去掉的不生成」）；② 两个按钮；③ 仍只跑镜头，但在有未生成参考卡时先提示。代价：① 要出样张并与付费卡线对齐 | ① |
| D3 | 行首复选框到底是「选中」还是「本次跳过」？ | ① 改回「选中」（符合表格通用心智），「跳过」放浮条 / 行菜单；② 保留「跳过」但换成显眼标签 + 页脚显示数量。代价：①要改 §2.10 已拍板的设计 | ① |
| D4 | 参考卡要不要和镜头行同一套参数？ | ① 同一套（档案派生），代价：行变高；② 只加比例 / 清晰度两个，其余用默认——更省，但「按模型做全」又会被追问 | ① |
| D5 | Agent 的「一次请求只能出一份方案」由谁保证？ | ① 宿主：同一轮已建过 Agent 方案时，不带 operationId 的创建被拒并告知「请带这份的 operationId」；② 完全靠 SKILL 文字。代价：①会拒掉少数合理的「另起一份」，需要一个明确的「另起」写法 | ① |

## 5. 范围与可信度说明

- 视频真正提交的路在零额度夹具里到不了（画布直发的 apimart 视频被出网闸拦下，没有一条请求到供应商——**没花钱**）；视频成功路径的结论来自读码，不是实测。图片镜头 / 参考卡走回环夹具，成功路径是实测。
- Agent 起草的「真模型会不会二次新建 / 说错镜数」没复现（会花钱）；宿主侧诱因与命名空间冲突是确定性实测。
- 本报告的截图是 `git add -f` 进来的（`tests/ux/shots/` 在 .gitignore 里），共约 9MB，合并时可以只留 zh-CN 或删掉。
- 在最新 main 上，#1026 之后：批量条 / 「⋯」的比例落到真实键，**不改变**本报告任何一条结论（U9 的「选项是固定表」仍成立）。
