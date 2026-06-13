# Nomi 记忆系统架构：对话历史库 + 创作记忆库（lorebook）

> 日期：2026-06-13　状态：架构方案草稿，待拍板深度与切片
> 缘起：用户要 ① 多会话历史对话库（翻看任意旧对话续聊）② 真正的「记忆库」，并要先想清楚
> 「到底哪些核心东西值得记」——产品级记忆 vs 创作级记忆。
> 基础：建在已拍板的 [记忆方案 v2](2026-06-13-agent-memory-and-context-overhaul.md)（S-A 选项②已落地）之上。
> 调研：coding agent（Claude Code/Cursor/Cline/Windsurf/Hermes）+ 学术（MemGPT/Generative
> Agents/CoALA/Mem0/A-MEM/Lost-in-Stories）+ 创作类产品（SillyTavern lorebook/CCv3 角色卡/
> NovelAI/AI Dungeon/character.ai/ComfyUI）+ Nomi 域实测，结论散在本文各处。

---

## 🔒 评审结论 + 拍板（2026-06-13，6 角色对抗评审后重塑）

6 角色评审推翻了本方案 v1 的核心论证，用户据此拍板。**下面这一节优先级最高，与下方 v1 正文冲突处以本节为准。**

### 评审挖出的地基塌方
1. **一致性是视觉问题，不是文本记忆问题**：扩散模型的角色一致性 90% 由视觉条件（参考图/IPAdapter/首帧/seed）决定；两镜都写「齐肩黑发女孩」会出两张不同的脸。v1 把银弹打在「注入明文设定」上＝打错层。**且记忆文本从来没进真实生成链路**——`formatMemoryForPrompt` 只进 agent 对话 systemPrompt（`generationCanvasAgentClient.ts:154`），真实出图的 `generationNodeExecutor` 直接拿 `node.prompt` + 参考边解析成**图片 URL**，无文本通道。
2. **conversationId 是 P0 静默炸弹**：贪婪正则 `^nomi:workbench:(.+)$`（`agentSessionStore.ts:28`/`eventLogRepository.ts:49`/`workbenchAgentRunner.ts:25`）会把 `项目id:会话id` 整段当 projectId → 查无目录 → EventLog 与记忆提炼**静默全停**。故「只做对话历史库」不能独立切，依赖方向反了。
3. **多会话历史库是伪需求**（用户澄清证实）：用户要的「翻旧对话续聊」实为**「打开之前的项目接着干」**，已由 项目库 + S-A（重启记得）+ 记忆卡 覆盖，不需重型多会话库。
4. **lorebook 编辑表单撞已发版设计**：`docs/design/2026-06-06-character-scene-fixation-design.md` 已废「抽屉+逐槽表单」、定死「大图即档案」。暴露 keys/injection/order ＝ 把废掉的极客抽屉换名重来。
5. **过度工程**：全局产品记忆层（现仅 1 条候选）退化为 settings；style/brand 零 LLM 规则**抽不出**（画风隐含）；消费边记关系**做不了**（distillEvent 是无状态纯函数，边 seq 乱序）。

### 拍板（锁定）
- **多会话历史库 → 砍**。确保「打开旧项目 → AI 记得 → 接着干」这条现成链顺即可。
- **记忆库重心：文本 → 视觉**。MemoryCard 价值主张改为「**自动复用视觉参考**」（拆镜/生成时把角色卡参考图自动接进生成条件），文本仅兜底（品牌色等精确约束逐字注入是另一回事，保留）。
- **先跑实测再定 S-M2 方向**：~~拿现状 character_ref 参考边跑两镜~~ → **实测不必跑，免费代码诊断已给出决定性答案（见下）**。

### 🔬 诊断结论（2026-06-13，已亲自核实，带 file:line）：不是「记忆」问题，是「生成线路断了」

追了 character_ref 边 → 真实 vendor 请求的全链路，发现「角色一致性」根本到不了「记忆」这一层，卡在更底层的两个真 bug + 一个能力缺口：

1. **🔴 真 bug：`character_ref` 持久边对档案模型（主流）送不到 vendor。** 连边产出 `references.characterReferenceImages`（`generationReferenceResolver.ts:96-100`），但 `buildArchetypeInputParams`（`archetypeMeta.ts:249`）只从 `meta.<slotKey>` 读图，`referenceInputParams`（`archetypeInput.ts:25-27`）对档案模型只用 `archetypeInput`、丢弃 `characterReferenceImages`。**结果：agent 连的角色参考边，对绝大多数模型图片根本不进生成**——只有用户手动拖进数组槽（写 `meta.referenceImageUrls`，`nodeAssetWrite.ts`）才送得到。两套机制没打通。
2. **🔴 真 bug：首帧接力（尾帧→下镜首帧）未实现。** `relayFromVideoUrl`（`generationReferenceResolver.ts:79,148`）全仓无外部消费者，注释承诺的抽帧 consumer 不存在。视频源 `first_frame` 边产出后无人处理（`runGenerationNode` 无抽帧）。
3. **能力缺口：无任何身份保持视觉条件。** 全仓零 IPAdapter/FaceID/identity/reference-strength/weight；`seed` 字段在但**无跨镜复用 seed 的绑定**；`characterIndexed`（`types.ts:39`）只是 prompt 里 `character1..N` 的文字编号约定，不是视觉锁脸。15 个档案里只有 Seedance omni / HappyHorse 2 个声明了角色槽，且一致性全靠 vendor 黑盒。

**重判**：「角色每镜一致」是这条线的真痛点（评审一致认定的尖叫功能），但它**不是记忆系统能解的**，甚至主要不是「视觉条件不够高级」的问题——是**基础线路是断的**（边送不到 + 接力没实现）。修这两个 bug + 补 seed/identity 绑定，价值远高于任何「记忆库」。这是一个**生成管线修复**项目，不是记忆项目。
- **本轮稳的小集（与 S-M2 方向无关，可先做）**：① 修 `headOf(80)` 色值截断（真 bug）；② prop/audio 扩提炼规则（放宽 `projectMemory.ts:89` 一个 if，唯一干净的提炼扩展）。
- **UI（若做 S-M2）**：会话/历史相关一律不做；档案编辑**复用已落地定妆面板**（不暴露 keys/injection/order）；Context Viewer 降级为生成回执一行归因 caption；MemoryFold 原地升级、不另起第二套记忆 UI。

### 砍掉清单
多会话历史库及 conversationId 全套贯穿改动 ｜ lorebook 用户可配置面（keys/injection/order）｜ inclusion group / 递归注入 ｜ Context Viewer 独立面板 ｜ 全局产品记忆「层」（退化为 settings）｜ style/brand 零 LLM 规则 ｜ 消费边记关系 ｜ LLM 软事实+巩固（本轮不做）。

> 下方 v1 正文（§0–§9）保留作研究留档与论证脉络，但凡与本节冲突，**以本节为准**。

---

## 0. 一句话定位 + 最重要的洞察

记忆分两条正交的线（认知科学的 episodic vs semantic，CoALA arXiv:2309.02427）：

- **情景记忆（episodic）= 发生过什么** → 对应**对话历史库**（多会话、可翻看、可衰减）。这是用户说的「基础版」。
- **语义记忆（semantic）= 稳定的事实与设定** → 对应**创作记忆库**（角色/场景/风格/品牌，不衰减、可编辑、按需注入）。这是「可以做得更深」的部分。

**核心洞察：Nomi 已经有半个 lorebook，自己不知道。** 创作类产品（SillyTavern/NovelAI/AI Dungeon）几十年打磨出的创作记忆范式是「**带触发键的稳定档案 × 确定性按需注入 × 预算分层 × 用户锚点受保护 × 注入透明**」。而 Nomi 现成就有：

| lorebook 范式要素 | Nomi 已有的对应物 | file:line |
|---|---|---|
| 稳定档案条目（角色/场景卡）| cast/scene 分类节点（带 prompt/参考图）| `projectCategories.ts:56-102`、`generationCanvasTypes.ts:118` |
| 触发键 / 实体关系 | `character_ref`/`style_ref` 引用边 | `generationCanvasTypes.ts:193-200` |
| 用户钉死保护 | 节点锁定 `locked` | `generationCanvasTypes.ts:145` |
| 参考资产（CCv3 assets）| 节点 result 的参考图、IPAdapter/首帧 | `generationCanvasTypes.ts:51-79` |
| 提炼成记忆 | projectMemory 4 条规则 | `projectMemory.ts:84-135` |

**缺的不是数据，是把它升格成「记忆库」**：现在这些档案只活在画布节点上，projectMemory 把它们压成扁平文本事实就丢掉了结构（触发键、资产、注入控制）。真正的「记忆库」= 把这些升格为**一等的、可检索、可在生成时按需注入、可被用户钉死的档案库**——让「角色/风格一致性」在每次生成时真正生效，而不只是连一根参考边。

---

## 1. 该记什么：域清单（产品级 vs 创作级，标注现状）

> 现状依据：`projectMemory.ts` 现只提炼 4 类（character/scene 卡、lock 约束、overrides 偏好）。

### 创作级 / 项目专属（这个视频项目内）

| 该记什么 | 类型 | 现状 |
|---|---|---|
| 角色定妆设定（外貌/服装/气质）| semantic 档案 | ✅ 已记（`projectMemory.ts:86`），但被压成扁平文本、丢了结构 |
| 场景设定 | semantic 档案 | ✅ 已记，同上 |
| 节点锁定约束 | semantic（受保护锚点）| ✅ 已记（`:111`）|
| 用户改写偏好 | semantic | ✅ 已记（`:125`）|
| **道具 / 声音卡** | semantic 档案 | ❌ distiller 漏（`:89` 只认 character/scene），但 prop/audio 是一等分类 |
| **世界观 / 整体画风 / 品牌调性** | semantic（constant 注入）| ❌ `style`/`brand` 是**死类型**（`:13` 有类型、无规则）——Skill 反复要"统一全片风格"却无处沉淀 |
| **镜头时序 / 排片** | semantic | ❌ shotIndex 被显式排除（`:100`）|
| **关键参数（seed/比例/model）** | semantic | ❌ 数据在 provenance（`generationCanvasTypes.ts:51`）未沉淀进记忆 |
| **角色↔镜头出现关系**（哪个角色在哪些镜头）| semantic 关系 | ❌ distiller 完全不消费边 |
| 叙事意图 / 五段结构 / 接力决策 | semantic | ❌ Skill 规划后即抛 |
| 每次生成「发生了什么」 | episodic | ❌ 未作为可回看历史 |
| **精确约束逐字**（色值 #8B0000/尺寸/型号）| 铁律 | ⚠️ `headOf(80)` 截断（`:75`）会把色值截成 `…`——违 v2 精度铁律，且自承未验证 |

### 产品级 / 通用（跨项目）—— 现状几乎空白，无承重墙

| 该记什么 | 现状 |
|---|---|
| 默认模型偏好 | ⚠️ 只在 localStorage（`assistantModelPref.ts:5`），非记忆、AI 看不到、重装即失 |
| 默认比例/清晰度/审美 | ❌ 未记，每次现场推断 |
| 常用工作流（默认拆镜 vs 出视频）| ❌ 硬编码进 Skill |
| 对 AI 的纠正习惯 | ⚠️ 唯一一条（`pref:overrides`），但被关在单项目 memory.json 里，不跨项目 |
| 语言偏好 | ❌ 硬编码进 Skill |

> **产品级记忆没有家**：memory.json 全是 per-project（`projectMemory.ts:44`）。需要一个**全局记忆层**（可仿 `agentSessionStore.ts:33` 的 `local`→settings root 先例）。

---

## 2. 架构总览（三层 + 五条横切纪律）

```
┌─ 工作记忆 = 当前 LLM 窗口（当前镜头/当前对话轮）
│
├─【对话历史库】episodic · 多会话           ← 用户要的「基础版」
│   • 每个项目 N 条会话(conversationId)，可列出/翻看/搜索/续聊
│   • 续聊 = 按 convId 回灌工作缓存(复用选项② agent-session.json)
│   • 存储：会话索引(轻) + 正文分离(Cursor 双层模式)；本地 JSON，不上向量库
│
├─【创作记忆库】semantic · 项目专属 = lorebook  ← 「做得更深」的核心
│   • 角色/场景/道具/风格/品牌 = 带触发键的稳定档案(明文+参考资产)
│   • 生成镜头时：constant 档案(品牌/画风)恒注入 + selective 档案(被该镜点名的角色/场景)关键词触发注入
│   • 不衰减、用户可编辑、可钉死(锁定=受保护锚点)
│   • 升格现有 cast/scene 节点，复用 character_ref 边作触发关系
│
└─【产品记忆】semantic · 全局(跨项目)          ← 现状空白，要新建全局层
    • 默认模型/比例/审美/工作流/纠正习惯/语言
    • 可仿 settings root 落全局，AI 在任意项目都能看到
```

### 五条横切纪律（全部来自调研验证）

1. **确定性按需注入 > 向量检索**（SillyTavern/NovelAI/AI Dungeon 一致）：创作档案用「关键词触发 + constant 常驻」而非 RAG 召回——可预测、可解释、用户能预判「写到小明就注入小明定妆」。向量召回不可控，定妆这种「必须每次一模一样」的绝不交给相似度。量大了再加 vectorized 兜底同义词。
2. **Token 预算分「保护 / 可裁 / 动态」三层**（抄 AI Dungeon）：当前镜头描述 + 用户钉死约束 = 永不裁；角色档案 = 按配额（如 25%）；历史风格参考 = 动态填充。NovelAI 的「Reserved Tokens」先给关键档案预留。
3. **用户锚点优先且受保护**（抄 character.ai pinned）：用户钉死/手写的设定，自动提炼**永不覆盖**（projectMemory 已有此不变量 `:189`，扩展到所有档案）。反面教材：Windsurf 自动记忆无确认门 → SpAIware 持久注入漏洞——**自动学的记忆要可审计/可一键清，吃外部素材描述前尤其要确认门**。
4. **注入透明**（抄 NovelAI Context Viewer）：让用户看见「这个镜头最终注入了哪些档案、哪条因预算被裁」——创作可控性的关键 UX。
5. **写轻、检索重 + 精度逐字**（学术 arXiv:2603.02473 + v2 精度铁律）：别在写入端堆昂贵 LLM 抽取（raw + 好检索 ≈ 复杂有损管线）；精确约束（色值/尺寸/型号）**逐字存、永不进摘要/截断**——先修 `headOf(80)` 截断隐患。episodic 可用艾宾浩斯衰减（MemoryBank），**semantic 档案绝不衰减**（否则"角色失忆"bug）。

---

## 3. 对话历史库（episodic）—— 基础版，先做

### 现状（实测）：严格单会话

sessionKey = `nomi:workbench:<projectId>` 单条（`workbenchAgentRunner.ts:25`），创作+生成共享。三套存储全 per-project 单桶：气泡 `conversations.json`、工作缓存 `agent-session.json`（S-A 刚做）、EventLog。**结构里没有 conversationId 维度**。

### 要做「列出/翻看/搜索/续聊」缺什么 + 集成点

业界范式（Claude Code/Cursor）：**多会话库 + 侧栏列表 + 全文搜索，不上向量**；双层存储（轻索引驱动列表 + 正文分离）；续聊 = 反序列化整条重灌。落到 Nomi：

1. **引入 conversationId 维度**（根）：sessionKey → `nomi:workbench:<projectId>:<convId>`。动 `workbenchAgentRunner.ts:25` / `agentSessionStore.ts:27-47`（文件改 `sessions/<convId>.json`）/ `eventLogRepository.ts:48`。
2. **会话索引**（新建）：会话 id/标题/创建更新时间/首条 prompt 摘要——驱动侧栏列表，列表不读正文（Cursor 双层）。
3. **续聊**：复用选项②，`loadAgentSession` 按 convId 读对应文件即可逐字续。`resetSession` 语义从"清空桶"改"新建 convId"。
4. **搜索**：本地全文（气泡 `{id,role,content}` 现成可作源）。
5. **气泡双桶**：creation/generation 现按面板分桶（`conversationPersistence.ts:25`），多会话下「一条会话含两面板视图」语义延续（两面板本就共享 sessionKey）。

### 不上 EventLog 当对话真相源（v2 已证伪、本次复核确认）

EventLog 截断狠（user 256 字 `agentChatTrace.ts:45`、tool result 2048 字不可 parse、附件不进、无 proposalId 配对），重建对话出残片+孤儿。续聊靠选项②工作缓存，**不靠 EventLog 重建**。

---

## 4. 创作记忆库（semantic / lorebook）—— 做得更深

### 数据结构：统一档案条目（抄 SillyTavern WorldInfo + CCv3 角色卡）

把角色/场景/道具/风格/品牌做成统一 schema 的「记忆档案」：

```
MemoryCard {
  id, kind: character|scene|prop|audio|style|brand
  keys: string[]         // 触发键/别名（"小明","男主"）——镜头 prompt 命中即注入
  content: string        // 明文设定（逐字保留，不截断）
  assets: Asset[]        // 参考图（主图 main / 表情 / 背景），喂 IPAdapter/首帧
  injection: 'constant' | 'selective'   // 品牌/画风=constant；角色/场景=selective
  order: number          // 注入顺序/优先级
  pinned: boolean        // 用户钉死=受保护，自动提炼不覆盖
  origin: 'user' | 'auto'
  updatedAt              // 冲突消解：带时间戳取最新(确定性，非 LLM 判新旧)
}
```

这与 CCv3 的 character_book entry（`keys/content/constant/insertion_order/assets`）几乎同构。**Nomi 的优势**：cast/scene 节点已经是档案、character_ref 边已经是触发关系、锁定已经是 pin——升格而非新建。

### 生成时注入（这是「一致性真正生效」的地方）

现在 character_ref 边只喂**参考图**给生成，**文本设定没被系统注入**。新机制：拆镜头/生成某镜头时，按这个镜头涉及的实体（边关系 + prompt 关键词命中）**注入相关档案的明文设定 + 绑定参考图**，constant 档案（品牌/画风）每镜恒注入。token 预算三层裁剪。→ 角色定妆描述、品牌色、画风每镜一致，不漂。

### 自动提炼的扩展（扩 distillEvent，零新事件类型）

EventLog 已是金矿（node.added 带全节点、edge.connected 带 mode、approved 带参数），**缺的是规则不是事件**：
- 激活 `style`/`brand` 死类型：从全片统一的画风/比例/品牌关键词提炼 constant 档案。
- 补 prop/audio 卡（`:89` 现漏）。
- 消费 character_ref 边 → 记「角色↔镜头出现关系」。
- 从 provenance 沉淀关键参数。
- **修 `headOf(80)` 截断**（精度铁律）。
- LLM 软事实（v2 拍板：**提议态**，用户确认才转正）抽风格/品牌这类规则抽不出的软偏好。

### 巩固（consolidation）—— 低频、不后台烧 token

学术共识：别每条都反思（贵+碎片化），在「换章节/换话题/用户手动」时才把零散 episodic 提炼成 semantic 洞察（GAM 语义漂移触发思路）。Nomi 对应：一个项目"拆完镜头/定完妆"是天然的巩固点。

---

## 5. 产品记忆（全局）—— 新建全局层

默认模型/比例/审美/工作流/纠正习惯/语言，落 settings root（仿 `agentSessionStore.ts:33` 的 `local` 先例），AI 在任意项目注入。注意 master-plan「不抄全局记忆——创作项目间风格互窜是事故」——所以**全局层只放"产品级偏好"（怎么用工具），创作内容（角色/风格）严格留项目级**，两者不混。

---

## 6. 复用承重墙 vs 新建

**复用**：EventLog（提炼真相源，扩 distillEvent 即可记更多，零新事件）｜memory.json 管线（增量游标+墓碑+回放，扩规则+激活 style/brand+修截断）｜agentSessionStore 选项②（改 per-conversation 即支持续聊任意会话）｜conversationPersistence（加 convId 维度）｜cast/scene 节点+character_ref 边+锁定（升格为 lorebook）。

**新建**：conversationId 维度（多会话根）｜会话索引+搜索｜全局产品记忆层｜会话生命周期事件（EventLog schema 扩展）｜lorebook 注入引擎（生成时按触发键拼档案+预算裁剪）｜Context Viewer 透明面板。

---

## 7. 切片与排期（基础 → 深，建议）

按用户「先基础版」+ 风险递增：

1. **S-H1 多会话历史库（基础版，用户要的）**：conversationId 维度 + 会话索引 + 侧栏列表/搜索 + 按 convId 续聊。复用选项②。
2. **S-M1 记忆库地基**：扩 distillEvent（激活 style/brand、补 prop/audio、修 headOf 精度截断）——零新事件，纯扩规则。
3. **S-M2 档案升格 + 生成时注入**：cast/scene 升格为 MemoryCard（keys/assets/injection），lorebook 注入引擎（关键词触发+constant+预算三层），Context Viewer 透明面板。这是「一致性真正生效」的核心切片。
4. **S-P1 全局产品记忆层**：默认模型/审美/工作流落 settings root。
5. **S-M3 LLM 软事实（提议态）+ 巩固**：低频、用户确认门。

每片独立 commit + 五门 + R13 走查 + UI 项先过 R8 样张。

## 8. 待拍板（决策表）

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| 深度 | 这轮做到哪 | A 只做对话历史库(基础) / B 历史库+记忆库地基 / C 全做到生成时注入 | 看你——B 是「基础+把记忆库骨架搭起来」的平衡点 |
| 检索 | 创作档案注入 | 关键词触发+constant（推荐）/ 加向量兜底 / 纯全量 | 关键词触发（可控、可解释）|
| 软事实 | LLM 抽软偏好 | 提议态（v2 已拍）/ 不做 | 提议态 |
| 全局记忆 | 产品级偏好 | 做全局层 / 仍留 localStorage | 做全局层（AI 才看得到）|
| 档案升格 | cast/scene → MemoryCard | 升格复用 / 新建并行库 | 升格（P1：不造第二份）|

## 9. 不动 / 风险

- **不动**：EventLog 单写口+seq；memory.json 三域分离；选项②工作缓存定位；master-plan「全局不放创作内容」。
- **风险**：① conversationId 维度贯穿多处反解正则，要一致改（`agentSessionStore.ts:27`/`eventLogRepository.ts:48`/`workbenchAgentRunner.ts:25`）；② lorebook 注入引擎要进生成 prompt 拼装链路，需 R8 样张 + 真机验一致性；③ 精度截断（headOf 80）先修再谈记忆库。
- **待 R7**：六角色评审本架构（尤其 CTO 看 conversationId 改动面、前端看历史库侧栏/Context Viewer、真实用户看「档案注入」会不会太重）。
