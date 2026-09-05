# Nomi Skill Hub 来源目录、许可与优先级

> 核验日期：2026-09-04
> 本文件是研究快照，不代表法律意见。正式发布时必须重新读取上游许可证、平台条款和具体内容来源。

## 1. 使用方法

每个来源分为四档：

| 级别 | 含义 | 默认动作 |
|---|---|---|
| P0 | 许可清晰、质量高、可执行价值高 | 首批联系/测试/内置候选 |
| P1 | 许可较清楚或产品价值高，但需逐项核验 | 进入精选目录候选 |
| P2 | 适合发现和外链，不能默认复制 | 只做摘要、嵌入或作者合作 |
| Blocked | 条款禁止、无许可或强 copyleft 风险 | 不采全文、不内置，最多研究机制 |

权利状态与优先级是两回事。一个流量很大的来源可能是 P0 研究对象，但仍然只能做外链；一个小仓库如果许可清楚、任务明确，反而可能直接成为内置候选。

## 2. 已核验网站与目录

### 2.1 可执行 Skill 目录

| 来源 | 已核验规模/机制 | 权利判断 | 优先级与动作 |
|---|---|---|---|
| [skills.sh](https://www.skills.sh/) / [API](https://www.skills.sh/docs/api) | API 示例总量约 8,420；榜单、Trending、Hot、Official、Topics、Agent 兼容、安装数；详情 API 有完整文件树、SHA-256、重复标记和多家安全审计；OIDC 鉴权，600 次/分钟 | 目录可用于发现；最终许可仍回到每个上游仓库 | P0。建立定期增量发现，逐仓库审权和测试 |
| [腾讯 SkillHub](https://skillhub.cloud.tencent.com/skills?keyword=%E5%89%A7%E6%9C%AC&sortBy=score) | 总站标称 13.8 万；“剧本”返回 954 条；支持排序、来源、分类、API Key 筛选 | 站方版权声明和下架渠道不等于给 Nomi 再分发授权 | P0 合作对象，P2 内容来源。优先谈 API/授权，不直接搬运 |
| [腾讯 SkillHub 剧本样本](https://skillhub.cloud.tencent.com/skills/user_b7745ab7/scriptwrite) | 作者、版本、完整 `SKILL.md`、上下游 JSON 契约、ZIP、安装、评论、历史、AI 评分、安全报告、内容指纹、数字签名 | 需回溯作者和具体许可 | P0 产品结构参考，P1 候选供给 |
| [SkillsLLM drama-skills](https://skillsllm.com/skill/drama-skills) | 10 个短剧全链路 Skill；GitHub、ZIP、安全报告、README、FAQ、评论、关联和比较页 | 以 GitHub 上游 LICENSE 为准 | P1 发现页，回溯 GitHub 后决定内置 |
| [ClawHub story-structure-builder](https://clawhub.ai/huajianjiu000/skills/story-structure-builder) | CLI 安装、Prompt 安装、文件、版本、Bookmark、安全审计、作者、更新时间；条目标记 MIT-0 | 许可相对明确，仍需固定版本证据 | P1，适合作为详情页与安装流程样本 |
| [ClawHub screenwriting 搜索](https://clawhub.ai/skills?q=screenwriting) | 分类、标签、Trending、Featured、Official、New、作者和下载信号 | 每条单独核验 license | P1 发现源 |

### 2.2 提示词与媒体站

| 来源 | 已核验内容 | 权利边界 | Nomi 应借鉴/执行 |
|---|---|---|---|
| [YouMind Prompt Hub](https://youmind.com/zh-CN/prompts) | 32,897 图像、9,988 视频、95 网页提示词；按媒介、模型、用途、风格、主体、Pack、周榜组织 | 社媒公开内容和来源链接不自动产生全文转载权 | P0 产品参考，P2 内容来源；优先作者授权与 Nomi 自测 |
| [YouMind 视频详情样本](https://youmind.com/zh-CN/video-prompts/skyscraper-stunt-rebound-video-prompt-10241) | canonical、长尾标题/meta、完整 prompt、视频 poster、作者、原始 X 链接、日期、标签、互动、收藏、引用、生成 CTA、教程和相关内容 | 页面公开不代表可复制其正文和视频 | 研究详情页结构，不能镜像内容 |
| [PromptHero](https://prompthero.com/) | 宣称 millions；Featured/Hot/New/Top；图像/视频；Midjourney、Seedance、Veo、Sora 等模型分类 | 许可未知 | P2，只研究模型导航和视觉瀑布流 |
| [Civitai Images](https://civitai.com/images) | millions；图片、视频、模型、3D、文章、漫画、挑战；标签、Most Reactions、官方 API | UGC、NSFW、模型许可与单件媒体许可复杂 | P2，通过 API 做发现；未逐件清权不托管 |
| [OpenArt Discovery](https://openart.ai/discovery) | Story、Image/Video、Music Video、Vlog、Explainer、ASMR；视频卡显示时长，有独立详情 URL | 内容授权未知 | P2，借鉴“成品优先”的视频卡和类型分类 |
| [Lexica](https://lexica.art/) | 搜索、Generate、History、Likes；每个 prompt 有独立 URL 和图片结果 | 作者归因不足，复用边界不清 | P2，借鉴搜索和结果组织，不采内容 |
| [PromptBase Marketplace](https://promptbase.com/marketplace) / [条款](https://promptbase.com/tandcs) | 类型、模型、类别、价格、评分、趋势、热门、最新；大量模型/分类页 | 条款明确禁止自动抓取、复制、监控和再分发，创作者保有 IP | Blocked。只研究交互，禁止采集内容 |
| [AIPRM Prompts](https://www.aiprm.com/prompts/) | 546 个分页，约 5,460 条；作者、日期、浏览、使用、点赞、类型/主题；核心 CTA 为安装扩展 | 内容再利用需要授权 | P2，验证“公开 SEO 列表 -> 客户端安装”的闭环 |
| [FlowGPT](https://flowgpt.com/) | 宣称超过 100 万角色/bot；Leaderboard、Bounty、Following、Chatted、类别 | 当前重心偏角色扮演，与 Nomi 目标较弱 | 低优先级，仅研究社区机制 |
| [AI Camera Movements](https://aicameramovements.com/) | 46 个循环视频、7 类、每项 1 条结构化 prompt；搜索、筛选、复制、Prompt Builder、Turn into video | 作者视频链接指向 Dan Kieft，未发现转载许可 | P0 视频产品参考，P2 内容；联系合作或由 Nomi 自制示范 |
| [Luma 官方运镜指南](https://lumalabs.ai/news/ai-camera-movement-prompts) | Luma Team，2026-08-19；六类核心运镜和“运动 -> 场景 -> 动作 -> 细节”公式 | 官方文章有版权，不复制原文 | P1 一手知识源；写 Nomi 原创模型教程并链接原文 |

### 2.3 剧本和叙事网站

| 来源 | 已核验内容 | 权利边界 | Nomi 动作 |
|---|---|---|---|
| [Reedsy Story Structure](https://reedsy.com/studio/templates/category/story-structures/) | 5 个互动模板：三幕式、英雄之旅、七点结构、弗莱塔格金字塔、Fichtean Curve；含示例、问题、比较表、FAQ | 框架概念可原创表达，具体提示和示例不能直接复制 | P1 产品参考；做 Nomi 原创结构 Skill 和交互练习 |
| [StudioBinder 70 Prompts](https://www.studiobinder.com/blog/short-story-writing-prompts/) | 70 条，按 Drama、Comedy、Mystery、Sci-Fi、Romance、Fantasy、Horror 分类；2020-03-27 | 站方原创文章 | P2，只做发现、少量合理引用和外链，或取得授权 |
| [Go Into The Story 100 Scene Prompts](https://gointothestory.blcklst.com/go-into-the-story-resource-100-scene-writing-prompts-4425695714de) | Scott Myers；100 个场景练习；站点称已有 34,000+ 编剧文章 | 内容版权归站方/作者 | P2，适合合作或外链，不整库复制 |

## 3. GitHub 首批候选

Stars/Forks 是 2026-09-04 的快照，只用于发现，不是质量结论。

### 3.1 P0：优先测试和内置候选

| 仓库 | Stars/Forks | 许可 | 价值 | 建议 |
|---|---:|---|---|---|
| [eternityspring/shuohao-skills](https://github.com/eternityspring/shuohao-skills) | 2,754/354 | Apache-2.0 | 5 个自包含短剧 Skill，含 schema、Node 校验、样例和报告截图 | 首批内置；保留 LICENSE/NOTICE，固定 commit |
| [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) | 1,568/404 | MIT | 10 个短剧 Skill，覆盖开发、剧本、资产、分镜、图片/视频提示词、生产、审查；有 tests/evaluations/examples | 首批全链路套件；验证输入输出契约 |
| [GongLingRui/screen-creative-skills](https://github.com/GongLingRui/screen-creative-skills) | 387/76 | MIT | 31 个影视 Skill，分类成熟 | 拆为独立安装项和剧本 SEO 专题 |
| [ChrisChen667788/wind-comic](https://github.com/ChrisChen667788/wind-comic) | 554/54 | MIT | 多 Agent 短剧管线，含编剧、图片、视频和成片 | 抽取 Skill，不嵌整套应用 |
| [POUND0423/AI-drama-pound](https://github.com/POUND0423/AI-drama-pound) | 544/80 | MIT | 小型单一短剧编剧 Skill | 轻量内置候选，重点做质量实测 |
| [Supreme-Ultimate/novel-to-script-team](https://github.com/Supreme-Ultimate/novel-to-script-team) | 160/30 | MIT | 25 个 sub-skill，覆盖小说改编、剧本、导演、分镜、美术、图像和 Seedance 审查 | 作为组合包；避免一次加载全部上下文 |
| [smixs/visual-skills](https://github.com/smixs/visual-skills) | 281/33 | CC-BY-4.0 | image/video 两个高质量 Skill，模型路由、戏剧、摄影、剪辑规则完整 | 内置候选；显著署名 Serge Shima 和来源 |
| [Emily2040/seedance-2.0](https://github.com/Emily2040/seedance-2.0) | 7,163/1,048 | MIT | 根 Skill 和约 27 个模块，覆盖镜头、角色、音频、版权、序列、多语言和故障排查 | 视频核心包候选；做模块按需加载 |
| [MapleShaw/seedance2.0-prompt-skill](https://github.com/MapleShaw/seedance2.0-prompt-skill) | 759/106 | MIT | 中文提示词、四维运镜、长视频和图片驱动路径 | 中文视频核心候选 |
| [bytedance/agentkit-samples](https://github.com/bytedance/agentkit-samples) | 447/93 | Apache-2.0 | 字节官方样例含 Seedance prompt Skill | 一手官方来源优先，抽取对应 Skill |
| [YouMind-OpenLab/ai-image-prompts-skill](https://github.com/YouMind-OpenLab/ai-image-prompts-skill) | 962/108 | MIT | manifest 实测 15,482 条、11 类 JSON | 做一个检索型 Skill，不逐条安装 |
| [EvoLinkAI/awesome-gpt-image-2-API-and-Prompts](https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts) | 17,080/1,723 | CC0-1.0 | 多语言案例、data、images | 可进入候选库；图片人物/品牌权利仍需筛查 |
| [freestylefly/awesome-gpt-image-2](https://github.com/freestylefly/awesome-gpt-image-2) | 27,961/2,692 | MIT | 530+ 案例、20+ 模板；`cases.json` 有标题、分类、prompt、预览和原始 X URL | SEO 和结构化导入价值高；逐条回溯社媒媒体权利 |

### 3.2 P1：精选目录、连接器和工作流候选

| 仓库 | Stars/Forks | 许可 | 处理建议 |
|---|---:|---|---|
| [pexoai/pexo-skills](https://github.com/pexoai/pexo-skills) | 776/44 | 仓库 MIT，Skill 标 MIT-0 | 20 个 Agent Skills；依赖 `PEXO_API_KEY`、外网和付费确认。作为可选连接器，不核心内置 |
| [comfyanonymous/ComfyUI_examples](https://github.com/comfyanonymous/ComfyUI_examples) | 4,504/1,447 | 自定义宽松许可 | 覆盖 Flux、Wan、LTXV、Hunyuan、SDXL；适合 workflow 下载区，记录节点和模型依赖 |
| [HKUDS/ViMax](https://github.com/HKUDS/ViMax) | 12,255/1,841 | MIT | Director/Screenwriter/Producer/Generator 全链路；作为系统参考或集成，不伪装成单 prompt |
| [ATH-MaaS/Pixelle-Video](https://github.com/ATH-MaaS/Pixelle-Video) | 27,763/4,050 | Apache-2.0 | Python 视频引擎、模板、云端/自托管 workflow；适合可运行方案专题 |
| [kijai/ComfyUI-WanVideoWrapper](https://github.com/kijai/ComfyUI-WanVideoWrapper) | 6,682/688 | Apache-2.0 | Wan 视频节点和 workflow 生态；做技术页、依赖说明和外部安装 |
| [nidhinjs/prompt-master](https://github.com/nidhinjs/prompt-master) | 12,339/1,447 | MIT | 通用 prompt 优化 Skill；可做模型路由入口，需持续核验模型资料 |

### 3.3 P2：只引用、逐条审权或自行复现

| 仓库 | Stars/Forks | 原因与动作 |
|---|---:|---|
| [YouMind-OpenLab/awesome-nano-banana-pro-prompts](https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts) | 13,362/1,437 | 标 CC-BY-4.0，但内容来自社区。逐条回溯原帖和媒体，不整库搬图 |
| [YouMind-OpenLab/awesome-gpt-image-2](https://github.com/YouMind-OpenLab/awesome-gpt-image-2) | 9,746/881 | 同上。可做索引、来源跳转或 Nomi 自行复现预览 |
| [ZeroLu/awesome-nanobanana-pro](https://github.com/ZeroLu/awesome-nanobanana-pro) | 10,284/868 | LICENSE 是 MIT，README 又标 CC-BY，且内容来自 X/微信；许可冲突 |
| [ZeroLu/awesome-seedance](https://github.com/ZeroLu/awesome-seedance) | 2,372/264 | 高质量视频 prompt、预览和原帖链接，但第三方内容逐条审权；SEO 发现价值高 |
| [PicoTrex/Awesome-Nano-Banana-images](https://github.com/PicoTrex/Awesome-Nano-Banana-images) | 23,641/2,397 | 仓库 Apache-2.0，但明确采集自 X、小红书；仓库许可不能覆盖原作者媒体 |
| [poloclub/diffusiondb](https://github.com/poloclub/diffusiondb) | 1,393/79 | 数据声明 CC0，含 1,400 万图片、180 万独立 prompt；必须做 NSFW、肖像、品牌、艺术家风格和低质过滤 |

### 3.4 Blocked 或高风险

| 仓库 | 风险 | Nomi 动作 |
|---|---|---|
| [calesthio/OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3.0；700+ skill/production 文件 | 可研究架构和外链；闭源 Nomi 不直接嵌入其代码/Skill 包 |
| [dramaclaw/dramaclaw](https://github.com/dramaclaw/dramaclaw) | Elastic-2.0，不是 Apache；`SKILL.md`、playbooks、前后端均受限 | 不直接内置，必要时谈商业授权 |
| [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) | GPL-3.0 | 作为独立进程或外部安装依赖，避免复制进闭源客户端 |
| [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | GPL-3.0，且维护频率下降 | 只做兼容说明和外部安装 |

### 3.5 无 LICENSE：取得许可前不可复制

| 仓库 | Stars | 处理 |
|---|---:|---|
| [lixiaoxiao9888-create/manju-laoli-skill](https://github.com/lixiaoxiao9888-create/manju-laoli-skill) | 353 | 只链接或联系作者 |
| [hylarucoder/seedance-screenwriter-skills](https://github.com/hylarucoder/seedance-screenwriter-skills) | 56 | 只链接或联系作者 |
| [LingyiChen-AI/comfyui-workflow-skill](https://github.com/LingyiChen-AI/comfyui-workflow-skill) | 385 | 价值高，含 34 JSON 模板和 360+ 节点定义，但无 LICENSE；优先联系授权 |
| [MiniMax-AI/cli](https://github.com/MiniMax-AI/cli) | 2,080 | 无明确许可，不复制 |
| [dongyubin/Awesome-AI-Images-Prompts](https://github.com/dongyubin/Awesome-AI-Images-Prompts) | 246 | 无明确许可，不复制 |
| [joelparkerhenderson/stable-diffusion-image-prompt-gallery](https://github.com/joelparkerhenderson/stable-diffusion-image-prompt-gallery) | 183 | 无明确许可，不复制 |

## 4. 社媒和 TikHub 来源策略

### 4.1 当前能力状态

本机当前没有可用的 TikHub CLI、MCP 或运行时 API key，因此本轮没有伪造 TikHub 调用。历史研究记录表明曾获取 39 条抖音公开结果和 8 个 540p 样本。

TikHub 官方能力已确认：

- 小红书搜索可按点赞、评论、收藏、时间排序，并筛选图文/视频。
- X 可取单帖、搜索、用户帖子、媒体和趋势。
- 抖音支持多重搜索；`content_type` 需要传字符串。

接通 TikHub 后，应优先按小红书“收藏数”而不是点赞排序。收藏更接近用户认为可复用的教程或模板。

### 4.2 已核验高价值作者与主题

以下先记录作者主页；正式发布前必须保存精确原帖 URL、发布时间、原始媒体 URL、互动快照和授权证据。

| 作者/主页 | 已核验主题与信号 | 默认权利处理 |
|---|---|---|
| [Emily / @IamEmily2050](https://x.com/IamEmily2050) | Storyboard system prompt；56.9K views、1K likes、1.7K bookmarks | X 官方嵌入或 Nomi 摘要，取得授权后才复制/安装 |
| [Machina / @EXM7777](https://x.com/EXM7777) | Seedance Prompting Bible；399K views、1.5K likes | 同上；优先联系作者合作 |
| [Dave Clark / @Diesol](https://x.com/Diesol) | Veo cinematic guide；149K views、720 likes | 原创摘要、官方嵌入、原帖跳转 |
| [fofr / @fofrAI](https://x.com/fofrAI) | Midjourney cinematic thread；795.8K views、2.5K likes | 原创摘要、官方嵌入、原帖跳转 |
| Olivio Sarikas | 导演分镜板 prompt | 核验准确主页和原帖后再入库 |
| GumVue | Patreon 付费 workflow | 只做摘要或联盟合作，禁止复刻付费正文 |
| Justine Moore | Seedance 多镜头 `[cut]` 示例 | 核验原帖，默认摘要/嵌入 |
| Dinda Prasetyo | Seedance 与 Veo 对比 | 核验原帖，默认摘要/嵌入 |
| Shushant Lakhyani | 完整 AI 视频生产 taxonomy | 核验原帖，默认摘要/嵌入 |

抖音公开发现覆盖：

- 小说/剧本转分镜。
- AI 漫剧完整流程。
- 九宫格分镜。
- 一镜到底、穿越机、过肩反打。
- 首尾帧和按秒运镜。
- 参考视频复刻。
- 角色一致性。
- 自动配音和剪辑。

其中至少一条公开索引样本显示 5,224 个赞。正式目录不能只保存搜索摘要，必须保存原作者主页和原视频 URL。

小红书本轮未登录，未列出无法核验的具体帖子。默认处理是 Nomi 原创摘要、作者归因和原帖跳转；拿到书面授权后再开放全文、媒体和客户端安装。

### 4.3 TikHub 搜索矩阵

建议按平台并行维护关键词组，而不是只搜“提示词”：

| 方向 | 中文关键词示例 | 英文关键词示例 |
|---|---|---|
| 剧本 | 短剧剧本、小说改编、分集大纲、钩子、反转、人物弧光、对白 | screenplay prompt, short drama, story beats, scene writing |
| 分镜 | 剧本转分镜、九宫格分镜、镜头表、导演分镜 | storyboard prompt, shot list, director board |
| 图片 | 角色一致性、定妆照、场景概念、产品图、海报 | character consistency, concept art, product shot |
| 视频输入 | 文生视频、图生视频、多图参考、首尾帧、视频转视频 | text to video, image to video, first last frame, video to video |
| 运镜 | 一镜到底、穿越机、环绕、跟拍、过肩反打、按秒运镜 | one take, FPV, orbit, dolly, crane, over the shoulder |
| 商业视频 | 产品广告、品牌片、探店、汽车、美妆、地产、口播、UGC | product ad, brand film, beauty ad, real estate, UGC ad |
| 模型 | Seedance、Kling、Veo、Wan、Sora、Runway、即梦 | 同左，增加版本号和新模型别名 |

每个平台同时维护高召回查询和高精度查询。候选进入库后使用统一分类器和去重，不把搜索关键词直接当最终标签。

## 5. 首批内容组合建议

### 5.1 核心内置 20-30 个

优先从以下许可清楚的仓库组合，而不是按单仓库照单全收：

- `shuohao-skills`：选 3-5 个短剧主链 Skill。
- `drama-skills`：选 5-8 个端到端环节。
- `screen-creative-skills`：补足人物、结构、导演和审查。
- `visual-skills`：图片、视频各 1 个通用路由 Skill。
- `seedance-2.0` 和官方 `agentkit-samples`：选镜头、多镜头、首尾帧、音频和故障排查模块。
- `ai-image-prompts-skill`：1 个检索型图片 Recipe Skill。

准入不是看总数，而是运行测试后保留任务边界清楚、互相不重复的一组。

### 5.2 官网首发 150-300 页

建议分布：

| 内容簇 | 建议页数 | 目的 |
|---|---:|---|
| 剧本与叙事 Skill | 50-80 | 承接短剧、小说改编、分镜、人物和结构搜索 |
| 图片 Recipe/Showcase | 40-70 | 用真实图片结果提升点击和收藏 |
| 视频 Recipe/Showcase | 50-100 | 覆盖多模型、多类型、多输入和运镜 |
| Workflow | 10-30 | 承接 ComfyUI、Wan、Flux 等高意图技术流量 |
| Collection/教程 | 10-20 | 把分散 Skill 组织为端到端任务 |

所有公开页都必须满足：独特说明、真实预览、参数、模型版本、作者、来源、权利、测试状态。未达到的记录留在候选库，不索引。

## 6. 采集记录模板

每次新增候选至少记录：

```yaml
discovered_at: 2026-09-04T00:00:00+08:00
discovery_source: skills.sh | github | x | douyin | xiaohongshu | website
discovery_query: string

canonical_url: https://...
author_name: string
author_profile_url: https://...
original_published_at: datetime | null

object_type: agent_skill | prompt_recipe | workflow | showcase
domain: script | image | video
title: string
summary: string

license_spdx: string | null
license_url: https://... | null
license_snapshot_hash: string | null
text_rights: green | yellow | red
media_rights: green | yellow | red
redistribution_allowed: true | false | unknown
commercial_use_allowed: true | false | unknown
modification_allowed: true | false | unknown
attribution_required: true | false | unknown

repository_url: https://... | null
commit_sha: string | null
file_path: string | null
content_hash: string | null
media_phash: string | null

web_publishable: true | false
client_installable: true | false
review_status: discovered | rights_reviewed | security_reviewed | tested | published | rejected
review_notes: string
```

## 7. 作者授权模板要点

联系作者时不要只问“能否转载”，应拆清楚授权范围：

- Nomi 官网是否可展示全文。
- 是否可缓存、自托管图片或视频。
- 是否可翻译、结构化、变量化和改编。
- 是否可打包进入 Nomi 客户端。
- 是否允许商业使用和用户二次导出。
- 授权是否独家、期限和地域。
- 署名文案与跳转 URL。
- 作者能否更新、认领或撤回。
- Nomi 是否可以用自己的模型重新生成实测结果。

授权证据必须保存原始邮件/私信/合同、时间、授权人身份和对应内容 URL，不能只在数据库写一个 `authorized=true`。

## 8. 发布前检查表

- 已定位原作者，不把镜像或聚合站当作者。
- 已保存 canonical URL 和作者主页。
- 已读取具体 LICENSE/条款，而不是根据 README 标题猜测。
- 已分别判断文字、图片、视频、音乐、人物/IP 权利。
- 已记录 Nomi 的翻译、改写、扩展或重生成情况。
- 已完成去重和相似内容归并。
- 可执行内容已固定版本、扫描依赖和危险脚本。
- 已声明网络域名、API key、费用和权限。
- 已在声明的模型/版本上真实测试。
- 已提供合法预览，或明确不展示第三方媒体。
- 已决定是否允许复制、下载、导出和客户端安装。
- 已准备投诉、暂停和跨端下架路径。

## 9. 最重要的边界

1. PromptBase 明确禁止自动抓取、复制、监控和再分发：禁止采集。
2. GitHub 仓库 LICENSE 不自动覆盖其中转载的社媒文字和媒体。
3. X、抖音、小红书公开可见，不等于可以全文复制或内置客户端。
4. 付费 Patreon、课程或 marketplace 内容只做摘要、合作或购买后个人使用，不复刻销售内容。
5. “标作者”和“侵权后下架”不是授权。
6. 不确定时，默认 `web_publishable=false`、`client_installable=false`，先保存内部候选和来源证据。
