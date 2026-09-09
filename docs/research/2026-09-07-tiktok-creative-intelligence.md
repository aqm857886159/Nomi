# 在 TikHub 上长出「搜素材 → 拆爆款 → 生成自己的版本」这条线，值不值得做？

日期：2026-09-07 · 基线：`origin/main@4f55e2a36`
性质：只调研不改码（含真实 API 实调，未写任何生产代码）
服务对象：用户提问「vizzylabs.ai 那种事，我们能不能在 TikHub 上做——比如加一个搜索节点」

## 0. 要回答的问题

1. vizzylabs 到底卖的是什么？它难在哪一半？
2. TikHub 有没有对应的数据面？「按曝光排序的跑量素材 + 为什么能传开」拿不拿得到？
3. Nomi 已经有什么、还缺什么？「加个搜索节点」是不是正确的切法？

## 1. 结论先行

1. **能做，而且难的那一半我们已经有了。** Vizzy 的产品是「发现 → 分析 → 洞察」；Nomi 已经有 `deconstructVideo` → 分镜结构表 → 落画布节点（带 `imagePrompt`/`motionPrompt`）这条**分析 → 生产**的完整链路（`src/workbench/generationCanvas/nodes/deconstructionTypes.ts`、`extractDeconstructionShotsToNodes.ts`），也已经有 TikHub connector 把分享链接变成项目素材（`electron/connectors/tikhubConnector.ts`）。**缺的只有最前面那一段：发现。**
2. **真正值钱的不是「搜索」，是 TikHub 代理的 TikTok Creative Center。** `/api/v1/tiktok/ads/*` 这一族给的是**正在投放的广告** + CTR + 表现分位 + 逐秒指标曲线 + 行业百分位。这正是「跑量素材，按表现排序」——也正是「靠感觉」永远补不上的那一块。已用真 key 实调验证（§2.1）。
3. **但官方文档的响应示例是假的。** `get_ad_keyframe_analysis` 文档写 `keyframe_data{time_points, retention_rates, drop_points, highlight_points}`，实调回来的是 `analysis[{second,value}] + duration + highlight`；`get_ad_percentile` 文档写一个含 5 个百分位 + 行业均值的对象，实调只回 `{ctr_percentile: 0.99}`。**按文档设计数据模型会全线返工**（同 [[kie-file-upload-real-contract]] 那次的坑）。
4. **成本上这不构成障碍**：TikHub 按次计费，标准端点 $0.001/请求（≤1000 次/天档；spec 自述「$2 余额 ≈ 2000 次请求」印证），**但部分端点在自己的 description 里标溢价**（如抖音高画质直链 $0.005）——`/tiktok/ads/*` 族无价格行，走标准价，一页 20 条广告 = 1 次请求。用户那句「猜素材方向的试错成本比这工具一年订阅贵」，在我们这儿的量级是**一年订阅费 ≈ 几千次请求**。
5. **切法上我不建议做成一个「搜索节点」。** 理由见 §4 —— 搜索是一次性的检索动作，不是画布上要长期存在、要被连线、要参与生成的东西。做成节点会得到一个更差的 Kalodata；做成**素材库里的一个来源**，才接得上我们已有的「拆解 → 分镜 → 生成」闭环。

## 2. 一手来源

### 2.1 TikHub · TikTok Ads（Creative Center）—— **真调过，不是文档级**

契约来源：`https://api.tikhub.io/openapi.json`（V5.3.2，2026-09-07 实读，1061 条 path）。
实调时间：2026-09-07，真 key，共约 10 次请求（≈$0.01）。

| 端点 | 用途 | 实调结果（**以此为准，非文档示例**） |
|---|---|---|
| `POST /tiktok/ads/search_ads` | 广告创意库检索 | ✅ `data.data.materials[]` + `pagination{has_more,page,size,total_count}`。每条：`ad_title` / `brand_name` / `ctr`(%) / `like` / `cost`(1-5 花费档) / `objective_key` / `industry_key` / `video_info{vid,duration,cover,video_url.720p}` |
| `POST /tiktok/ads/get_ads_detail` | 单条广告详情 | ✅ 额外给 `landing_page`（带 utm 的真实落地页）、`country_code[]`、`comment`/`share`、`pattern_label[]`、可直下的 `video_url.720p` |
| `POST /tiktok/ads/get_ad_keyframe_analysis` | 逐秒指标曲线 | ✅ 但形状是 `{analysis:[{second,value}], duration, highlight:[1,12,16]}`——**与文档示例完全不同**；`value` 语义（默认 metric=`retain_ctr`）实测是归一化值，大量 0 + 尖峰 + 末秒=1，**不是留存率曲线**，语义待进一步探针 |
| `POST /tiktok/ads/get_ad_percentile` | 同行业百分位 | ✅ 但只回 `{ctr_percentile: 0.99}`——**文档承诺的 cvr/engagement/view/industry_average 都没有** |
| `POST /tiktok/ads/get_top_contents_list` | Creative Center 热门视频榜（固定 100 条） | 未调。文档：可按 `order_by_metric` 1=播放量 / 2=互动率 / **3=6 秒完播率** 排序，`organic_only` 可只看自然流量；⚠️ spec 自己注明「截至 2026-08 实测可返回数据的只有 US / TH」 |

`search_ads` 的筛选面（schema 实读，**文档描述与 schema 类型不一致，以 schema 为准**）：
`keyword` / `objective`(1 流量 2 应用安装 3 转化 4 视频浏览 5 触达 6 潜客 7 商品销售，**integer**) / `like`(**integer** 1=前 1-20% … 5=前 81-100%，即表现分位) / `period`(天) / `industry`(行业 ID，表在 `github.com/TikHub/TikTok-Ads-Industry-Code`) / `order_by`(`for_you`|`likes`) / `country_code` / `ad_format`(1 Spark Ads) / `ad_language` / `duration` / `pattern_label`(创意趋势标签)。
⚠️ 实测坑：`like` 传字符串 `"top_1"` → HTTP 422；`keyword=skincare + period=30 + like=1` 组合 → `total_count=0`（文档明说「筛得太细会空，Creative Center 只收录部分热门数据」）。**空结果不是 bug，是数据集边界**。

### 2.2 其余可用的数据面（只读 spec，未调）

- **自然流量侧**：`tiktok/app/v3/fetch_video_search_result`（`sort_type` 1=最多点赞、`publish_time` 1/7/30/90/180、`region`）；`tiktok/web/fetch_trending_searchwords`。
- **国内对偶**：`douyin/billboard/*`（热榜/飙升/挑战）、`douyin/index/fetch_content_{publish,interact,consume}_trend`、`douyin/creator/fetch_creator_hot_*_billboard`——抖音侧没有 Creative Center 那种广告表现面，**只有市场热度，没有单条广告的 CTR/分位**。
- **已知缺口（沿用 `docs/research/2026-09-01-shortvideo-data-apis-eval.md` 的结论，仍成立）**：TikHub **没有口播转写**；抖音/TikTok 侧 `caption` 是标题不是文稿；也**没有单条视频的历史时序**（要走势得自己定时轮询落库）。

### 2.3 Vizzy 自己怎么说

| 来源 | URL | 这条证明了什么 |
|---|---|---|
| Vizzy 官网 | https://www.vizzylabs.ai/ | 现在主推的是 agentic UGC 达人投放（招募/评估/按效果付费），四个 agent 里第一个就是 "Trend & Competitor Analysis"，自称监控 "5M+ new videos every day" |
| Vizzy App | https://app.vizzylabs.ai/ | 定位一行字：**"AI Video Search Engine for Creators"**——搜索引擎，不是编辑器 |
| Vizzy Blog | https://app.vizzylabs.ai/blog/creative-hooks-the-proven-formula-to-make-any-video-go-viral | 自称分析 500M+ 视频、拆过 50000+ 高表现视频；结论口径是「前 8 秒必有叙事反转或好奇心转折」——**卖的是 pattern，不是工具链** |

**它难在哪一半**：难在数据面（覆盖量 + 表现指标 + 持续更新），不难在 AI 拆解。而数据面这一半，**TikHub 已经把它变成 $0.001/次的 API**。

### 2.4 自媒体来源（TikHub · 必填）

抓取命令（可重跑）：

```bash
node scripts/research/tikhub-search.mjs \
  --q "TikTok 素材分析 爆款拆解 投放" --platform douyin,bilibili --limit 8 \
  --out docs/research/2026-09-07-tiktok-creative-intelligence/tikhub/
```

产物：`docs/research/2026-09-07-tiktok-creative-intelligence/tikhub/tikhub-search.{json,md}`（抖音 8 + B站 8）

| 平台 | 出处 | 作者 | 时间 | 摘要（原文，未改写） | 提到的工具 |
|---|---|---|---|---|---|
| 抖音 | https://www.douyin.com/video/7596603905338757361 | 跨境 kevin | 2026-01-18 | 「TikTok 如何分析并做出爆款短视频脚本？」 | **Kalodata** |
| 抖音 | https://www.douyin.com/video/7657973779972877684 | 小羊圈 | 2026-07-02 | 「拆解爆款视频背后的流量逻辑，复制成功不靠感觉」 | — |
| 抖音 | https://www.douyin.com/video/7676059240587614629 | 做TK的有里 | 2026-08-20 | 「爆款都在用的内容逻辑：冲突 + 好奇 + 反转」 | — |
| 抖音 | https://www.douyin.com/video/7584384456200768794 | 钟老师聊TK | 2025-12-16 | 「海外短视频爆款拆解纬度」 | — |

**读到的真实摩擦**：
- 「不靠感觉」这四个字是跨境圈的通用口号——**说明痛点被广泛承认，也说明这条赛道已经有人在卖答案**（Kalodata 被点名，是国内跨境圈事实上的选品/素材数据工具）。
- 这些内容清一色停在**「拆解维度」和「内容逻辑」层**（冲突/好奇/反转）——也就是说：**市面上供给最多的是「怎么看」，最少的是「看完之后怎么快速做出来」**。这条缝正好是 Nomi 站的位置。

## 3. 反方视角（先查别人怎么做）

| 别人的做法 | 出处 | 它为什么这么选 | 对我们成立吗 |
|---|---|---|---|
| Vizzy：做视频搜索引擎 + 达人投放闭环，按效果付费 | §2.3 | 它的护城河是**数据规模 + 达人网络**，都是资本/运营密集型 | ❌ 不成立。solo 项目扛不动 500M 视频的抓取与索引；我们也不做达人网络 |
| Kalodata：跨境电商数据平台（选品 + 达人 + 素材） | §2.4 自媒体点名 | 卖的是**决策数据订阅**，用户在它那里看完、去别处做 | ❌ 不成立，且不该正面打。我们不卖数据订阅 |
| TikTok 官方 Creative Center | §2.1 端点即其代理 | 平台自己给广告主的免费创意库 | ✅ **成立且应当直接站在它肩上**——它是这些工具的共同上游，TikHub 把它变成 API |

**关键判断**：上面三家全部止步于「看」。**没有一家把「看到的那条视频」直接变成「你自己的可编辑分镜 + 可生成素材」**——因为它们都没有生成能力。这是结构性差异，不是功能差异（D2）。

## 4. 对 Nomi 的可落地项 / 不落地项

| 项 | 落不落地 | 理由（D2 结构与约束） | 代价 |
|---|---|---|---|
| **A. 素材库新增「找参考」来源**：关键词/行业/国家 → Creative Center 跑量素材列表（封面 + CTR + 表现分位 + 时长）→ 选中即落成项目素材 | ✅ **推荐先做这个** | 它接的是**已有**的 `pasteShareLinkImport` 那条路（分享链接 → 素材），只是把「用户自己去找链接」换成「在 Nomi 里找」。connector 只需在 `tikhubConnector.ts` 的 `tools` 里加端点，出站白名单已覆盖 TIKHUB_HOSTS | 小。一个面板 + 3 个端点 |
| **B. 拆解卡上叠「表现证据」**：拆解结果旁显示 CTR / 行业百分位 / `highlight` 秒点，并把 highlight 秒点标到分镜表对应镜号上 | ✅ 强烈推荐 | 这是**唯一别人给不了的组合**：「第 12 秒是高光」+「第 12 秒这一镜的画面/台词/提示词是什么」。别人只有前半句 | 中。需先探明 `analysis.value` 语义 |
| **C. 画布上加一个「搜索节点」** | ❌ 不建议 | 搜索是**一次性检索动作**，不是要连线、要参与生成、要被撤销/持久化的画布对象。做成节点 = 在画布上养一个二流数据面板，还会撑大 `generationCanvasTypes` 的节点词表（R14.1）。发现属于素材库，不属于画布 | — |
| **D. 自建「500M 视频索引 / 每日榜单库」** | ❌ 不做 | 抓取+存储+去重+更新是持续运营成本，solo 扛不动，且不在护城河上（R20 第三问） | — |
| **E. 定时轮询做「这条推流快不快」的时序** | 🕐 延后 | TikHub 无单条历史，得自建时序库。真实需求要等有人真的问 | — |

**它怎么接上「开放战略」**：A + B 做完后，这条能力应当**同时暴露成 MCP 工具**（`nomi_search_reference_ads` / 拆解已有）——外部 Agent 就能「搜跑量素材 → 拆 → 在 Nomi 里生成」，符合 [[openness-strategy-20260907]] 的「更能被接」。

**用户要权衡的那一个东西（D6）**：
> 我们是要做「**又一个看板**」，还是做「**看完立刻能做出来的那个工具**」？
> 数据面谁都能买（$0.001/次），看板做出来只会被 Kalodata/Vizzy 按住打。真正只有我们能做的是那半句下文——**把那条跑量视频，变成你自己画布上可改的分镜**。所以入口应该长在素材库和拆解卡上，而不是长成一个搜索节点。

## 5. 诚实记分

- **真跑了的**：`search_ads`（两组参数，含一次 422 与一次空结果）、`get_ads_detail`、`get_ad_keyframe_analysis`、`get_ad_percentile` 四个端点，真 key 真响应；`openapi.json` 3.05MB 实读；TikHub 自媒体检索 16 条真产物。约 10 次请求，≈$0.01。
- **只读没跑的**：`get_top_contents_list` / `get_top_ads_filters` / `get_trends_hashtag_*` / 抖音榜单族 / TikTok 自然流量搜索族。
- **没覆盖到的**：① `keyframe.analysis[].value` 在各 `metric` 下的确切语义（是留存率？归一化 CTR？）——**接线前必须再探**；② Creative Center 数据覆盖的国家/行业实际边界（spec 只承认 US/TH 榜单有数据）；③ 广告素材 `video_url.720p` 的有效期与可下载性（未实下）；④ 使用条款：把 Creative Center 素材落进用户项目，`usageStatus` 该判 `reference_only` 还是 `rights_unknown`，**未做法务口径核对**（默认应取更保守的 `reference_only`）。
- **一条自我更正**：初稿把 `tikhubConnector.ts` 的 `unitPriceUsd: 0.005` 记成「与官网 $0.001 对不上的欠账」——**错了，代码是对的**。`fetch_video_high_quality_play_url` 的端点 description 自己写着「价格：0.005$ 一次」，它是高于标准价的溢价端点；`/tiktok/ads/*` 族的 description 里没有价格行，走标准 $0.001。**教训：TikHub 是按端点定价的，不是全站统一价**——接新端点时要逐个读 description 里的价格行，别按官网首页那档一刀切。
