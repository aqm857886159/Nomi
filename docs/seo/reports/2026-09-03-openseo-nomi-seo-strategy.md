# Nomi × OpenSEO SEO 审计与优化报告

> 报告日期：2026-09-03
> 目标站点：https://nomiaqm.com/
> 范围：只读审计、站点结构对账、增长机会判断；本报告未修改网站代码，也未修改 OpenSEO 项目设置。

## 一、结论先行

Nomi 当前不是“基础 SEO 没做”，而是“技术地基基本合格，但搜索入口、页面分工和外部权威还没有形成闭环”。

最应该先做的不是批量生成文章，也不是追泛词 `AI video editor`，而是完成三件事：

1. 统一 `/handbook`、`/handbook.html`、`/quickstart`、`/quickstart.html` 的最终 URL、canonical、sitemap 和内部链接。
2. 把 `handbook` 从“只有视觉卡片的一页介绍”变成一个有明确文字答案、上下游链接和产品证据的上手入口。
3. 围绕 Nomi 真正的差异建立一条窄内容入口：`open source + local-first + AI video workflow`。这个切口比直接竞争 `AI video editor` 更现实。

OpenSEO 的技术审计发现 5 个问题，但没有 Critical/High；真正影响 Nomi 增长的结构性问题，是可索引页面太少、目标意图没有拆开、反链较少指向产品解释页面，以及 OpenSEO 项目上下文为空。

## 二、这次实际做了哪些审计

### 1. OpenSEO 标准站点爬虫

- 审计 URL：`https://nomiaqm.com/`
- 抓取：6/6 页面成功
- 页面状态：4 个 `200`，2 个 `.html` 地址返回 `307` 到 clean URL
- 发现：5 个问题
- 审计 ID：`b0cb74be-90cb-42f1-920b-ad48493c730b`
- [OpenSEO 审计详情](https://app.openseo.so/p/3e4e81e0-cca0-4f23-a39e-af88cccfe640/audit?auditId=b0cb74be-90cb-42f1-920b-ad48493c730b)

### 2. OpenSEO Lighthouse 补充审计

- Lighthouse：8/8 样本完成，0 个失败
- 审计 ID：`19b26b28-bd59-4f50-9969-9bb44f455fc8`
- OpenSEO 的 issue/page 接口没有返回 Lighthouse 细项或性能分数，因此不能把这轮写成“性能优秀”，只能确认样本执行完成。
- [OpenSEO Lighthouse 审计详情](https://app.openseo.so/p/3e4e81e0-cca0-4f23-a39e-af88cccfe640/audit?auditId=19b26b28-bd59-4f50-9969-9bb44f455fc8)

### 3. 增长层只读审计

使用了：域名概览、反链概览/样本、关键词研究、两个真实 Google SERP。

- OpenSEO 项目：`Default`
- 当前市场：US / English（location `2840`，language `en`）
- 关键词没有保存
- 没有创建排名追踪器
- 没有修改 OpenSEO 项目上下文
- 没有接入 GSC/GA

费用记录：Lighthouse 前余额 500，后余额 444；增长层审计前余额 444，后余额 138。本次两轮实际消耗 362 credits。OpenSEO 没有返回逐项扣费明细，因此以余额差额为准。

## 三、按严重程度的发现

### P0：先统一 URL 真相源

OpenSEO 观察到：

- `https://nomiaqm.com/handbook` 返回 `200`，可索引，但 canonical 指向 `https://nomiaqm.com/handbook.html`。
- `https://nomiaqm.com/handbook.html` 返回 `307`，又重定向回 `/handbook`。
- `quickstart` 存在同样关系。
- 本地 `scripts/marketing/site-manifest.mjs` 和 `scripts/marketing/content.mjs` 仍把 `.html` 当作公开 URL，sitemap 也列 `.html`。

这不是单纯的标题问题，而是“搜索引擎看到的最终页面”和“我们声明的 canonical/sitemap 页面”不一致。推荐把 clean URL 作为最终公开 URL：

| 页面 | 推荐最终 URL | 推荐 canonical | sitemap |
|---|---|---|---|
| 新手指南 | `/quickstart` | `/quickstart` | `/quickstart` |
| 一页上手 | `/handbook` | `/handbook` | `/handbook` |

旧 `.html` 地址保留 301/308 兼容跳转即可。实施时需要同时更新内容源、构建脚本、manifest、sitemap、内部链接和测试，不能只改 HTML 里的一个 canonical。

### P1：`/handbook` 既薄又孤立

OpenSEO 报告：

- 页面无 outgoing/internal links
- 统计正文 83 words
- 标题长度 9

CJK 页面被工具按英文 word 规则统计，83 不能直接等同于中文真实字数；但“没有链接”是真问题。当前 handbook 更像一张可视化说明卡：它有流程、首胜、常见卡点，但没有把用户继续带到下载、模型设置、GitHub、quickstart 或具体工作流证据的路径上。

推荐：保留它作为“首胜导航页”，但补上 3–5 个上下文链接，并将标题改为能表达任务的句子，例如：

> Nomi 一页上手：从安装到生成第一条 AI 视频

链接至少覆盖：下载/Release、quickstart、模型接入说明、身份参考/3D 导演台工作流、GitHub Discussions。不要为了凑字数堆 SEO 段落；每段都应回答用户下一步怎么做。

### P1：目标页面太少，首页承担了过多搜索意图

当前本地 SEO manifest 只有 4 个公开入口：

- `/`：产品定位与价值
- `/en/`：英文产品定位与价值
- `/quickstart.html`：安装与第一次成功
- `/handbook.html`：一页上手

这套结构适合产品发布页，不足以覆盖“开源替代品比较”“本地优先工作流”“参考图/身份一致性”等不同意图。首页不应同时承担所有词，否则每个词都只得到一小段说明。

但也不建议一次性铺十几个 SEO 页面。Nomi 是小团队/单人约束下的产品，第一阶段只新增一个真正有证据的入口页：

`Open-source AI video editor / 本地优先 AI 视频工作台`

页面必须有真实截图、60 秒视频、可复现工作流、下载入口和与现有 quickstart 的关系；不是把首页文案换个标题再复制一遍。

### P1：当前最现实的搜索切口不是泛词

US/English 关键词研究信号：

| 方向 | OpenSEO 信号 | 判断 |
|---|---:|---|
| `open source video editor` | 约 2,900/月，KD 40 | 有需求，但泛开源编辑器竞争成熟 |
| `open source AI video editor` | 精确词约 50/月，KD 15，CPC 2.09，transactional | 量小但与 Nomi 定位高度匹配，值得做入口 |
| `AI video editor` | 约 33,100/月，KD 47 | InVideo、Runway、Canva、Adobe 等高预算竞争，不适合作为第一主攻词 |
| `free AI video editor` | KD 75 | 竞争强、用户意图偏泛，不建议当前投入 |
| `local-first AI video` | 语义 fallback 到通用 AI video 词 | 不能证明已有成熟搜索需求，可作为差异化内容语言 |
| `AI video workflow` | 低量长尾和通用生成器词为主 | 适合解释产品方法，不宜当作成熟关键词承诺 |

两个 SERP 的形态也支持这个判断：

- `open source AI video editor` 的结果包括 OpenReel、GitHub Frame、Reddit、OpenShot、Hacker News、Product Hunt 等，社区/开源项目有进入空间。
- `AI video editor` 的前列是 InVideo、Runway、Canva、Adobe、VEED、OpusClip、Kapwing 等成熟 SaaS，直接硬抢会把 Nomi 带入不适合的竞争。

### P1：反链有基础，但没有沉淀到“可排名页面”

OpenSEO 返回：

- 43 条 backlinks
- 23 个 referring domains
- 30 个 referring pages
- provider rank 10
- 0 broken backlinks、0 broken pages

抽样链接主要指向首页或 MP4 资产，指向产品解释页、教程页和工作流证据页的较少。来源里 `noisework.cn` 有 10 条反链，但 spam score 为 35；不能把反链数量直接当作权威质量。

推荐的外链策略不是买链接，而是让每次真实发布都链接到一个可阅读、可引用的页面：

- 产品介绍页：解释 Nomi 与传统在线 AI 视频工具的区别
- 工作流证据页：一条完整作品、输入、参考、过程、输出和成本记录
- quickstart：让读者能立刻下载并完成首胜
- GitHub Discussions/Release：承接社区和版本更新

视频文件可以继续被外部引用，但应同时提供页面级链接，避免权重只落在不可阅读的 `.mp4` 资源上。

### P2：OpenSEO 项目上下文为空

OpenSEO 当前项目缺少：business overview、current goal、positioning、writing preferences、competitors、key pages。这样后续 AI 代理即使拿到关键词和竞品数据，也容易给出泛化建议。

建议下一步在 OpenSEO 项目里补充上下文，但这属于外部持久化写入，本报告没有代为修改。建议内容：

- 业务：开源、本地优先的 AI 视频创作工作台，连接用户自己的模型/API/ComfyUI，覆盖脚本、分镜、生成、剪辑和导出。
- 当前目标：让正在寻找开源 AI 视频编辑器或低浪费 AI 视频工作流的人，理解 Nomi 的差异并完成下载/首胜。
- 定位：不是另一个封闭的在线生成器，而是把已有模型、参考证据和完整创作流程放在用户可控制的工作台里。
- 竞品分组：OpenReel、Frame、LTX Desktop 属于开源/本地邻近；Runway、Canva、InVideo、CapCut 属于泛 AI 视频 SaaS 竞争。
- 关键页面：首页、quickstart、handbook、未来的开源 AI 视频工作台入口页。

## 四、建议使用的完整审计组合

OpenSEO 可以做更多，但不是所有功能都应现在全部跑。正确做法是按“技术可抓取 → 搜索需求 → 竞争 → 第一方效果 → 持续监控”分层。

| 层 | OpenSEO 能力 | 当前状态 | 对 Nomi 的价值 | 下一步 |
|---|---|---|---|---|
| 技术抓取 | site audit + pages/issues | 已完成 | 找状态码、canonical、薄内容、链接和索引信号 | 修完 URL 后复测 |
| 性能体验 | Lighthouse | 已完成 8/8，但无细项返回 | 补性能、SEO、可访问性、最佳实践 | 用本地 PageSpeed Observatory 补可见指标 |
| 需求发现 | keyword research + metrics | 已完成 US/English | 找真实需求与难度，避免凭感觉写页面 | 挑 10–20 个候选词，不急着保存 |
| SERP 竞争 | SERP results / competitor signals | 已完成 2 个核心词 | 判断结果页是 SaaS、开源项目还是社区 | 新页面上线前复查 |
| 域名概览 | domain overview | 已调用但无数据 | 看有机词与估算流量 | 不能把“无数据”解释成 0；接 GSC 后用第一方数据校正 |
| 反链 | backlinks overview/profile | 已完成 | 识别引用来源、资产落点和低质量风险 | 建页面级外链，不购买链接 |
| 第一方搜索 | Search Console performance / URL inspection | 尚未接入 | 看到真实曝光、点击、CTR、平均位置和索引状态 | 连接 GSC；这些工具只读且不消耗 OpenSEO credits |
| 行为转化 | Google Analytics | 尚未接入 | 判断下载、quickstart、社区 CTA 是否产生行为 | 有 GA4 数据后再接，不先凭空优化转化率 |
| 排名追踪 | rank tracker | 尚未创建 | 观察优化后 10–20 个核心词的趋势 | 先估价，再创建；不追几百个词 |
| AI 可见性 | OpenSEO 产品页宣传有 AI Visibility/Prompt Explorer | 当前 MCP 46 个工具清单未暴露对应工具 | 可用于未来检查 AI 推荐/引用 | 先不将其计入当前已验证能力，待工具实际出现再跑 |

OpenSEO 官方能力说明： [Site Audit](https://openseo.so/features/site-audit)、[MCP 能力](https://openseo.so/features/mcp)、[Keyword Research](https://openseo.so/features/keyword-research)、[Rank Tracking](https://openseo.so/features/rank-tracking)、[Pricing/Credit 规则](https://openseo.so/pricing)。

## 五、Nomi 当前页面 SEO 契约

| 页面 | 唯一任务 | 索引建议 | 内容证据 | 必须有的链接 | 结构化数据 |
|---|---|---|---|---|---|
| `/` | 让新用户理解 Nomi 为什么省成本、能不能马上试 | index | 真实产品截图、60 秒回放、模型/API/ComfyUI 事实 | quickstart、Release、GitHub、Discussions | WebSite + WebPage + SoftwareApplication |
| `/en/` | 英文用户理解定位并开始下载 | index | 英文同构证据，不能只做翻译壳 | quickstart/English、Release、GitHub、Discussions | 同上，保持 hreflang 互指 |
| `/quickstart` | 完成安装、接入模型和第一条视频 | index | 安装包、步骤、首胜路径、已知限制 | handbook、下载、模型说明、问题反馈 | WebPage + SoftwareApplication |
| `/handbook` | 90 秒理解整个工作流并选择下一步 | index，前提是补链接和文字 | 流程、首胜卡、能力路线、常见卡点 | quickstart、下载、参考工作流、Discussions | WebPage + SoftwareApplication |
| `/open-source-ai-video-editor`（建议新增） | 承接开源/本地优先 AI 视频编辑器的高匹配搜索 | index | 真实作品、代码、运行方式、成本边界、与在线 SaaS 的差异 | quickstart、Release、GitHub、工作流证据 | WebPage + SoftwareApplication；不添加无法证明的 Review/FAQ schema |

真实源文件与目标：

- 内容与公共链接：`scripts/marketing/content.mjs`
- 页面清单与 sitemap 真相源：`scripts/marketing/site-manifest.mjs`
- 首页模板：`scripts/marketing/template.mjs`
- handbook 生成器：`scripts/build-handbook-html.mjs`
- 现有 SEO Observatory：`scripts/seo/seo-audit.mjs`
- 本地 SEO 说明：[docs/seo/README.md](../README.md)

## 六、执行顺序

### 第一阶段：确定性修复

1. 选择 clean URL 作为 handbook/quickstart 的最终 canonical。
2. 同步修改内容源、构建脚本、manifest、sitemap、内部链接和测试。
3. handbook 补 3–5 个真实上下文链接，改描述性标题。
4. 发布后同时跑本地 Observatory 和 OpenSEO site audit，确认不再出现 canonicalized-page、no-outgoing-links。

### 第二阶段：一页差异化入口

新增一页“开源、本地优先的 AI 视频工作台”，只讲 Nomi 已经能证明的东西：

- 自己的模型/API/ComfyUI
- 脚本 → 分镜 → 生成 → 时间轴 → 导出
- 角色/场景/参考证据如何减少无效生成
- 真实 60 秒演示与下载路径
- 不承诺“免费生成”“无限额度”或其他无法由 Nomi 保证的结果

### 第三阶段：第一方数据闭环

1. 连接 Google Search Console，读取真实查询、页面、曝光、点击和索引状态。
2. 用 URL Inspection 检查首页、quickstart、handbook 及新增入口页。
3. 从 GSC 找“第二页且已有曝光”的词，优先优化已有页面。
4. 只选择 10–20 个核心词创建 rank tracker，并先估价。

### 第四阶段：内容与外链的可复现循环

每月只做 1–2 个真实内容单元：一条完成作品或一条完整工作流，配套：输入、参考、过程、输出、成本、限制、代码/下载链接。把同一证据分发到 GitHub、社区和外部目录，但链接回页面而不是只链接 MP4。

## 七、不建议现在做的事

- 不直接建设“AI video editor”泛词页面并承诺快速排名。
- 不批量生成没有真实作品支撑的“最佳工具/教程”文章。
- 不购买或交换低质量反链。
- 不为了 OpenSEO 分数增加虚假 FAQ、Review、AggregateRating 等 schema。
- 不在没有 GSC 数据时把 OpenSEO 的 domain overview “无数据”解释为网站没有流量。
- 不把 AI Visibility/Prompt Explorer 当作当前已验证的 MCP 能力；当前连接清单没有暴露对应工具。

## 八、最终判断

需要更多审计，但不是无边界地多跑工具。Nomi 现在最有帮助的组合是：

1. 技术爬虫 + Lighthouse：已经完成，暴露了 URL/canonical、handbook 链接和内容问题。
2. 关键词 + SERP + 反链：已经完成，证明窄切口和页面级权威建设方向。
3. GSC + URL Inspection：下一轮最值得补，能把“推测”换成 Nomi 自己的真实搜索数据，而且官方说明为免费只读能力。
4. 排名追踪：页面和候选词确定后再做，不要先追踪一大堆词。
5. AI 可见性：等当前 MCP 实际暴露工具后再评估；不能仅凭产品宣传页把它算作已完成审计。

所以结论不是“继续加更多 SEO 工具”，而是先把这次审计发现的 URL 和 handbook 根问题修掉，再用 GSC 验证哪些真实搜索需求值得做第二个页面。这样每一轮数据都会直接改变一个页面或一个内容实验，而不是堆成一份更大的分数表。
