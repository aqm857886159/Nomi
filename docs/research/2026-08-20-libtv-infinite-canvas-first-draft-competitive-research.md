# LibTV、Infinite Canvas 与“一句话出完整初稿”产品调研

> 日期：2026-08-20  
> 目的：把 `libtv-labs/libtv-skills`、`basketikun/infinite-canvas` 和同类“一句话 → 完整初稿”产品拆成真实流程，确认 MCP 边界，并提炼 Nomi 可以复用的通用机制。  
> 证据口径：优先官方仓库、源码、帮助中心和官方 MCP 验证文档；没有创建付费账号或消耗生成额度，因此“真实体验”分为“官方可执行路径”和“用户公开反馈”，不把营销文案当成已实测质量。

## 1. 结论先行

这几个样本其实不是同一种产品：

| 样本 | 真正解决的层 | 用户得到的感觉 | 主要代价 |
|---|---|---|---|
| LibTV Skill | 把自然语言交给后端 Agent，异步拿回图片/视频 | 最像“我说一句，后台替我做” | 中间计划、模型选择、实际 prompt 和项目状态大多不可见 |
| Infinite Canvas | 把创作过程变成可读、可编辑、可重试的画布操作图 | 最像“我能看见并改每一步” | 需要配置 API；不是一键成片；本地直连有 CORS、持久化和远端 URL 摩擦 |
| LTX Studio | script → scene → shot/storyboard → timeline 的视频工作台 | 先定方向，再逐镜头控制 | 学习和编辑成本更高，完整工作区偏桌面、持续生成需要额度 |
| InVideo AI | 对话 Agent 编排脚本、素材、配音、字幕和镜头 | 首稿快，之后继续聊天或局部改 | 多模型路由和自动生成会带来成本、审批与不可预测性 |
| Gamma / Canva | 把自然语言编译成可选候选，再落成可编辑文档/设计 | “先给我一版可改的东西” | 更适合卡片/设计，不等于视频连续性 |

我的判断：**Nomi 不应该在“更会把一句话扩成长 prompt”上竞争，而要把“计划 → 可检查中间层 → 生成请求 → 审片/局部修补”做成一条不丢字段的编译链。**

这正好对应此前对 Nomi 的代码审查：当前真正的断点不是缺少 `ffDesc`、`lfDesc`、`variationType` 这些字段，而是它们从计划进入普通 storyboard→canvas video node 时会蒸发，导致“测试绿、真实生成没带上”。

## 2. LibTV Skill：一键入口背后的真实机制

### 2.1 已安装和实际形态

已执行：

```bash
npx skills add libtv-labs/libtv-skills
```

安装结果：`.agents/skills/libtv-skill`。Skill 本身不是 MCP Server，而是一组供 Agent 调用的 Python 脚本，包装 LibTV 的 Agent-IM OpenAPI：

- `create_session.py`：创建/复用 session，并发送自然语言消息。
- `query_session.py`：按 `sessionId` 查询消息，支持 `--after-seq` 增量轮询。
- `change_project.py`：切换当前 accessKey 绑定的项目。
- `upload_file.py`：把图片/视频上传到 OSS，返回可引用 URL。
- `download_results.py`：从会话消息抽取图片/视频并下载到本地。

官方仓库把它定义为面向 Agent 的 LibTV OpenAPI 技能包，而不是一个能读取/修改画布节点的细粒度工作流 API：[libtv-skills README](https://github.com/libtv-labs/libtv-skills)、[Skill 定义](https://github.com/libtv-labs/libtv-skills/blob/main/skills/libtv-skill/SKILL.md)。

### 2.2 用户实际走的链路

```text
用户一句自然语言
  ↓
Agent 原样转发 message
  ↓
POST /openapi/session
  ↓
拿到 sessionId + projectUuid
  ↓
后端 Agent 自己理解任务、拆剧本/分镜、选模型、生成素材
  ↓
每 8 秒 GET /openapi/session/:sessionId（afterSeq 增量）
  ↓
assistant 消息出现结果 URL
  ↓
download_results.py 下载到本地
  ↓
展示结果 URL + projectUrl
```

Skill 的核心纪律是“用户侧不做创作，只做传话”：不替用户扩写 prompt、不自行拆镜头、不把一部短剧拆成多次独立请求。这个选择非常适合“快速试一次”，也解释了为什么它能把“做一个短剧 / MV / TVC”压缩成一个入口。

### 2.3 它所谓“一句话出完整初稿”到底是什么

从 Skill 声明看，后端 Agent 覆盖“剧本 → 分镜 → 成片”、视频复刻、MV、产品展示片等复杂创作。**但公开 API 层只保证 session、消息、上传、下载；没有公开结构化 storyboard、资产版本、镜头 patch 或项目列表接口。**

所以它的产品承诺更接近：

> 一句话触发一个黑盒制作任务，最终给你一组结果和一个画布入口。

它不是：

> 一句话生成后，把每一镜的角色、首尾帧、镜头运动、模型参数都作为稳定的可编辑对象交给你。

### 2.4 真实反馈暴露的边界

公开 Issue 比营销页更能说明使用摩擦：

- **项目状态不透明、容易误烧额度。** Issue #10 记录了一次 15 分钟、14 场景、63 镜头的尝试，用户称 `change_project.py` 反复创建项目，误生成了 43 个项目；当时没有列出项目、查看详情、重命名、删除空项目或迁移素材的接口：[Issue #10](https://github.com/libtv-labs/libtv-skills/issues/10)。
- **后端重写 prompt，但用户看不到真实请求。** Issue #12 给出了同一 session 的对账：后端会修正拼写、丢掉模型名、补入“polished square avatar”“appealing stylized character design”等未请求的风格词；用户希望 raw mode、dry-run 或至少返回 resolved prompt：[Issue #12](https://github.com/libtv-labs/libtv-skills/issues/12)。
- **Agent 只能下达模糊任务，无法细致创建节点/设置条目。** 这正是 Issue #8 的诉求：[Issue #8](https://github.com/libtv-labs/libtv-skills/issues/8)。
- **模型和一致性控制不足。** Issue 列表里有“不能选择模型等更细颗粒控制，感觉不能很好控制一致性”的反馈；这说明“后端自动选模型”在简单任务上省心，在跨镜和可复现任务上会变成黑盒成本。[Issue 列表](https://github.com/libtv-labs/libtv-skills/issues)。

### 2.5 对 Nomi 的启示

LibTV 的长处不是流程透明，而是把复杂编排藏起来，让用户先看到结果。Nomi 可以借它的**入口体验**，不能照搬它的**黑盒状态**：

1. 用户仍然可以只说一句话；
2. 系统后台生成 `Intent / Outline / AssetBank / ShotPlan`；
3. 生成前给一个低成本预览和预算/波次确认；
4. 每一镜的实际 prompt、参考图、模型和状态都可追溯；
5. 失败时可以只 patch 某一镜，而不是重新提交整部作品。

## 3. Infinite Canvas：它有 MCP，但 MCP 不是“视频导演 Agent”

### 3.1 产品定位

`basketikun/infinite-canvas` 是一个面向 AI 创作的开源无限画布工作台：画布节点、文本/图片/视频/音频生成、参考图编辑、提示词库、素材库和本地 Canvas Agent。README 明确说 API key、画布、素材和生成记录默认放在浏览器本地，前端直接请求 OpenAI-compatible endpoint：[README](https://github.com/basketikun/infinite-canvas#readme)、[Features](https://github.com/basketikun/infinite-canvas/blob/main/docs/content/docs/overview/features.mdx)。

它的中心对象不是“成片”，而是**一张可以继续探索的创作图**。

### 3.2 不用 MCP 时的推荐工作流

官方节点手册给出的最小路径是：

```text
创建 text node：写初始想法
  ↓
在节点下方请求 AI refine
  ↓
生成右侧 rewritten node，原节点保留
  ↓
选择满意的 text node → Generate Image
  ↓
自动创建 generation config node 并连线
  ↓
异步生成一张/多张图
  ↓
在 config node 调模型、比例、质量、张数并 retry
```

节点手册还规定了几个重要语义：

- 已有文本节点重写时，原文不被覆盖，而是生成一个连接结果节点；
- `@` 可以引用上游图片、文字、视频或音频，图片会自动编号后作为多模态输入；
- 生成节点保存 prompt、模型、尺寸、质量、张数和引用，retry 依赖这些 metadata；
- 视频节点既可以从空节点生成，也可以由文本、图片或 config 节点连入后生成；视频走 OpenAI-style `/v1/videos` 的异步流程。

证据：[Canvas Node Guide](https://github.com/basketikun/infinite-canvas/blob/main/docs/content/docs/canvas/canvas-node-manual.mdx)。

这已经比 Nomi 当前的“计划字段可能在 converter 里丢失”更接近一个可审计 IR：**意图节点 → 配置节点 → 结果节点，连线就是依赖，metadata 是重试契约。**

### 3.3 MCP 是否存在：确认有，而且是本地桥接

它不是一个云端 MCP。官方实现是：

```text
Codex / Claude Code
  ↓ stdio MCP: npx -y @basketikun/canvas-agent mcp
canvas-agent MCP server (@modelcontextprotocol/sdk)
  ↓ POST /api/tools + token
127.0.0.1:17371 Canvas Agent HTTP/SSE
  ↓ SSE tool_call
浏览器 Infinite Canvas
  ↓
Zustand/React 画布状态、生成队列、节点 metadata
```

关键证据：

- `canvas-agent/src/index.ts` 根据参数启动 HTTP 或 MCP；[source](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/src/index.ts)。
- `canvas-agent/src/server/mcp.ts` 用官方 `@modelcontextprotocol/sdk` 注册工具，再把调用转发到本地 `/api/tools`；[source](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/src/server/mcp.ts)。
- 本地 Agent 默认只监听 `127.0.0.1`，随机 token，并在首次连接后绑定网页 Origin；[Canvas Agent README](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/README.md)。
- Codex 插件的 MCP 命令是 `npx -y @basketikun/canvas-agent mcp`，启动超时 20 秒、工具超时 90 秒；[plugin manifest](https://raw.githubusercontent.com/basketikun/infinite-canvas/main/plugins/infinite-canvas/.mcp.json)。

### 3.4 MCP 工具是什么颗粒度

官方 schema 已经不是“一次生成”一个工具，而是一套画布操作 API，包含：

- 读取：`canvas_list_projects`、`canvas_get_state`、`canvas_get_selection`、`canvas_export_snapshot`；
- 节点：创建/更新/删除/移动/缩放/选择/连接；
- 流程：`canvas_create_generation_flow`、`canvas_create_image_prompt_flow`、`canvas_generate_text/image/video/audio`；
- 任务：`canvas_run_generation`、`generation_get_status`；
- 工作台：图片/视频工作台配置和生成；
- 资产/提示词：`prompts_search`、`assets_list`、`assets_add`。

完整 schema：[canvas-agent/src/canvas/schemas.ts](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/src/canvas/schemas.ts)。

其中 `canvas_create_generation_flow` 的输入就包含 `prompt`、`mode`、`referenceNodeIds`、`model`、`size`、`count`、`seconds` 等；它会把 prompt/config/reference 节点和连接一起创建，而不是只把一段文字丢给后端。

### 3.5 它如何处理“自动化会不会乱改画布”

插件 Skill 明确规定：

1. 操作前先 `canvas_get_state`；用户提到“选中的这个”时先 `canvas_get_selection`；
2. 写操作用批量 ops；
3. 写入画布由网页侧边栏二次确认；
4. 生成节点、配置节点和提示词节点保持结构清晰，方便继续编辑。

这不是装饰性确认，而是**把 Agent 的意图和用户的不可逆成本分开**。它允许 Agent 批量计划，又不让 Agent 无声地改掉用户当前画布。[Canvas skill](https://github.com/basketikun/infinite-canvas/blob/main/plugins/infinite-canvas/skills/canvas/SKILL.md)。

### 3.6 真实体验与限制

官方 Issue 暴露了它目前没有解决的真实摩擦：

- 用户请求直接复制视频首帧/尾帧做连续镜头，说明首尾帧接力仍是缺口：[Issue #189](https://github.com/basketikun/infinite-canvas/issues/189)。
- Seedance/火山方舟要求 `reference_video` 是 web URL，而浏览器上传得到 base64，暴露本地素材到模型远端输入的桥接问题：[Issue #154](https://github.com/basketikun/infinite-canvas/issues/154)。
- 浏览器直连第三方接口会撞 CORS；README 也明确 API key 在浏览器本地：[Issue #190](https://github.com/basketikun/infinite-canvas/issues/190)。
- 用户要求观测实际发给模型的内容和 token 消耗，说明 prompt/request 可观测性还不够：[Issue #186](https://github.com/basketikun/infinite-canvas/issues/186)。
- NAS/Docker 用户希望把项目、素材和生成记录持久化到挂载卷；当前产品仍是 frontend-first、本地存储优先：[Issue #159](https://github.com/basketikun/infinite-canvas/issues/159)。

所以它给 Nomi 的借鉴是“IR + 操作协议 + 确认桥”，不是“把 Nomi 变成无限画布”。它更适合图片/单镜头探索；官方没有把它做成完整 storyboard→波次→QA→时间轴生产管线。

## 4. “一句话 → 完整初稿”同类产品：共同结构

### 4.1 LTX Studio：把视频做成可编辑的 script/scene/shot/timeline

官方流程是 prompt、图片或剧本进入 workspace，用户先定义角色、地点、视觉风格和比例，再生成场景/分镜/视频，最后在 storyboard/timeline 中调时长、镜头、效果、配音、字幕和画幅。LTX 还提供 text-to-video、image-to-video、audio-to-video、retake、extend 等 API，但官方帮助明确 Platform/Studio 与 API 是不同层，不能把模型 API 当作项目编排 API：[AI Video Generator](https://ltx.studio/platform/ai-video-generator)、[Platform 与 API 边界](https://support.ltx.studio/hc/en-us/articles/32487503247122)。

真实摩擦也很明确：完整 workspace 偏桌面浏览器，免费账号 credits 有限，持续生成和商业使用需要进一步付费/授权。它换来的是真正的逐镜控制和角色/道具/品牌元素一致性。

**可借鉴点：** Nomi 的 `StoryOutline → AssetBank → ShotPlan → Timeline` 方向是对的，但每一层必须是用户能回看的对象，而不是只存在于 Agent 上下文。

### 4.2 InVideo AI：Agent 编排，但把“首稿”定位成 draft

InVideo 的官方文档描述的是 back-and-forth Agent：从 idea/script/scene 出发，Agent 写脚本、做 storyboard、生成每个镜头、配 voiceover、字幕和音乐；Autopilot 可以单次生成，但也可以在 prompt 页面继续对话。生成后用户可通过章节、脚本、媒体、音乐、字幕和 voiceover 的编辑入口局部修改。

它还有一个很接近 Nomi 的 Vision storyboard 流程：把 prompt 和参考图变成固定的 3×3/9-shot storyboard，先锁 character、lighting、art direction，再从某一帧提取 standalone image 或直接送进视频，避免整板重生：[Creating storyboards](https://help.invideo.io/en/articles/14754413-creating-storyboards-with-invideo)。

更重要的是成本闸门：Agent 可以按每次回复同时产生 briefing、图像、视频、配音等任务并扣 credits；用户可以选择“生成前询问”，审批卡片显示 prompt、model、duration、aspect ratio，并能修改后再批准：[Agent credits/approval](https://help.invideo.io/en/articles/14718313-how-are-credits-charged-when-using-ai-agents)。

**可借鉴点：** 把“一句话”拆成“先给方向草稿 → 用户确认 → 再生成贵的镜头”，并允许“单帧修补 → 单帧进 I2V”。

### 4.3 Gamma：outline 先于生成，MCP 创建强、编辑弱

Gamma 的 Generate/Agent 流程先把 topic、文件、URL 等编译成 outline/cards。Agent 会先问 smart questions、和用户共同塑形 outline，只有用户点击 Generate 后才落成 presentation/document/webpage。生成后在 App 内用 Sparkle 和手动编辑修改；Gamma MCP 能创建内容、浏览主题、组织文件，但官方明确 MCP 不能编辑已有 Gamma，既有内容编辑仍回到 App：[Agent creation](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)、[Generate/API](https://developers.gamma.app/generations)、[MCP](https://developers.gamma.app/mcp)。

Gamma API 还把“要写进页面的 inputText”和“结构、主题、文本密度”等生成策略分开，提醒不要把“如何生成”塞进内容字段。这是 Nomi 的 plan/request 分层的直接类比。

### 4.4 Canva：候选设计 + editing transaction

Canva Magic Design 先根据几词 prompt 生成候选设计/模板，用户选一个后进入编辑器。更值得借的是官方 MCP 验证流程：

```text
search-designs
  ↓
generate-design（返回候选）
  ↓
create-design-from-candidate（用户选候选）
  ↓
start-editing-transaction
  ↓
perform-editing-operations（草稿 patch）
  ↓
commit-editing-transaction
  ↓
export-design
```

文档明确要求：不能自动替用户选候选；没有 commit 不能声称已保存；编辑应走 patch/transaction，不应整份 regenerate：[Canva MCP](https://www.canva.dev/docs/mcp/)、[MCP 验证闭环](https://www.canva.dev/docs/mcp/verify-integration/)。

## 5. 统一拆解：成熟产品都在做的五件事

### 5.1 一句话只是入口，不是内部数据结构

成熟产品会把一句话编译成至少一层中间对象：

```text
用户意图
  → outline / script
  → assets / characters / locations / visual language
  → shot or card plan
  → generation jobs
  → review findings
  → patch plan
  → timeline / export
```

直接把一句话扩成长 prompt 的方法，在短期 demo 上很顺，但会丢失“这句话里的哪个事实属于角色、哪个属于镜头、哪个属于输出格式”。

### 5.2 首稿必须是“可编辑草稿”，不是最终成片

LTX、InVideo、Gamma、Canva 都把首次结果设计成方向确认或 draft：先选 storyboard/候选/outline/风格，再投入昂贵生成。用户真正需要的是“可继续修改的一版”，不是“模型自认为完成的一版”。

### 5.3 局部 patch 比整篇 regenerate 更接近真实工作

Canva 用 transaction，InVideo 用章节/单帧提取，LTX 用 shot/timeline 控制。Nomi 如果某一镜角色漂移，正确动作应是“替换该镜参考、修正该镜 prompt、重跑该镜”，而不是把整个 episode 从头烧一遍。

### 5.4 参考图是有职责的输入，不是“多放几张图”

角色身份、场景拓扑、道具形态、上一镜尾帧分别是不同参考职责。Infinite Canvas 的 `referenceNodeIds` 和 `@[node:id]` 解决的是“引用关系”，Nomi 还要继续向前一步，给引用加类型：`character_anchor`、`location_anchor`、`prop_anchor`、`last_frame`。

### 5.5 自动化必须有状态、预算和确认

InVideo 的审批卡片、Infinite Canvas 的网页二次确认、Canva 的 commit transaction，解决的都是同一个问题：Agent 可以替用户准备动作，但不应该无声地消耗额度或覆盖创作状态。Nomi 已经有 freeze gate 和生产波次概念，应把它们提到一等 UX，而不是只藏在后端。

## 6. 对 Nomi 的具体落点

### P0：先修“信息守恒”，不先加更多 prompt

建议把当前计划编译成一个明确的可对账 IR：

```text
ProjectIntent
  → StoryOutline
  → AssetBank（assetId / assetVersion / role）
  → ShotPlan
       ffDesc / motionDesc / lfDesc
       camera / variationType / camIdx
       references[]（角色、场景、道具、尾帧）
       continuity（继承哪个 stateId）
  → GenerationJob
       provider / model / requestPayload / sourceFields
  → ReviewFinding
  → PatchPlan
  → Timeline / Export
```

每次编译都做字段对账：

```text
计划字段集合 - 节点字段集合 - 生成请求字段集合 = 空集
```

如果某字段被有意丢弃，必须记录原因；不能“converter 里没用到所以自然消失”。这正是当前 storyboard converter 的根因。

### P0：把三类入口统一到同一套编译器

现在至少有：

1. GUI storyboard → canvas node；
2. 直接 `nomi_generate` / MCP → headless generation；
3. production run → durable wave/QA/export。

它们不应该各自拼一套 prompt。应该共享：

- 一个 `ShotPlan → GenerationRequest` 编译器；
- 一个 request fingerprint；
- 一个字段守恒审计结果；
- 一个状态机：planned / approved / queued / generating / review / accepted / patching / exported。

这样才能避免“headless 路已经支持 ff/lf，GUI 路却丢了”的双轨分叉。

### P1：引入“方向确认”而非“全量表单确认”

用户不想先填 20 个字段。可以采用三张轻量卡：

1. **故事方向**：一句话、受众、时长/画幅；
2. **视觉锁定**：角色/场景/风格参考图；
3. **首稿预览**：outline + 关键帧/九宫格 + 预计镜头数/额度。

用户只需要确认“这是不是我要的方向”，确认后才进入贵的 I2V 波次。

### P1：参考输入显式标注职责

不要只显示“参考图 1/2/3”。显示：

```text
小林-角色定版图（身份锚）
便利店-场景定版图（空间锚）
shot-03-tail（上一镜尾帧）
```

这借了 Infinite Canvas 的显式 node reference，又补上 Nomi 所需的连续性语义。

### P1：把“局部修补”做成一等动作

至少支持：

- 只重写一个镜头的 motion prompt；
- 只替换一个镜头的首帧/尾帧；
- 只换角色/场景引用；
- 从某个合格尾帧复制为下一镜首帧候选；
- 保留原版本，生成 patch version，能比较并回滚。

### P2：建立统一可观测性

每个镜头要能回答：

- 用户写了什么；
- Agent 改写了什么；
- 最终发给模型的是什么；
- 带了哪些参考、各自职责是什么；
- 用了哪个模型和参数；
- 花了多少额度/时间；
- QA 哪个维度失败；
- 下一次重试只改了什么。

这同时回应 LibTV Issue #12 和 Infinite Canvas Issue #186 的真实诉求。

## 7. 不建议照搬的东西

- 不要照搬 LibTV 的“后端全自动、前端只传话”：它适合快速出结果，不适合 Nomi 的跨镜一致性和可复现生产。
- 不要照搬 Infinite Canvas 的“节点连线就是完整工作流”：它适合探索和单镜头编排，不能替代 Nomi 的 storyboard、连续性、波次、QA、时间轴和导出。
- 不要把 MCP 工具数量当成产品能力。真正有价值的是“读取快照 → 生成结构化 ops → 用户确认 → 执行 → 回写状态”。
- 不要把更多参考图等同于更多一致性。参考图必须有职责、版本和继承关系，否则只是让模型更难分辨谁是谁。
- 不要把“一句话出片”当成“无需中间层”。成熟产品的秘密恰好是把中间层做成用户看得懂、能确认、能 patch 的对象。

## 8. 最终建议

Nomi 的通用产品骨架可以定成：

```text
一句话入口
  ↓
自动生成可读的故事/资产/镜头草稿
  ↓（用户只确认方向、参考职责和预算）
冻结版本与连续性状态
  ↓
编译成字段守恒的 GenerationJobs
  ↓
按波次生成首帧/尾帧/I2V
  ↓
静态审片 + 视频审片
  ↓
按镜头 patch，不整篇重生
  ↓
时间轴预览与导出
```

一句话总结：**借 LibTV 的低摩擦入口，借 Infinite Canvas 的可读 IR/MCP/确认桥，借 LTX/InVideo 的 storyboard 与逐镜修补，借 Gamma/Canva 的候选确认与 transaction；但 Nomi 的核心差异要放在跨镜状态传播和“计划字段绝不蒸发”。**

## 9. 主要来源

- [libtv-labs/libtv-skills](https://github.com/libtv-labs/libtv-skills)
- [LibTV Skill definition](https://github.com/libtv-labs/libtv-skills/blob/main/skills/libtv-skill/SKILL.md)
- [LibTV Issue #10：项目管理 API](https://github.com/libtv-labs/libtv-skills/issues/10)
- [LibTV Issue #12：raw/resolved prompt](https://github.com/libtv-labs/libtv-skills/issues/12)
- [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)
- [Infinite Canvas Features](https://github.com/basketikun/infinite-canvas/blob/main/docs/content/docs/overview/features.mdx)
- [Infinite Canvas Canvas Node Guide](https://github.com/basketikun/infinite-canvas/blob/main/docs/content/docs/canvas/canvas-node-manual.mdx)
- [Canvas Agent README / MCP](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/README.md)
- [Canvas MCP schemas](https://github.com/basketikun/infinite-canvas/blob/main/canvas-agent/src/canvas/schemas.ts)
- [Infinite Canvas Canvas skill](https://github.com/basketikun/infinite-canvas/blob/main/plugins/infinite-canvas/skills/canvas/SKILL.md)
- [LTX Studio AI Video Generator](https://ltx.studio/platform/ai-video-generator)
- [LTX Studio Platform/API boundary](https://support.ltx.studio/hc/en-us/articles/32487503247122)
- [InVideo AI filmmaking](https://help.invideo.io/en/articles/14717491-get-started-with-ai-filmmaking)
- [InVideo storyboard workflow](https://help.invideo.io/en/articles/14754413-creating-storyboards-with-invideo)
- [InVideo Agent credits and approval](https://help.invideo.io/en/articles/14718313-how-are-credits-charged-when-using-ai-agents)
- [InVideo hosted MCP](https://help.invideo.io/en/articles/11316042-invideo-model-context-protocol-server)
- [Gamma Agent creation](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)
- [Gamma MCP](https://developers.gamma.app/mcp)
- [Canva MCP](https://www.canva.dev/docs/mcp/)
- [Canva MCP verification flow](https://www.canva.dev/docs/mcp/verify-integration/)
