# 02 · 2026 `llms.txt` 事实复核、GEO 一手调研与 30 问真实基线

> 测评日期：2026-11-24
> 目的：① 复核 `docs/seo/README.md`「不做 `llms.txt`」在 2026 年是否仍然成立；② 基于 2025–2026 官方文档与实证研究沉淀 GEO 决策依据；③ 建立固定的中英各 15 问（共 30 问）创作者真实搜索/提问基线，量化当前 `nomiaqm.com` 与 `github.com/aqm857886159/Nomi` 的可见度。

---

## 一、2026 年 `llms.txt` 一手事实复核与决策建议

### 1. 各大 AI 引擎官方态度核查（截至 2026 年 11 月）

| 平台 / 引擎 | 2025–2026 官方文档与公开表态 | 是否用于联网搜索 / 排名 / 引用发现？ | 出处 |
|---|---|---|---|
| **Google Search / AI Overviews / AI Mode** | Google Search Central 明确声明 Google 搜索与 AI Overviews 完全走 Googlebot 核心索引与结构化数据，**不读取、不计入 `llms.txt`**；Google Search Advocate **John Mueller** 在 2025–2026 年多次公开指出“目前没有任何主流搜索 AI 系统使用 `llms.txt` 做发现”，并将其类比为早年无效的 `<meta name="keywords">`。 | **否（完全忽略）** | Google Search Central《AI features and your website》(2025–2026)；Search Engine Land / Search Engine Roundtable 对 John Mueller 声明的记录 |
| **OpenAI / ChatGPT Search** | OpenAI 官方爬虫文档（`platform.openai.com/docs/bots`）只定义 `OAI-SearchBot`（搜索索引）、`GPTBot`（训练）与 `ChatGPT-User`（用户触发实时浏览）及标准 `robots.txt` 控制，**未列出或消费外部站点的 `llms.txt`**；第三方服务器日志实证追踪也显示 `OAI-SearchBot` 高频请求 `robots.txt` 与 HTML，几乎不主动探测 `/llms.txt`。 | **否（未接入搜索发现）** | OpenAI Platform Docs — *Overview of OpenAI Crawlers* (`platform.openai.com/docs/bots`) |
| **Anthropic / Claude Search** | Anthropic 在自家开发者 API 文档站提供了 `llms.txt` 方便程序员喂给 IDE，但 Claude 联网检索与 `ClaudeBot` 官方说明中**不解析外部网站的 `/llms.txt` 作为搜索排名或引用源**。 | **否（仅自家开发文档提供，搜索不消费）** | Anthropic Crawler / Search 说明；行业日志对比审计 |
| **Perplexity (`PerplexityBot`)** | Perplexity 依赖实时 Web 搜索索引、HTML 正文解析与标准 `robots.txt`，官方从未声明消费 `llms.txt`。 | **否** | PerplexityBot 官方爬虫说明与行业实测 |

### 2. 结论与推荐决策：**维持「不做全站 SEO 型 `llms.txt`」（Keep Skipping），把精力 100% 投在真 HTML 直答与实体一致性上**

- **为什么原决定（`docs/seo/README.md`）仍然正确**：我们的目标是让创作者在搜「AI 视频分镜工具 / Seedance 2.5 多镜头怎么拍 / 本地优先 AI 视频工作台」时，ChatGPT、Perplexity、Google AI 概览、豆包、Kimi 能**主动发现并引用 Nomi**。`llms.txt` 只在「用户已经知道你的网址并手动把 URL 喂给 Cursor/编程助手」时省一点 token，对**未知用户的搜索发现（Discovery）与引用权重贡献为 0**；多养一份并行 Markdown 摘要反而违背 P1（一份事实两处维护、容易漂移）。
- **唯一例外（无需现在做）**：未来若单独给 MCP 开发者写 API 速查，那属于开发文档附件，不属于官网 GEO。现阶段**建议继续不做 `llms.txt`**。

---

## 二、★0 先查别人：2025–2026 高信号 GEO 实证研究与官方文档（≥4 条）

1. **Google Search Central 官方文档 ·《AI features and your website (AI Overviews & AI Mode)》（`https://developers.google.com/search/docs/appearance/ai-features`，2025–2026）**
   - **它怎么做**：说明 AI Overviews 与 AI Mode 采用 **Query Fan-Out（查询扇出）**——把用户的复杂问题拆成多条子查询并发检索核心索引，优先抽取具备清晰 HTTP 200 可抓取性、页面可见文字与 Schema.org 结构化数据（`SoftwareApplication`、`FAQPage` 等）严格一致、且带原创多模态证据（真实截图/视频带准确 `alt`）的页面，无需任何私有 AI 标签。
   - **对我们哪个决定有影响**：**确认并改了两个决定**——① 确认不搞隐藏文本或 `llms.txt`；② **改变了我们对 `seo:audit` 现存 52 条错误的优先级**：必须修掉库索引页缺失 `WebPage` JSON-LD（32 处）和 `/docs` 缺失 OG 图（12 处），并在每个模型页/功能页首段放 1–2 句可直接抽取的事实定义，承接 Query Fan-Out 的子问题（如「Seedance 2.5 样片模式怎么转 1080p」「自带 API Key 视频工作台」）。

2. **OpenAI 官方爬虫规范 ·《Overview of OpenAI Crawlers》（`https://platform.openai.com/docs/bots`，2025–2026）**
   - **它怎么做**：将搜索引用爬虫 `OAI-SearchBot`、训练爬虫 `GPTBot`、用户实时点击/浏览代理 `ChatGPT-User` 拆成完全独立的 `robots.txt` token，明确指出若 `OAI-SearchBot` 被 `robots.txt` 或防火墙 `403` 拦截，站点将无法作为引用内容出现在 ChatGPT Search 回答中；变更生效周期约 24 小时。
   - **对我们哪个决定有影响**：**改了 `marketing/robots.txt` 与 Cloudflare 策略**——不仅保留 `User-agent: * Allow: /`，还在生成器里显式列出 `OAI-SearchBot`、`GPTBot`、`ChatGPT-User`、`PerplexityBot`、`ClaudeBot`、`Google-Extended`、`Bingbot`、`Googlebot` 全部 `Allow: /`（带回归单测锁死），同时在 Cloudflare 关掉会误杀机房检索器的 Bot Fight Mode。

3. **CapstonAI 2026 大规模实证研究 ·《Entity Clarity vs. Site-Wide Consistency in Generative Engines》（990 个查询 × 4,755 个页面 × 922 个域名，2026）& Geo-Citation-Lab（Zhang, He & Yao, 2026）**
   - **它怎么做**：实证区分了生成式引擎的「检索入选（Selection）」与「语法吸收引用（Absorption）」两步——发现**首屏实体清晰度（Entity Clarity：一句话说清“我是谁、属于哪个品类、支持哪些具体版本/模型/系统”）决定能不能入选候选集**，而全站跨页面事实一致（版本号、支持模型列表、许可协议不自相矛盾）决定长期引用稳定性；单纯把正文硬拆成低信息密度的伪 Q&A 并不会提升大模型吸收率。
   - **对我们哪个决定有影响**：**改了首页与模型页的首屏文案结构**——放弃只有口号式的泛标题（「商业级体验，模型按原价」对不认识 Nomi 的大模型缺乏品类锚点），在保留产品主张的同时，首屏直接给出高密度可核对事实摘要块（开源 AGPL-3.0、macOS/Windows 本地优先 AI 视频创作工作台、覆盖文稿→分镜→画布→时间轴、内置接入 Seedance 2.5 / Seedream 5.5 / Kling 4.0 Flash / MiniMax H3 Max 及本地 ComfyUI 与 24 个 MCP 工具，并标注数据更新日期）。

4. **多引擎引用源分布实证（Moz / Ahrefs / Muck Rack / Chen et al. 2025–2026 跨平台追踪研究）**
   - **它怎么做**：统计数百万条 ChatGPT、Perplexity、Google AI Overviews 引用后发现：① **88% 的 AI Overviews 引用并不在传统 Google 自然排名前 10**（利好细分垂直工作流长尾页！）；② **约 84% 的 AI 引用来自第三方高权威/社区载体（GitHub 高星仓库、精选目录、Reddit、技术博客、YouTube/B站）**，品牌官网直引占比不到 10%–16%；在本次我们自己的 30 问基线实测中也得到了 100% 印证（唯一命中 Nomi 的第 2 问正是通过 GitHub 仓库 + CSDN 文章被抽中，而非官网！）。
   - **对我们哪个决定有影响**：**确认了 G-site「官网 + GitHub 双轮驱动 & GitHub 爆款精选区」的战略必要性**——一方面把 GitHub `README` 第一屏与 Topics 做好，另一方面在 `nomiaqm.com` 建立真正试过、写清「在 Nomi 里怎么配合用」的 **GitHub AI 视频爆款开源项目精选库** 与 **11 月新模型实操页**，让官网本身成为高信息密度的聚合参考源，反哺大模型引用。

---

## 三、固定 30 问创作者真实问题基线测评（2026-11-24 实测）

### 测评口径
- **问题集**：中文 15 条（`ZH-01`～`ZH-15`）+ 英文 15 条（`EN-01`～`EN-15`），覆盖品类词、分镜/角色一致性、11 月主力新模型工作流（`Seedance 2.5`、`Seedream 5.5`、`Kling 4.0 Flash`、`MiniMax H3 Max`）、BYOK 原价计费、本地 ComfyUI 联动、MCP / Agent 自动化剪辑六大真实创作者场景。
- **通过标准**：AI 检索聚合回答及引用源中是否提及 **Nomi**，以及是否直接引用 `nomiaqm.com` 或 `github.com/aqm857886159/Nomi`。
- **今日基线总分**：
  - **`nomiaqm.com` 官网被引用数**：**`0 / 30`（`0.0%`）**
  - **`github.com/aqm857886159/Nomi` 仓库被提及并引用数**：**`1 / 30`（`3.3%`；中文 `1/15`，英文 `0/15`）**
  - **综合提及基线**：**`1 / 30`（`3.3%`）**

### 1. 中文 15 问基线明细（`1 / 15` 提及 GitHub，`0 / 15` 引用官网）

| 编号 | 创作者真实搜索 / 提问 | 提及 Nomi？ | 引用 `nomiaqm.com`？ | 引用 GitHub 仓库？ | 当前被 AI 优先引用的竞品 / 项目 | 缺口诊断 |
|---|---|:---:|:---:|:---:|---|---|
| `ZH-01` | `AI 视频分镜工具` | 否 | 否 | 否 | LTX Studio, Morphic, Boords, 讯飞绘镜, 即梦, 可灵, `BroderQi/Storyboard` | 官网缺少专门针对「AI 视频分镜工作台」意图的标题与结构化工作流页 |
| `ZH-02` | `本地优先 AI 视频工作台` | **是（排第 1）** | 否 | **是** | **Nomi（第 1）**, BeefTV, AI Art Engine, Timeline Studio | **唯一命中项！** AI 准确复述了 Nomi 拆镜头→关键帧→时间轴→导出 MP4，但引用源是 GitHub + CSDN，官网 `nomiaqm.com` 未进引用 |
| `ZH-03` | `开源 AI 视频创作工作台` | 否 | 否 | 否 | Open Generative AI, Toonflow, ArcReel, OpenMontage, OpenFilm, Pixelle-Video | 中文首页 `<title>` 写「商业级体验，模型按原价」，未包含「开源 AI 视频创作工作台」核心品类词 |
| `ZH-04` | `Seedance 2.5 怎么多镜头生视频` | 否 | 否 | 否 | Pixo, ElevenLabs 教程, TopView AI, Atlas Cloud | 官网 `/models/seedance-2-5` 缺少 30s 时间戳多镜头与 50 参考槽实操教程 |
| `ZH-05` | `Seedance 2.5 样片模式 480p 转 1080p 工具` | 否 | 否 | 否 | 即梦 (Dreamina), TopView AI, Morphic, 火山引擎资讯 | 官网尚未收录 Seedance 2.5 样片模式（Draft 480p → 1080p）说明 |
| `ZH-06` | `Seedream 5.5 图层分解 AI 工作台` | 否 | 否 | 否 | 即梦, 豆包, 火山方舟, Kie.ai, CSDN 评测 | 仓库刚接 `Seedream 5.5`，官网 `site-data` 尚未发页讲解图层分解与透明底工作流 |
| `ZH-07` | `Kling 4.0 Flash 视频生成工作流工具` | 否 | 否 | 否 | 可灵官网, Krea, Picsart, TopView, EvoLink, Runware | 官网模型库目前只到 `kling-3-0` / `kling-3-0-turbo`，缺 `Kling 4.0 Flash` 页面 |
| `ZH-08` | `MiniMax H3 Max 视频生成接 API 工具` | 否 | 否 | 否 | MiniMax 开放平台, fal.ai, Runware, Atlas Cloud | 官网虽有 `/models/minimax-h3-max`，但缺少「在桌面工作台里填 Key 即用、免自己写轮询代码」的场景词 |
| `ZH-09` | `AI 视频角色一致性 分镜画布工具` | 否 | 否 | 否 | 即梦短剧工作室, 新片场 Shotlab, 纳逗 Pro, ComfyUI, RunningHub | 官网未把「锁定角色参考卡 + 分镜表 + 节点画布」写成独立高密度专题答案 |
| `ZH-10` | `自带 API Key 按原价用 AI 视频模型的软件` | 否 | 否 | 否 | Pixelle-Video, AutoClip, ComfyUI, fal.ai, Atlas Cloud | **极高匹配度空白区！** AI 回答甚至感叹“市面上纯客户端软件极少做视频 BYOK”，这正是 Nomi 最强差异点，急需直答段落抢占 |
| `ZH-11` | `ComfyUI 结合分镜时间轴的桌面端软件` | 否 | 否 | 否 | BeefTV, Toonflow, `ComfyUI-Storyboard`, `ComfyUI-AE-Animation` | 官网对「本地 ComfyUI 接入分镜与时间轴」只有一句话带过，缺专属落地说明 |
| `ZH-12` | `Claude Code MCP 控制 AI 视频生成剪辑` | 否 | 否 | 否 | SmoothCapture, JSON2Video, Remotion, `awesome-claude-video-skills` | `/docs/mcp/*` 在 Starlight 里缺 OG 且未突出「24 个 MCP 工具驱动生图生视频排时间轴」 |
| `ZH-13` | `一句话生成分镜关键帧并排时间轴的工具` | 否 | 否 | 否 | 小镜故事板, Topview AI, 讯飞绘镜, Toonflow | 缺与查询句式对齐的工作流证据页 |
| `ZH-14` | `AI 短剧漫剧 多镜头分镜生成桌面软件` | 否 | 否 | 否 | 画镜 AI, Toonflow, 万兴剧厂, 极虎漫剪 | 技能库有 `drama-short`，但标题与摘要未覆盖创作者高频搜的「AI 短剧/漫剧桌面软件」 |
| `ZH-15` | `APIMart 视频模型 桌面客户端 工作台` | 否 | 否 | 否 | APIMart 官网文档, ChatBox（被误举！）, Toonflow | APIMart 搜索结果居然还在推荐纯聊天客户端 ChatBox，Nomi 作为原生内置 APIMart 的视频工作台完全可拿第一 |

### 2. 英文 15 问基线明细（`0 / 15` 提及 Nomi，`0 / 15` 引用官网或 GitHub）

| 编号 | 创作者真实搜索 / 提问 | 提及 Nomi？ | 引用 `nomiaqm.com`？ | 引用 GitHub 仓库？ | 当前被 AI 优先引用的竞品 / 项目 | 缺口诊断 |
|---|---|:---:|:---:|:---:|---|---|
| `EN-01` | `local-first AI video storyboard canvas workbench` | 否 | 否 | 否 | Open-AI-Canvas, VidBoards, Timeline Studio, Morphic, LTX | 英文站声量与外部英文社区（Reddit/HN/Awesome 列表）引用几乎空白 |
| `EN-02` | `open source AI video studio desktop app` | 否 | 否 | 否 | LTX Desktop, Scarlet, OpenFilm, OpenReel, WanGP | 英文首页 H1 为泛修辞 `Pro-grade AI video`，未锚定 `Open-Source AI Video Studio Desktop App` |
| `EN-03` | `bring your own API key AI video editor storyboard` | 否 | 否 | 否 | NodeTool, Wireflow, AutoTube, JSON2Video, OpenMontage | 英文站未显式覆盖 `BYOK (Bring Your Own Key)` 高频缩写词！ |
| `EN-04` | `AI video tool character consistency reference card storyboard` | 否 | 否 | 否 | LTX Studio, M Studio, Higgsfield, Krea, Midjourney | 缺英文角色参考卡（Character Reference Card）可复现工作流页 |
| `EN-05` | `Seedance 2.5 multi-shot storyboard workflow app` | 否 | 否 | 否 | Dreamina, ScreenWeaver, OiiOii, Seedance 教程站 | `/en/models/seedance-2-5` 缺多镜头实操指南且被机房 403 干扰 |
| `EN-06` | `Seedream 5.5 layer decomposition canvas tool` | 否 | 否 | 否 | Linearity, Segmind, Atlas Cloud, EvoLink, RunComfy | 英文站尚未发布 `Seedream 5.5` 模型页 |
| `EN-07` | `Kling 4.0 Flash desktop workflow client` | 否 | 否 | 否 | Kling Desktop, Krea, ComfyUI, fal.ai, Runware | 英文站尚未发布 `Kling 4.0 Flash` 模型页 |
| `EN-08` | `MiniMax H3 Max AI video storyboard workbench` | 否 | 否 | 否 | MiniMax Hailuo, ComfyUI, MagicLight, ElevenLabs | `/en/models/minimax-h3-max` 缺 storyboard workbench 实操段落 |
| `EN-09` | `connect local ComfyUI to storyboard and timeline editor` | 否 | 否 | 否 | `ComfyUI-Storyboard-Generator`, `ComfyUI-StoryboardEditor`, `Comfy_Storyboard` | 缺英文 ComfyUI + Nomi 时间轴桥接说明页 |
| `EN-10` | `MCP server for AI video generation and timeline editing` | 否 | 否 | 否 | Wireflow MCP, invideo MCP, ChatCut, DaVinci Resolve, Shotstack | `/en/docs/mcp/*` 缺少完整 OG 与面向外部 Agent 目录的清晰实体定义 |
| `EN-11` | `node canvas AI video editor Mac Windows open source` | 否 | 否 | 否 | NodeTool Studio (AGPL-3.0!), ComfyUI, Scarlet, OpenReel | NodeTool 几乎用同款定位（AGPL-3.0 + Node Canvas + Timeline + Mac/Win）拿走头名，Nomi 英文描述急需补齐 `node canvas` + `timeline` 实体词 |
| `EN-12` | `AI video agent script to storyboard keyframes MP4` | 否 | 否 | 否 | LTX Studio, Luma Canvas, Novi AI, DrawStory | 缺清晰四步工作流结构化标记（`HowTo` / 事实摘要） |
| `EN-13` | `AI video production tool without subscription markup BYOK` | 否 | 否 | 否 | Kineo (`$0 markup BYOK`), LTX Desktop, ComfyUI, Marky | 英文站写 `Models at their real price`，但未同时覆盖英文搜索者习惯搜的 `BYOK / zero markup` |
| `EN-14` | `3D camera viewfinder blocking for AI video keyframes` | 否 | 否 | 否 | Higgsfield Cinema Studio, Morphic 3D Scene, Blender MCP | Nomi 独有的「3D 导演台 + 手机取景器」在英文搜索里完全没独立锚点 |
| `EN-15` | `open source alternative to Runway TapNow local project files` | 否 | 否 | 否 | `fastvideo-project/dreamverse-harness`, ComfyUI, Wireflow | 缺开源本地文件夹项目结构对比说明 |

---

## 四、从 30 问基线直接推导出 Wave 2 最高杠杆动作

1. **立刻解除机房 403 + 显式放行 AI 爬虫 `robots.txt`**（Wave 1 本分支 + Cloudflare 控制台）。
2. **补齐英文高频检索词同义锚点**：中文搜「按原价 / 自带 Key / 分镜画布」，英文搜 **`BYOK (Bring Your Own Key)`、`zero markup`、`node canvas`、`storyboard-to-timeline`、`local-first desktop app`**——当前英文站没写 `BYOK`，白白丢掉最精准的一批用户。
3. **跑通站点模型数据导出，上线 11 月新模型实操页**（`Seedance 2.5` 样片与多镜头、`Seedream 5.5` 图层分解、`Kling 4.0 Flash`、`MiniMax H3 Max`），每页带「一句话事实定义 + 在 Nomi 里怎么用 + 更新日期」。
4. **修清 `seo:audit` 现存 52 条结构化数据与元数据缺口**（`52 → 0`），并上线「GitHub AI 视频爆款开源项目精选（含 Nomi 配合用法）」。
