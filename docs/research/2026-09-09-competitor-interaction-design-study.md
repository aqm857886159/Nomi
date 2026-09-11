# 竞品交互设计研究：界面为什么长这样、交互为什么这么做

> 2026-09-09 · 方法：3 子代理并行——官方文档实抓（ChatCut）+ UI 源码直读（OpenChatCut ProposalCard/FireRed app.js 152KB/Velorn mockups）+ 仓库截图逐张目验。等效于「下载点开查」且更系统；如需真机走查可另跑 OpenChatCut `pnpm dev`（Electron 可本地起）。
> 定位：补上竞品研究缺的最后一面——前几篇回答「底层怎么做」，本篇回答「**界面为什么长这样、交互为什么这么做**」。直接输入：拆解面板新方案（B1）与计划卡交互（P0-1·A2）的样张设计。

---

## 一、五家交互设计卡片

### ChatCut（官方，文档最全）
**布局**：AI 面板**默认在左侧**（agent 是「驱动侧」，右侧留给属性/媒体——与 Nomi 相反）；中 Viewer、下 Timeline；顶栏 Workspace 菜单可勾选显隐各区 + **Versions 快照** + Export。
**三个核心交互**：① 对话=三区一体：消息流（含生成确认卡）/composer/控件组（Agent/VideoGen 模式、Selection Mode、模型/Style/Skill 选择）；**Selection Mode**（Option-S）从时间轴/资产/预览框选/转写文本任意来源生成 `@` 引用 **chip**，失效可检测。② **workflow card 只填充草稿不执行**（原话 "Selecting the card alone does not start a task"）——强制一次审阅动作。③ Stop 的边界写进 UI 文案："Stopping does not undo edits already applied"——回滚权分层：Undo + Version 双轨，交付永远是用户显式动作（空时间轴禁用 Export）。
**设计逻辑**：chip 去歧义+可失效检测；卡片填草稿防误触发；导出与 agent 会话解耦。

### OpenChatCut（UI 源码级证据）
**布局**：左窄列 Agent 对话（Thinking 折叠+工具调用行内联）、中素材池（My Media/Library/**Transcript 常驻 tab**）、右 Preview+Properties、底 V2/V1/A1/A2 四轨。
**核心交互：ProposalCard**（`src/components/chat/ProposalCard.tsx` 源码证实）——编辑提案卡=**逐项可勾选的操作清单**（默认全选+全选/清空）+ totalImpact 影响范围 + **onPreview 预演开关**（apply 前先在预览区试演）+ stale 时三选（Apply/Re-propose/Cancel）。批量操作不是一刀切：**「将执行 3/5 项」的部分放行**。
**设计逻辑**：适配 AI 不完美——逐项勾选+预演把确认心理成本降到最低；过程（Thinking/工具行）折叠在消息流内不另开进度弹窗。

### Pireel
**布局**：核心 UI 闭源（OSS 壳+`@pireel/studio-ui`），但交互模式有文档：**人/Chat/外部 agent 三通道写同一份 EditorDocumentV2**，界面只是实时投影（"Composition 是只读投影"）。
**特色交互**：`create_browser_handoff` 发 60 秒一次性票据 URL，agent 用**自己的内嵌浏览器**打开 Studio——与用户**共看同一画面**，agent 改文档预览实时刷新。
**设计逻辑**：单一文档权威使三通道混用不打架；引用用语义稳定 ID 而非轨道索引。

### FireRed-OpenStoryline（源码级证据）
**布局**：**没有时间轴面板**——整个前端是 ChatGPT 式聊天页（左配置 sidebar+中间消息流+底部 composer），预览走 modal。
**核心交互：过程即消息**——每个工具调用按 call_id **原位 upsert 成可折叠工具卡**（一行=状态符+本地化工具名+args 预览+进度条；无真进度时按预估 ms 假进度封顶 99% 防失信，源码注释明言）；完成展开内联视频，成品以媒体块进聊天流。所有智能功能（粗剪/转场/卡点）无按钮，靠自然语言+骰子示例 prompt。
**设计逻辑与代价**：实现极简、学习成本为零；**代价是放弃了空间编辑**——无法框选/拖拽/看全局节奏，这正是它单文件前端 152KB 还能扛住的原因。

### Velorn
**布局**：顶部模式页签 **Edit/Generate/Stock/ComfyUI/Export**——生成与剪辑是两个顶层模式，用**常驻 Queue 面板**桥接（依赖自检"Required dependencies were detected"→排队→素材落池）。
**特色交互：UGC 模板五步向导**（Vibe→References→Script→Keyframes→Videos+Timeline）：Script 自称 "editable source of truth"，5-beat 故事弧 **tap a beat to jump**，**每镜头可单独重生成**，模型按阶段预绑定（"Nano Banana 2 keyframes / LTX 2.3 video"），甚至可复制 prompt 到外部 LLM 再贴回。
**设计逻辑**：队列解耦「慢生成」与「快剪辑」；成本/时长预估直接印在工作流卡片上（"~$0.45""~45s on 4090""Used 12×"）。

## 二、横向模式表：同一问题的不同答案

| 交互问题 | ChatCut | OpenChatCut | Pireel | FireRed | Velorn | Nomi 现状 |
|---|---|---|---|---|---|---|
| AI 面板位置 | 左（驱动侧） | 左窄列 | 三通道无固定面板 | 全屏即聊天 | 无内嵌聊天（MCP 外挂） | **右侧**（生成=属性侧心智） |
| 计划确认形态 | 对话流内确认卡+credit 估算 | **逐项勾选+预演** | 原子命令+receipts | 工具卡原位更新 | 五步向导分步确认 | 采纳桥 Proposal（待 A' 计划卡化） |
| 进度呈现 | 消息流内 | Thinking 折叠+工具行 | 投影实时刷新 | 工具卡进度条封顶 99% | 常驻 Queue 面板 | #658 五段语汇 |
| 转写入口 | Transcript 媒体组 | **素材池常驻 tab** | 语义层 | 融进对话 | 无 | 无（B' 待做） |
| 版本/回滚 | Versions 手动快照+Undo | VersionHistory+逐项否决 | 命令历史 | 无 | 无 | 采纳桥一步撤销，命名版本=F' |
| 生成与剪辑关系 | 同编辑器内 | 同编辑器+技能触发 | 同文档三通道 | **只有对话无轴** | **双模式+队列桥** | 画布⇄时间轴同工作区（结构性优势） |

## 三、对 Nomi 两个在途设计的直接输入

### 拆解面板（B1，待立新方案）
1. **Transcript 做成常驻 tab**（OpenChatCut：素材池第三 tab），不是弹层——「文本↔时间轴」双向锚定是后续文本式剪辑的界面地基。
2. **镜头表条目=结构化引用 chip**（ChatCut Selection Mode）：勾选的镜头是可失效检测的引用而非文字描述——画布节点删了要提示重选。
3. **镜头级独立重生成+点击跳转**（Velorn 五步向导的 beat 交互）：每镜一颗「重拆/重生成」，点镜头表预览跳对应帧。
4. **成本预估印在卡上**（Velorn）：「重拆这一镜 ≈ ¥0.1 / 40s」前置透明。

### 计划卡（P0-1·A2，#646 摩擦直修）
1. **逐项勾选+部分放行**（OpenChatCut ProposalCard）：默认全选+全选/清空+「将执行 n/m 项」统计——直接治 C0 的「审批项仅镜号需逐个展开辨认」。
2. **Apply 前可预演**（onPreview 档位）：预览区先演示效果再真落轴。
3. **执行态折叠在卡内**（FireRed 工具卡范式）：原位 upsert 进度、可展开明细，不开弹窗；假进度封顶 99% 的诚实处理照抄。
4. **点卡片≠执行**（ChatCut workflow card）：确认卡先填充预览，显式 Send 才跑；缺必填项禁用确认并说明。
5. **回滚权分层写进 UI 文案**：Undo 管最近一步、Version 管里程碑；agent 停止不回滚已应用改动——这句话要出现在界面上。

### 我们保留的不同选择（有理由的不一致）
- **AI 面板留右侧**：Nomi 的生成画布占主体，右侧=「生成是属性操作」的心智；ChatCut 左侧因为它没有生成画布。样张阶段用 P5 验证即可，不必盲从。
- **不学 FireRed 的纯对话形态**：它以放弃空间编辑为代价换实现简单——Nomi 的画布+时间轴是护城河，对话是补充不是替代。
- **不学 Velorn 双顶层模式**：Nomi 的画布⇄时间轴同工作区是结构性优势（生成产物直接落轴），Velorn 拆双模式是因为它没有我们的采纳桥。

## 七、补充扫描（2026-09-09 第二轮：查漏补缺）

| 产品 | agent 交互形态 | 最值得借鉴 |
|---|---|---|
| **Descript Underlord**（beta，官方 help 文档） | 右侧边栏聊天面板，"agentic co-editor"（能代替你行动而非只建议）；可切底层模型（Claude/GPT/Gemini）；@ 按钮 pin 文件/场景/时间戳/图层进上下文；按项目隔离+跨设备同步；按 AI Credits 计费 | **每轮编辑后后台「自动 review 二次校验」**：发现误删/越界自动重调 agent 修复，用户零操作——agent 自检而非全靠用户确认，全类目独一份 |
| **oh-my-cassette**（131★） | 纯终端聊天（"No timeline. No editing software."），内部有显式时间轴但用户不可见；每轮返回 timeline digest + **contact sheet 缩略图墙**（每 clip 一帧），批准后才渲染；导出自动质检（时长/黑帧/音量） | **「批准前不渲一帧」成本门闸** + contact sheet 作为零渲染确认物 |
| **剪映桌面版**（实测文章） | 无对话 agent，全是入口按钮式；智能剪口播=**AI 把废话/重复/口误直接高亮在时间轴上**，右侧面板删除建议，一键优化帧级切除 | **AI 判断结果具象化在时间轴上**（不是文字报告）——用户所见即 AI 所想 |
| **twick**（534★） | React 时间轴 SDK；agents 包是 MCP server 产 Twick 格式工程文件 | 外部 agent 与编辑器用**文件协议解耦** |
| 智影/度加 | 均为按钮+候选挑选范式，无对话 agent | 5 分钟素材 15 秒出 3 候选选优（度加） |

**补查后结论**：对话式 agent 剪辑的公开实现者就是已深挖的那五家 + ChatCut 官方；商业大厂里只有 Descript Underlord 是真正的 agent-in-editor（值得单独跟进它的 changelog）；国内厂商全线停留在「按钮+候选」范式——Nomi 做成对话式 agent 剪辑即国内空白。

---
*执行：3 子代理并行（ChatCut 文档 / OpenChatCut 源码+截图 / Pireel+FireRed+Velorn 源码+mockups）；证据均为源码 file:line、官方文档原话或仓库截图目验，推断处已标注。*
