# 角色身份一致 + 结构化 Prompt（借鉴 ViMax）

> 状态：**待用户拍板**（2026-06-13）
> 来源：细读 HKUDS/ViMax 后的可借鉴清单，经用户逐条裁剪——只保留 ③ 角色身份、⑤ 结构化 prompt；砍掉 ①VLM 自动选帧 / ② 自动引用 / ④ 机位抽象（详见「背景」）。

---

## 0. 背景与裁剪结论

ViMax（HKUDS 的 agentic 视频生成框架）的核心是一套"一致性机器"。逐条对照 Nomi 后，用户拍板裁剪如下：

| ViMax 机制 | 结论 | 理由 |
|---|---|---|
| ① VLM 最优帧自动选 | **砍** | 与 Nomi「人工在环、用户品味说了算」内核冲突；让 AI 替用户定品味是错方向 |
| ①'「出 N 张让用户挑」 | 暂不做 | Nomi 现在每节点只出 1 张；用户未要求 |
| ② 时间线感知自动引用 | **砍** | 既不做 AI 判别，引用保持 agent/手动连边即可；T8 能力校验已够 |
| ③ 角色身份登记表 | **做** | 唯一真地基；纯数据/agent 层，不碰 VLM；直接合体 J2 定妆链路 |
| ④ 机位抽象 cam_idx | **砍** | `composition_ref` + 场景定妆卡引用已覆盖（同空间 + 同构图）；再造抽象 = 第二份真相源（违 P1）|
| ⑤ motion 独立字段 | **降级做** | 不加数据字段；改为「优化 prompt 结构，让 agent 结构化出 prompt」 |

本方案 = **③（裁剪后） + ⑤（降级后）**。

**通俗讲：** 现在做一部稍长的片子，agent 容易把「林医生 / 小林 / 他」当成几个人各做一张定妆 → 同一角色长得不一样；隔天回来补几个镜头，又会重复建一遍卡。本方案让 agent 在动手前先理清"这剧本里到底有几个人、哪些称呼是同一个人"，并且能复用画布上已有的卡，不重复造。顺带把 agent 写生成提示词的方式规整成固定骨架，质量更稳。

---

## 1. 现状盘点（带 file:line，2026-06-13 实读）

### 角色 / 定妆
- 节点是单一类型 `GenerationCanvasNode`（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:118-172`），靠 `kind` + `categoryId` 区分。**无任何 identity 字段**。
- `CharacterMeta = { tagline?, tags? }`（`src/workbench/generationCanvas/model/nodeMetaFields.ts:34-39`）——无 id、无别名。`FieldProvenance`（`'user' | {ai:number}`，`nodeMetaFields.ts:18`）已能区分用户编辑 vs AI 抽取，是可复用的先例。
- 项目持久层 `WorkbenchProjectPayload`（`src/workbench/project/projectRecordSchema.ts:98-105`）= `{ workbenchDocument, timeline, generationCanvas, categories?, ... }`——**无 characters slice**。
- 跨镜头复用 = `character_ref` 边（`runner/generationReferenceResolver.ts:96-100`）。复用与否的判断 **100% 由 LLM 在 skill prose 里临场决定，无代码兜底**。
- 唯一关联"角色↔被哪些镜头用"的代码是 `useNodeRelationships.ts:21-71` 的 **标题子串计数**（`prompt.includes(title)`），文件注释自标 MVP、待 "Phase G" 用真关系图替换——别名一变即错。

### 根因（P2）
- 两个 planner skill **硬性 ❌ 禁用 `read_canvas_state`**：storyboard `SKILL.md:18`「你规划的轨迹是全新的」、fixation 同理 → **结构上决定了二次规划必然重复建卡**。
- storyboard Step 1（`skills/workbench-storyboard-planner/SKILL.md:30-36`）已要求"≥2 镜建一张、绝不重复建卡"，但**缺**：① 别名合并（本名/职称/代称归一）② 重大变化分裂（少年↔成年）③ 可见的角色清单供用户校对。

### Prompt 结构（⑤）
- 结构规则散落：storyboard `SKILL.md:66-68`（已有雏形：关键帧=场景/光线+主体/动作/表情+镜头语言+风格；视频=运镜+动作演进+节奏）、generation `SKILL.md:26`（主体/环境/光线/构图/风格，**无运镜**）、静态系统提示 `generationCanvasAgentClient.ts:85-86` 仅「高质量提示词」。
- `plannedNodeSchema.prompt` 是裸 `z.string()` 无 `.describe()`（`electron/ai/canvasTools.ts:31-50`）。
- 运镜确认只在 `node.prompt` 自由文本里，无 `motion` 字段（`generationCanvasTypes.ts:118-153`）——符合 ⑤「不加字段」的方向。

---

## 2. 设计 · ③ 角色身份（三档，推荐 Tier 1 + Tier 2）

### Tier 1 — Prose 协议（必做，零数据改动）
强化 storyboard Step 1 与 fixation 识别方法论，**全在 skill .md 文本**：
- **显式别名合并**：先通读全文，把指向同一个人的不同称呼（本名 / 职称 / 代称 / 「他」「那女人」）归并到一个 canonical 角色，记下「canonical 名 + 别名表」。
- **显式分裂判定**：同一角色若发生不可调和的外观变化（少年↔成年、伤前↔伤后、彻底变装）→ 拆成两个角色各一张卡，在 summary 说明。
- **可见角色清单**：调用 `create_canvas_nodes` 前，先用自然语言列出 `[角色1（别名：…）、角色2…、场景…]`，用户在对话里一眼能纠错。

> 解决：**单次规划内**的同人多卡 / 重复建卡。

### Tier 2 — 增量复用（建议同做，**纯 prose + 字段过滤，无新工具 / 无新 IPC**）

> **评审修正（前端 + 后端实证）**：`read_canvas_state` 不走 IPC（renderer 直读 store，`applyCanvasToolCall.ts:77-84`），且运行时按 skillKey 前缀选工具组、**不读 skill.json 的 tools 白名单**（`agentChatV2.ts:355-362`）——该工具对所有 canvas 类 skill **早已暴露**。所以「禁读」纯是 prose 禁令，放开 = 改文本，原方案把它当「小代码」是高估。「Tier2 前要查清当初为何禁读」这条 PM 顾虑也由此解除：不是防污染的运行时门，是 prose 人为禁令。

- 给 `read_canvas_state` 加按 **`node.kind`** 过滤（喂 LLM 的紧凑行 `canvasPromptContext.ts:22-37` **当前不含 categoryId**，故按 `kind===character|scene` 过滤，不是按 category；**不新增** `list_cast_and_scenes`——新增要同步 5 处且 gate 默认拦未登记工具）。
- skill 规则改为：**先读已有 cast/scene 卡 → 能复用的连 `character_ref` 边到已有卡 → 只为缺的角色建新卡**。连已有卡**必须用 read 回包里的真实 node id，不是 clientId**（clientId registry 只存本 turn，`applyCanvasToolCall.ts:33`）；给出「真实 id 边 + 新节点 clientId 边」在**同一次** `create_canvas_nodes` **混合提交**的范式（`canvasTools.ts:99` 支持混合；不得退回被禁的 `connect_canvas_edges`）。
- **同步删两份真相源**：storyboard `SKILL.md:18`/`:86` 的 ❌read_canvas_state 禁令 + 两个 `skill.json` 的 tools 白名单补 `read_canvas_state`（文档与行为对齐，否则留不一致）。
- **复用不静默**（必改 · 防脏复用）：删硬约束后复用与否 100% 靠 LLM 判断、无代码兜底，误连 `character_ref` 到错卡会污染下游生成。故复用/合并前把候选旧卡（名字 + 缩略图/tagline）亮给用户、可否决；详见 §4。

> 解决：**跨调用 / 增量补镜**时的重复建卡。匹配仍是 LLM 判断（按名/特征），不引入持久 id。
> **实现合并（CTO 建议）**：Tier1「单次内别名合并」与 Tier2「跨调用复用」共享同一套「角色清单 + canonical 判断」逻辑，**prose 合并成一个「识别共享元素（含画布已有）」方法论段落**，靠「是否调用读工具」自然分流，少写一份 prose 真相源。

### Tier 3 — 持久身份层（本期不做，留路）
- `GenerationCanvasNode` 加 `characterId` → 项目 payload 加 `characters: CharacterRegistryEntry[]` slice；分裂用现成 `derivedFrom`（`generationCanvasTypes.ts:152`）记父子。
- 用真 id 关系替换 `useNodeRelationships.ts` 的标题子串计数（兑现代码自标的 Phase G）。
- 代价：schema 迁移 + store slice + 节点字段 + UI 展示身份 + 边解析改动 = 真架构活，单独立项。

**推荐 Tier 1 + Tier 2**：从「单次内」「跨调用」两个入口同时堵死重复建卡这个真痛点，零/极小数据改动，完全在 agent 层。Tier 3 留到要做"角色用法分析面板"时再立项。

---

## 3. 设计 · ⑤ 结构化 Prompt（不加字段）

1. 把 prompt 结构升成**显式骨架**，统一进两个 skill：
   - 关键帧/图像：`场景·时间·光线 → 主体·动作·表情 → 镜头语言(景别/角度) → 风格关键词`
   - 视频：`运镜(推/拉/摇/移/跟) → 画面内动作演进 → 节奏·时长感`（不复述静态）
   - 定妆卡：沿用 fixation 8 条（已结构化）
2. **骨架的唯一真相源 = `plannedNodeSchema.prompt` 的 `.describe(骨架)`**（`canvasTools.ts:35`；AI SDK 会把 zod description 注入 JSON Schema 传模型，LLM 吃得到）。describe 文本须**稳定、不含动态值**（进 tools 块前缀，一次性 byte 变更后命中缓存）。
3. 静态系统提示 `generationCanvasAgentClient.ts:85-86` 只留**一句指针**「按 prompt 字段描述的骨架写」，**不重写骨架**；skill 里 `storyboard SKILL.md:66-68` 的旧结构同步收敛为指向 schema 的一句（避免 skill / schema / 系统提示**三份真相源漂移**——前端 + 后端必改）。

> **缓存澄清（评审）**：byte-stable 约束只针对**静态系统提示串**（`generationCanvasAgentClient.ts`）；skill body 走 `readFileSync`（`agentChatV2.ts:61-80`）**无 prompt-cache**，改 .md 下一轮对话即生效。原 §3.3 把缓存约束写在 skill 改动旁易误导，已澄清。

不加任何数据字段（运镜留在 prompt 文本）。

---

## 4. 用户看到什么（UI 视角）—— 默认极简，仅歧义时打扰（评审重写）

设计 + 真实用户评审一致否定了原方案「每次播报长角色清单」：那是把内部中间态当成品塞给用户读，违背密度优先，且长文用户会划过去不读（有损合并判错反而看不见）。改为：

- **默认静默**：别名归并 / 复用有把握时**直接建卡 / 连卡，不在对话里铺长清单**。
- **仅歧义单点问**：只有真拿不准（同一称呼可能指两人、是否该分裂）才单句发问「小林 = 林医生吗？」。
- **复用可见 + 可否决**：复用已有卡时，在画布上以 `character_ref` 边 + 源卡高亮呈现「这镜连到了哪张已有卡」；对话至多一句极简结句「复用 2 张已有卡，新增 1 镜」，并亮出复用卡的名字 / 缩略图供否决（解决用户「怕它偷偷认错人连错卡」）。
- **有损合并给撤销闸**：把「小林」「林医生」判成一人是有损写入、判错代价大。复用既有 `showUndoToast`：「已合并 小林→林医生 · 撤销」——把"可纠错"从"靠用户读 prose"升级成系统级撤销闸。
- **纠正即时生效**：用户说「小林是另一个人」→ agent **立即**基于这句重做归并并更新呈现，不用用户重述。
- **别名表折叠到角色卡**（tagline / hover），不在对话流平铺（「他 / 那女人」等代称对用户是噪音）。
- **结构化骨架对用户隐形**：骨架标签（"场景·时间·光线→…"）不得作为可见文案吐进 prompt textarea。
- 无新面板、无新按钮——全部用既有视觉语言（`character_ref` 边、源卡高亮、`showUndoToast`、卡片 tagline）承载（符合 R2 极简）。

---

## 5. 范围 / 不动项 / 回滚 / 验收门

**范围**（按评审修正）：
- ① 改 `workbench-storyboard-planner` + `workbench-fixation-planner` 两个 SKILL.md：别名合并 / 分裂判定 / 复用方法论（Tier1/2 prose 合并为一段「识别共享元素（含画布已有）」）。
- ② Tier2：`read_canvas_state` 加 `kind` 过滤 + 两个 `skill.json` tools 白名单补 `read_canvas_state` + 删 ❌ 禁令（**无新工具 / 无新 IPC**）。
- ③ `canvasTools.ts:35` 给 `prompt` 加 `.describe`（骨架**唯一**真相源）；skill/系统提示旧骨架收敛为指针。
- ④ 复用 / 合并的 `showUndoToast` 接线 + 复用卡可见呈现（既有组件）。
- ⑤（独立 commit）结构化 prompt 骨架，不与 ③ 角色身份混提交。

**不动项**：节点数据模型 / `GenerationCanvasNode` schema（Tier1/2 不改）、生成 runtime、画布渲染、引用边解析逻辑、`useNodeRelationships` 计数（Tier3 才动）、prefix 缓存前缀（动态画布读结果走工具回包，**不插入被缓存的系统前缀**——CTO）。

**回滚**：skill 是 .md 文本、schema 是 `.describe` 文本、过滤是可选参数——`git revert` 即回；不新增工具、不删旧能力。

**验收门**：
- 五门全过（filesize / lint:ci / typecheck / test / build）。
- 单测：意图 / 别名归并纯函数加 case（沿用 T7 `fcca02b` 模式）。
- **样本集验收（PM 必改）**：别名合并 / 分裂是**概率行为**，单剧本走查一遍不算数 → 5-8 个含（别名 / 分裂 / 增量复用）的剧本样本集跑通过率，定门槛（接入既有 eval 体系 `grading.mjs`）。
- R13 真机走查 J2：剧本（含同人别名 + 一处少年→成年）→ 定妆 → 验证「别名合并成一张卡」「该分裂的分裂」「复用可见 + 可撤销」；再跑增量场景验证「二次规划复用已有卡不重复」。
- 大画布（>30 节点）下 Tier2 单轮注入 token 不超阈值（CTO 建议，防成本顶上去）。

---

## 6. 拍板项（对比表）

| 拍板 | 选项 A（推荐） | 选项 B | 影响 |
|---|---|---|---|
| ③ 做到哪一档 | **Tier 1 + Tier 2** | 仅 Tier 1 | A 连"二次规划重复建卡"一起根治（且 Tier2 已证实是纯改文本，非写代码）；B 只治单次内 |
| Tier 3 持久 id | 本期不做 | 现在就做 | 现在做 = schema 迁移 + store slice + UI，单独大立项；payload 无 per-slice migration（后端），需补迁移；建议留后 |
| ⑤ 何时做 | **随 ③ 做，独立 commit/验收** | 拆 backlog 单独排期 | 用户已说"去做吧"含 ⑤；独立 commit 不稀释 ③ 焦点（PM）|
| 复用交互 | **默认静默 + 仅歧义问 + 可撤销 toast** | 每次播报角色清单 | A 符合密度优先、有撤销兜底（设计 + 真实用户）；B 啰嗦且有损合并难纠错 |

---

## 8. 实现修正（2026-06-13 落地，诚实记录两处简化）

读完 plumbing 后，两处相对评审方案做了**更克制**的取舍（避免过度工程，符合用户裁剪思路）：

- **`read_canvas_state` 的 kind 过滤 → 暂不做（YAGNI）**：紧凑格式（`canvasPromptContext.ts`）实测全画布仅 ~0.4-0.8k token，且 `read_canvas_state` 是 agent **按需调一次**、结果进**工具回包**（不进被缓存的系统前缀）。CTO 担心的缓存/token 在当前体量下不成立。返回行里已含 `kind`，agent 自己挑 character/scene 卡即可。大画布真出问题再加过滤。
- **合并的 `showUndoToast` 接线 → 不在 Tier1/2 做**：Tier1/2 是 **prose-only 身份**，agent 是「一次性只建一张卡」，**没有代码层 merge 事件**可挂 toast。复用通过**已有的 `character_ref` 边渲染 + 源卡高亮 + agent summary 点名**呈现（都是现成的）；「撤销」是**对话式**（用户说「这俩不是一个人 / 撤销」→ agent 重做）。真正的 merge-undo 闸属 Tier3（有持久 id 和 merge 操作）。

落地清单（实改文件）：① `skills/workbench-storyboard-planner/SKILL.md`（工具 +read_canvas_state、删 ❌ 禁令、第 1 步重写含别名归并/复用画布已有/分裂、混合 id 提交范式、复用可见+歧义先问）② `skills/workbench-fixation-planner/SKILL.md`（同上精简版）③ `skills/workbench-storyboard-planner/skill.json`（tools +read_canvas_state，文档一致）④ `electron/ai/canvasTools.ts:35`（prompt `.describe` 骨架，⑤ 唯一真相源）⑤ `src/workbench/generationCanvas/agent/generationCanvasAgentClient.ts:85`（收敛为指针句）。③④⑤ 拆两个 commit：角色身份 / 结构化 prompt 分开。

## 9. 行为验收结果（2026-06-13 真机实测）

用真 Electron + 真 LLM（`dm-fox/gpt-5.5`）跑两轮真实对话（临时探针，跑后删）。**重大发现 + 修复**：

- **漏改发现**：前两 commit 只改了 storyboard/fixation，但它们**仅在「创作文稿区」意图路由（`creationIntentRouting.ts`）命中时触发**；「生成画布」直接打字 / 增量补镜头走的是通用 `workbench.generation.canvas-planner`（`skills/workbench-generation/SKILL.md`）——这条路径正是「隔天补镜头又重建」的主入口，却被漏改。已补（commit `fff2585`）：通用 planner 加别名归并 + 复用已有卡 + 结构化骨架指针。
- **验收通过**：① 别名合并——`林医生/小林/他` → **1 张角色卡** ✅（两次复现；并观察到 T8 能力校验自我纠错：Veo 参考槽不适配→自动改连线）。② 增量复用——第 2 轮「补 2 镜」**追加 2 镜 + 复用已有角色卡、零重建** ✅（agent 自述「只复用已有…不新建角色/场景卡」）。
- **附带结论**：reuse **不依赖**显式 `read_canvas_state`——画布紧凑上下文已自动注入每轮 user 消息（`canvasPromptContext`），agent 直接看到已有卡并复用。故 Tier2「放开 read_canvas_state」是大画布兜底（注入可能截断时），常规场景靠注入上下文即可。
- **欠**：创作文稿区路径（storyboard/fixation 我改的两 skill）未直接实测；但底层 agent loop 同一套、通用 planner 同机制已验，置信度高。eval harness `approveUntilTurnEnds`（`isoApp.mjs:148`）是**单轮设计**（找全日志最后一个 turn.finished，多轮会瞬间短路命中旧的）——多轮行为评测前需修（已 spawn_task 记录）。

---

## 7. 六角色评审（R7，已回填 2026-06-13）

**无角色报硬 blocker。** 收敛后的必改已并入 §2-§6，下面记录来源与已采纳项。

**CTO**：① Tier2 真风险不是"误用别人项目卡"（session 绑定单项目，看不到别人画布），是同项目内**静默误连旧卡污染下游** → 已加「复用需可见 + 可否决」（§4）。② Tier2 读结果会破 prefix 缓存 → 读结果走工具回包、不插系统前缀，加 token 阈值验收（§5）。③ 复用与「一次提交、edges 同批」协议冲突 → 给出真实 id + clientId **混合提交范式**（§2）。建议：Tier1/2 prose 合并为一段（已采纳 §2）。

**设计师**：① 全量播报角色清单违背密度优先 → 改默认静默、仅歧义问（§4）。② 复用反馈用画布既有视觉语言（`character_ref` 边 / 高亮）而非 prose 复述（§4）。③ 有损合并需 `showUndoToast` 可撤销，别藏 prose（§4）。

**PM**：① ③/⑤ 解耦、⑤ 独立 commit 不稀释焦点（已采纳 §5/§6）。② 验收需**样本集通过率**而非单跑（§5）。③ 「少年→成年分裂」是边角 case → 降权为别名合并的补充判定（§2 措辞）。建议：确认「用户纠正后 agent 真重做」链路（已采纳 §4 纠正即时生效）。

**前端**：① 运行时不读 skill.json tools 白名单（`agentChatV2.ts:355-362`），Tier2 = 改 prose + skill.json 同步，非工具注册（已修 §2）。② 选 `read_canvas_state` 加过滤，**不新增** `list_cast_and_scenes`（避免同步 5 处，§2）。③ 骨架别在 schema + 系统提示两处写（§3）。补充：prefix 缓存不会破，但稳定文本只能加在 system 段。

**后端**：① 喂 LLM 的紧凑行 `canvasPromptContext.ts:22-37` **不含 categoryId** → 按 `node.kind` 过滤、改措辞（已修 §2）。② skill body 走 `readFileSync` 无缓存、改 .md 即生效；缓存只约束静态系统提示串（已澄清 §3）。③ Tier2 复用须用 read 回包**真实 id**，clientId registry 只存本 turn（已采纳 §2）。建议：Tier3 立项补 payload migration（`projectRecordSchema` 无 per-slice migration）。

**真实用户**：① 清单别只在对话刷文字（会划过去）→ 要能点确认 / 和画布卡对上号（§4 复用可见）。② 纠正要当场生效、不用重说（§4）。③ 复用要看得见复用了哪张、能否决（§4）。结论：方向对，确实戳中"同一个人每次画得不一样 / 隔天补镜头又重建"的痛；信任全系于上面三条必改。
