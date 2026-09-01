# 短视频数据/文稿 API 接入评估：轻抖（Qingdou）vs TikHub

> 日期：2026-09-01
> 类型：文档级调研（**未做真实付费调用**——不问用户要 key，只对官方现役文档/官网/OpenAPI 逐项对账）
> 触发：用户诉求——「用户给链接就能拆（不用下载视频）」+「创作者拿现成文稿（替代/兜底 whisper）」+ 未来「本地短视频数据库 → 定时任务 → 数据走势 → 判断哪些文案快/慢推流」。选一家还是都接，用用户价值想。
> 一手来源已在每节标 URL + checkedAt=2026-09-01。凡未实测调用的结论，本文明说「文档级」。

---

## 0. 一句话结论（先给判断，D5）

**两家不是二选一，是分工互补，且分工线非常干净：**

- **TikHub = 数据面**（结构化：视频元数据/统计、作者主页与作品列表、评论、榜单/热点趋势、无水印直链、分享链接解析）。**它没有把"语音转成文字"的转写能力**——抖音/TikTok 侧只给"标题/描述"字段，不给口播文稿。
- **轻抖 = 文稿面 + 抖音数据面**（提文案=自建 ASR 转写、批量、全网平台；同时也有达人/视频/音乐榜、涨粉趋势、同领域账号监控）。**但它的开发者 API 登录/会员墙后，无公开文档**，自助接入不确定性高。

**推荐（含分期，见 §7）：**
- **v1 最小切片（链接直拆 + 文稿）**：拆解链路的「链接解析 + 无水印直链」接 **TikHub**（有公开 OpenAPI、REST 干净、按次计费、`fetch_one_video_by_share_url`）；「现成文稿」这一路，鉴于**没有任何一家给抖音原生口播字幕**（下详），**优先复用 Nomi 自己已接好的 whisper**，把外部文稿 API 作为**可选兜底/加速**而非依赖。
- **v2（账号数据库 / 走势）**：再评估把 TikHub 榜单/作品列表做成**定时轮询 + 本地时序**的 connector；轻抖只有在拿到其**公开 API 契约**后才作为「抖音垂直数据 + 现成中文文稿」的候选补充。

理由与取舍点见下。

---

## 1. 能力面逐项对账

### 1.1 TikHub（一手：`api.tikhub.io/openapi.json`，2.56MB 规范，checkedAt 2026-09-01；docs.tikhub.io；tikhub.io/pricing）

**平台覆盖（从 OpenAPI 顶层 `/api/v1/{platform}/` 统计，checkedAt 2026-09-01）**：共约 32 个平台命名空间——
`douyin(483 端点)`、`tiktok(205)`、`instagram(94)`、`bilibili(87)`、`weibo(67)`、`xiaohongshu(45)`、`kuaishou(41)`、`zhihu(41)`、`youtube(37+)`、`wechat_channels(16 视频号)`、`lemon8(16)`、`pipixia(17)`、`threads/reddit/twitter/toutiao/xigua/...`。抖音/TikTok/小红书/快手/B站/微博/视频号全覆盖。

| 能力 | TikHub 支持？ | 证据（端点，一手 OpenAPI） |
|---|---|---|
| **分享链接解析** | ✅ 抖音/TikTok/小红书 | `douyin/web/fetch_one_video_by_share_url`、`douyin/web/handler_shorten_url`；小红书 `xiaohongshu/web_v3/fetch_note_detail` |
| **无水印直链** | ✅ | `douyin/web/fetch_video_high_quality_play_url`、`fetch_multi_video_high_quality_play_url`（TikTok 侧 `downloadAddr` 字段，产品页称 "No-watermark video URLs"）|
| 直链有效期 | ⚠️ 文档未明示 | 平台直链通常是**签名短时 URL**（分钟~小时级），实测才知；建议拿到即下载，不落库久存（与 Nomi `resolveVideoLocalPath` 的即抓即用一致）|
| **视频元数据/统计** | ✅ 播放/点赞/评论/转发 | `fetch_one_video` 返回 aweme 详情（`digg_count/comment_count/share_count/play_count` 系字段，TikTok 产品页明列）|
| **作者主页 + 作品列表** | ✅（做"账号数据库"的积木） | `fetch_user_post_videos`、`handler_user_profile`、`fetch_user_profile_by_uid`、`fetch_user_fans_list`、`fetch_user_following_list` |
| **评论** | ✅ | `fetch_video_comments`、`fetch_video_comment_replies` |
| **榜单/趋势（市场级）** | ✅ **但是"市场热度"不是"你这条的历史"** | `douyin/index/fetch_content_publish_trend`、`fetch_content_interact_trend`、`fetch_content_consume_trend`、`fetch_multi_keyword_hot_trend`、`douyin/billboard/*`（hot_rise_list/hot_challenge_list…）、`douyin/creator/*` 榜单族 |
| **单条视频/账号的时间序列（"推流快慢"）** | ❌ 无原生历史 | OpenAPI 无 per-video 历史端点。要"走势"须**自己定时轮询 `fetch_one_video`/`fetch_user_post_videos` 并落库做差**（见 §7 v2）|
| **口播文稿/字幕转写（抖音/TikTok）** | ❌ **没有** | 全规范里 `transcript:3 / asr:4 / 转写:1 / speech:1`（近零，且都在描述里）；**字幕/caption 端点只有 YouTube（`get_video_subtitles`/`get_video_captions`）和 B站（`fetch_video_subtitle`）——这两个平台有原生 CC 轨**。抖音/TikTok 的 `caption`/`name` 字段=**视频标题/描述**，不是口播文稿 |

**一句话评**：TikHub 是"给链接/给账号 → 拿到干净结构化数据"的**数据面主力**，广度和端点密度都很强；唯独**不做语音转文字**，抖音侧也**不给现成口播字幕**。

### 1.2 轻抖 Qingdou（一手：qingdou.vip，checkedAt 2026-09-01；公司=杭州大焱网络科技有限公司，浙ICP备2021005782号-5）

产品是**短视频创作工具箱**（Web + 微信小程序 + APP + 会员），不是纯 API 公司。功能面（从官网导航与工具页实读）：

- **文案**：提文案（口播转文字）、图片提文案（OCR）、音视频提文案、**达人作品解析**、敏感词检测。提文案页明示：**"支持全网主流短视频平台（含口令）"、"单次最多 100 条批量提取"**。
- **数据服务**（据知乎《完全免费第三方抖音数据分析工具——轻抖》checkedAt 2026-09-01）：作品数据精分析（**播放/互动/粉丝**）、**实时 Top1000 视频榜 + Top50 音乐榜**、**达人涨粉飙升榜**、**同领域优质账号监控——实时追踪其视频/直播/涨粉动向**（=账号级走势跟踪）、热点/榜单。还有账号诊断、账号估价、视频检测（测爆款潜力）、智能分镜（自动拆条）。
- **变现**：商品/直播/短视频营销任务。

| 能力 | 轻抖支持？ | 证据/说明 |
|---|---|---|
| **文稿提取** | ✅ 全网平台、批量 100 条 | 官网工具页；**是自建 ASR 转写，不是平台原生字幕**（见 §1.3 机制）|
| 文稿语言/质量 | ⚠️ 文档级未标 | 中文口播为主的国内工具，中文 ASR 预期不弱于通用 Whisper；无公开质量指标 |
| **分享链接解析 / 去水印** | ✅ | 批量去水印、视频号去水印、达人作品解析（拿标题/无水印视频/图集）|
| **抖音元数据/统计** | ✅ 播放/互动/粉丝 | 知乎实读 |
| **作者主页/作品列表** | ✅（达人作品解析 + 同领域账号监控）| — |
| **时间序列/走势** | ✅ **抖音账号级**（涨粉/播放趋势、竞品监控） | 知乎实读；**这是轻抖相对 TikHub 的差异点**——它把"账号走势"做成了产品能力 |
| 覆盖平台（数据面） | ⚠️ **抖音为主** | 文稿是全网，但数据分析/榜单是抖音生态 |
| **公开开发者 API + 文档** | ❌ **无公开文档** | 导航有"轻抖API"入口、工具页有"API ▾"，但 `pctool/api-doc`、`/api` 全部**重定向到登录/会员墙**（`work-benches?redirect=...`）；WebSearch 亦查不到任何第三方公开的轻抖 API 端点/apikey/计费文档。**其 API 更像"会员增值/企业采购"通道，不是自助 REST** |

**一句话评**：轻抖是"抖音生态的文稿 + 数据一体化产品"，**账号级走势是它的长板**；但作为**被程序调用的 API**，它公开面几乎为零——契约、计费、限流全在墙后，接入不确定性高。

### 1.3 关键机制核对：这类"提文案"到底是原生字幕还是自己转写？（一手：`github.com/yzfly/douyin-mcp-server` SKILL.md，checkedAt 2026-09-01）

该开源项目是"抖音视频转文案"最典型的公开实现，机制为三步：
1. **解析抖音分享链接 → 提取真实视频 URL（无水印）**；
2. **下载视频 → FFmpeg 抽音频（MP3）**；
3. **调云端 ASR（硅基流动 SenseVoice API）做语音识别**。

**结论（load-bearing）**：抖音**不对外暴露口播原生字幕**，所以"提文案"本质上都是**别人替你跑了一遍 ASR**（SenseVoice / Whisper 类）。轻抖的提文案几乎必然同理。**这直接回答用户的"文稿替代/兜底 whisper"问题：外部文稿 API ≈ 别人的 Whisper，质量同量级，不是"更权威的地面真值"**。它的价值是**省算力/省接线**（尤其批量、中文），不是质量碾压。**唯一例外**：YouTube/B站有原生 CC，TikHub 能直接取——但那不是用户点名的抖音场景。

---

## 2. 接入形态

| 维度 | TikHub | 轻抖 |
|---|---|---|
| REST 形状 | ✅ 干净：`GET https://api.tikhub.io/api/v1/{platform}/{surface}/{action}`；OpenAPI/Swagger 全量可测（`api.tikhub.io/openapi.json`）；官方 Python SDK（PyPI `tikhub`，1106 端点，方法名 = path basename）| ❌ 无公开 REST 契约；疑似会员/企业 API，未公开 |
| 鉴权 | API key，`Authorization: Bearer <key>`（SDK 用 `api_key` kwarg / `$TIKHUB_API_KEY`）；一把 key 通吃全部平台，无按平台分订阅 | 未知（墙后）|
| **定价** | **按次 pay-as-you-go，多数端点 $0.001/次起**，量大自动折扣；**非 200 不计费**；无传统免费额度但注册送额度；无预设套餐上限（tikhub.io/pricing，checkedAt 2026-09-01）| 未知；产品侧是**会员订阅制**（开通会员/企业采购），API 计费未公开 |
| 速率限制 | 文档未给硬 QPS 数字；按日用量分层折扣 | 未知 |
| 数据实时性 | 实时抓取（产品口径）| 榜单"实时更新"（产品口径）|

**接入形态判断**：TikHub 是**为开发者设计的 API 产品**（OpenAPI + SDK + 按次计费 + 一把 key），几乎零对接摩擦；轻抖是**为创作者设计的 SaaS**，API 是附属会员能力，**没有可自助对接的公开契约**——对"Nomi 里做成 connector"这件事是硬伤。

---

## 3. 合规与风险（D4：诚实评，不藏）

**两家本质相同**：都是**第三方对平台数据的抓取/代理**（reseller-of-scraped-data），不是抖音/TikTok 官方开放平台授权数据。由此的风险是**类别风险**，不是某一家的个别毛病：

1. **平台 ToS 风险**：抖音/TikTok 的 ToS 一般禁止未授权抓取。用这类 API = 站在灰产边缘。**风险主体是谁承担，取决于 key 谁持有**（见第 4 条）。
2. **稳定性/断供风险**：抓取型 API 随平台风控更新而周期性坏点/涨价/下架端点是常态。TikHub 有一整套 `generate_ttwid/generate_verify_fp/fetch_douyin_web_guest_cookie` 等**风控对抗端点**，说明它在持续和抖音风控赛跑——能力强，但也意味着**端点可能随时变**。口碑面：TikHub Trustpilot 仅 2 条评价（均 5 星，2025-09，样本极小，不足以证明长期稳定），**不能据此下"稳定"结论**；轻抖运营多年（2020 起）产品侧稳定，但 API 面无公开 SLA。
3. **数据合规 / 谁背风险（对 Nomi 尤其关键）**：Nomi 是**本地优先桌面应用**。
   - **key 由用户自带（BYO-key）**：调用以用户身份发生，ToS/封号/费用风险落在用户，Nomi 只是"用户配置的一个 connector"——**风险面最小，符合 Nomi 一贯的"用户配 key"模型**（对齐 §4 的 `secretOwner: 'nomi-settings'` 用户侧存储）。
   - **产品内置 key（Nomi 替所有用户调）**：= **Nomi 替用户背抓取风险 + 承担全量费用/被封的单点**。**强烈不建议**。
   - **数据出境**：把用户给的链接/账号发给 TikHub/轻抖 = 一次数据出境，必须走 Nomi connector 的 `dataEgress` 声明 + 运行前预览（§4）。

**诚实边界**：本文**未做真实付费调用**，未验证直链有效期、真实 QPS、断供频率、轻抖 API 是否真存在自助形态。这些只有拿 key 实跑才能坐实。

---

## 4. 与 Nomi 现有件的咬合

### 4.1 该落成什么形态？→ **`ConnectorDefinition`（P1 复用合同，不新造）**

一手：`docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md`（#226，能力目录五合同之一）。其 §5.5 `ConnectorDefinition` 正是为"外部 API/MCP/素材源桥"设计，字段与这两个 API **天然咬合**：

```ts
type ConnectorDefinition = CatalogItemSummary & {
  kind: 'connector'
  transport: 'native-api' | 'mcp-stdio' | 'mcp-http'   // TikHub = native-api（REST）
  auth: { kind: 'none'|'api-key'|'oauth'; secretOwner: 'nomi-settings' } // ← BYO-key 落在 nomi-settings，正好把风险留给用户侧
  network: { allowedOrigins: string[]; redirectPolicy }  // allowedOrigins=['api.tikhub.io']
  tools: Array<{ externalName; nomiName; inputSchema; outputSchema;
    effect: 'read'|'download'|'write'|'spend'; maxBytes? }> // 解析=read/download；按次计费=spend
  dataEgress: { categories: string[]; retention? }        // 声明"把链接/账号发给第三方"
}
```

- **effect 语义正好用上**：`fetch_one_video_by_share_url` = `read`；`fetch_video_high_quality_play_url`→下载 = `download`；**按次计费 = `spend`**（触发 Nomi 既有费用确认卡）。
- **文稿/取证进 `AssetSourceEvidence`**：能力目录 P0 已把 `AssetSourceEvidence`/素材 sidecar 的 `sourceEvidence`/`rightsStatus` 列为一等合同（§13 P0.1、§11.3）。外部拿来的直链/文稿/元数据应落成 `AssetSourceEvidence`（来源=connector、`rightsStatus: unknown`——**绝不推断可商用**，与既有纪律一致）。
- **风控/rights 提醒**：这类数据是抓来的，`rightsStatus` 应缺省 `unknown` 或 `restricted`，交付时按既有"缺署名/未知许可只拦异常"处理。

### 4.2 关于任务里点名的 `2026-08-31-agent-material-channels-and-local-endpoints.md`

**该文件名在 origin/main（HEAD `5aab2376`）上不存在。** 最接近的是 `docs/plan/2026-08-31-asset-upload-routing.md`（"资产上传路由与公共中转"）。但**它讲的是"出站"**——把用户本地素材**上传成公网 URL 喂给模型供应商**（KIE/APIMart/fal/Replicate/Runway/RunningHub + 用户 Relay + Nomi 公共 Relay + 匿名链兜底）。**方向相反**：本评估的两家 API 是**入站数据摄取**，不是素材上传。所以**"三通道分工"合同管不到这两个 API**；正确的复用锚点是 §4.1 的 `ConnectorDefinition`。（此点提请复核：任务假设的那份"material-channels/local-endpoints"文档要么未合入、要么改名成了 asset-upload-routing。）

### 4.3 拆解链路接"链接解析"的最小改动面（一手：`electron/video/deconstructVideo.ts` + `electron/video/extractVideoFrame.ts:47`）

**好消息：拆解核心几乎不用改。** `deconstructVideo({ videoUrl, projectId })` 的 `videoUrl` 已经支持三态，其中 **`http(s)://` 直链会走 `resolveVideoLocalPath` → `hardenedFetch`（私网/回环拦截 + 重定向复检 + 300MB/60s 上限）下载到临时文件**（`extractVideoFrame.ts:57-70`）。

因此接"链接直拆"的最小面是**在拆解上游加一步"分享链接 → 无水印直链"的解析**，把解析出的 `https://...mp4` 原样喂进现有 `videoUrl`：

```text
用户贴分享链接/口令
  → [新增] connector.resolveShareUrl(link)  // TikHub fetch_one_video_by_share_url → play_url
  → deconstructVideo({ videoUrl: <直链>, projectId })   // ← 现有链路，零改动
```

- **不改** `deconstructVideo` 的签名与内部；直链下载/抽帧/VLM/whisper 全复用。
- **whisper 兜底位置已现成**：`transcribeShots()` 内 `runTask({kind:'transcribe'})` 走 whisper-1。若未来要用"外部现成文稿"替代/兜底，注入点就是这里（用 connector 返回的文稿覆盖/回填 `dialogues`），而非改画面那一路。**但按 §1.3，外部文稿≈别人的 ASR，v1 先不依赖它，保留 whisper 主路**。
- SSRF 加固已覆盖第三方直链（hardenedFetch 与 importRemoteAsset 同源），**新 connector 出站同样应过 hardenedFetch/allowedOrigins**，别新开一个裸 fetch。

---

## 5. 分工判断

**选一家够不够？**
- **只接 TikHub**：数据面全、链接解析强、REST 干净、按次计费——**"链接直拆"完美满足**。缺口 = **抖音口播文稿要自己 ASR**（Nomi 已有 whisper，其实不缺）+ **单条/账号的"推流走势"要自己轮询落库**（v2 工程量）。
- **只接轻抖**：文稿 + 抖音账号走势一体，且是中文母语工具——**但没有公开 API 契约**，做不成可自助对接的 connector；且数据面**抖音为主**，跨平台（TikTok/小红书全量作品/评论/搜索）不如 TikHub。
- **都接**：文稿走轻抖（若拿到 API）、数据走 TikHub——功能最全，**但引入两套第三方抓取依赖 = 双倍 ToS/断供/计费面**，对 solo 维护是负担（D2：广度是敌人）。

**分工线（谁管什么）**：
- **链接解析 + 无水印直链** → **TikHub**（公开、干净、按次）。
- **视频/账号数据、作品列表、评论、榜单/市场趋势** → **TikHub**。
- **口播文稿** → **优先 Nomi 自有 whisper**；外部文稿（TikHub 无、轻抖有但墙后）仅作**可选兜底/中文批量加速**。
- **抖音账号级走势跟踪（涨粉/播放/竞品监控）** → 现成产品能力在**轻抖**；但若要程序化进 Nomi 本地库，**用 TikHub 端点自己定时轮询做差**更可控（不依赖轻抖墙后 API）。

**只接一家会缺什么用户价值**：只接 TikHub，短期**不缺**用户点名的两个直接价值（链接直拆 ✓、现成文稿由 whisper 兜 ✓）。真正"缺"的是**开箱即用的抖音账号走势看板**——那是 v2 的产品化命题，不是 v1 拆解闭环的阻塞项。

---

## 6. 对比表（速览）

| 维度 | **TikHub** | **轻抖 Qingdou** |
|---|---|---|
| 定位 | 多平台数据 API（开发者产品）| 抖音生态创作工具箱（创作者 SaaS）|
| 公开 API + 文档 | ✅ OpenAPI/Swagger/SDK | ❌ 登录/会员墙，无公开契约 |
| 平台广度（数据） | ✅ 32 命名空间（抖/TT/小红书/快手/B站/微博/视频号…）| ⚠️ 数据以抖音为主；文稿全网 |
| 分享链接解析 + 无水印直链 | ✅ `fetch_one_video_by_share_url` + `fetch_video_high_quality_play_url` | ✅ 去水印/达人作品解析 |
| 视频统计（播放/赞/评/转） | ✅ | ✅（抖音）|
| 作者主页 + 作品列表 | ✅ `fetch_user_post_videos` 等 | ✅ 达人作品解析 + 账号监控 |
| **口播文稿转写** | ❌（抖/TT 无；YouTube/B站有原生 CC）| ✅ 自建 ASR、批量 100 条、全网 |
| **单条/账号时间序列走势** | ❌ 原生无（须自轮询落库）；有**市场级**趋势/榜单端点 | ✅ **账号级**涨粉/播放趋势 + 竞品监控（产品能力）|
| 鉴权 | Bearer API key，一把通吃 | 未知 |
| 定价 | 按次 $0.001/起，非 200 不计费，量大折扣 | 会员订阅制；API 计费未公开 |
| 稳定性口碑 | 样本极小（Trustpilot 2 条）；靠风控对抗端点持续追平台 | 产品运营多年稳定；API 无公开 SLA |
| 合规本质 | 第三方抓取/代理（非官方授权）| 第三方抓取/代理（非官方授权）|
| 与 Nomi 咬合 | `ConnectorDefinition(native-api)` 完美咬合；直链喂现有 `deconstructVideo.videoUrl` 零改核心 | 同为 connector，但无公开契约→做不成自助 connector |

---

## 7. 推荐与分期

### v1 最小切片：链接直拆 + 文稿（贴合用户点名的两个直接价值）
1. **只接 TikHub**，做成一个 **`ConnectorDefinition`（transport `native-api`，auth `api-key`，secretOwner `nomi-settings` = BYO-key）**。首批只暴露两三个 `read/download` 工具：`fetch_one_video_by_share_url`、`fetch_video_high_quality_play_url`（可选 `fetch_one_video` 拿元数据）。
2. **拆解链路**：上游加"分享链接→无水印直链"一步，直链原样进 `deconstructVideo({videoUrl})`——**核心零改动**（§4.3）。出站过 hardenedFetch/allowedOrigins。
3. **文稿**：**继续用 Nomi 现有 whisper 主路**（`transcribeShots`）；外部文稿先不接（§1.3：外部≈别人的 ASR，不值得为 v1 引第二依赖）。
4. **风险姿态**：key 用户自带；`dataEgress` 声明"把链接发给 api.tikhub.io"；`spend` 工具走既有费用确认卡；素材落 `AssetSourceEvidence` 且 `rightsStatus: unknown`。
5. **诚实边界给用户**：这是第三方抓取型 API（非官方授权），直链短时有效、端点可能随平台风控波动——这些照 Nomi 失败卡三段式（发生什么/为什么/下一步）呈现。

**v1 出口**：用户贴一条抖音/TikTok/小红书分享链接 → Nomi 解析出直链 → 走通现有拆解出分镜表；文稿由 whisper 产出。**不引入轻抖，不内置 key，不做走势看板。**

### v2：账号数据库 / 走势（用户的"定时任务→数据走势→快慢推流"）
1. 扩 TikHub connector：加 `fetch_user_post_videos`/`handler_user_profile`/榜单趋势端点。
2. **本地时序**：做"定时轮询 + 落本地库 + 做差"得到 per-video/账号的播放/互动增速曲线（TikHub 无原生历史，"走势"必须 Nomi 侧自建——这恰是"本地优先桌面应用"的护城河型能力：**数据攒在用户本机，不假手第三方看板**）。
3. **轻抖**仅在**拿到其公开 API 契约（端点/鉴权/计费/限流）后**，才评估作为"抖音垂直数据 + 现成中文文稿"的补充；否则不纳入（无契约=做不成 connector）。
4. 定时任务复用 Nomi 既有任务/调度设施，不新造第二套。

**v2 决策点（留给用户拍板，产品方向）**：走势看板要不要做成 Nomi 一等功能？还是只作为"拆解前的选片辅助数据"？——这是产品广度取舍（D2），建议等 v1 拆解闭环跑顺后再定。

---

## 8. 诚实边界（复述）

- **文档级评估**：未做任何真实付费调用，未验证直链 TTL、真实 QPS/限流数字、断供频率、轻抖 API 是否真有自助形态及其计费。
- **轻抖 API 面全在登录/会员墙后**，本文关于其 API 的判断基于官网导航 + 工具页 + 第三方评测 + 同类开源机制的推断，非其官方 API 文档实读（因其无公开文档）。
- **任务点名的 `2026-08-31-agent-material-channels-and-local-endpoints.md` 在 main 上不存在**（最接近=`asset-upload-routing.md`，且方向相反是出站上传）——本评估改以 `ConnectorDefinition` 为咬合锚点，提请复核该文档名。

---

## 附：一手来源清单（checkedAt 均 2026-09-01）
- TikHub OpenAPI 规范（端点全量）：`https://api.tikhub.io/openapi.json`
- TikHub 文档站：`https://docs.tikhub.io/`、`/doc-4592751`（Introduction）
- TikHub 定价：`https://tikhub.io/pricing`
- TikHub TikTok 产品页：`https://tikhub.io/tiktok-api`
- TikHub Python SDK：`https://pypi.org/project/tikhub/`
- TikHub 口碑：`https://www.trustpilot.com/review/tikhub.io`
- 轻抖官网/工具页：`https://www.qingdou.vip/pctool/text-extract`（+ `/pctool/api-doc`、`/api` 均重定向登录）
- 轻抖数据能力（第三方实读）：`https://zhuanlan.zhihu.com/p/340218470`
- 抖音提文案机制（开源实现，证明 ASR 而非原生字幕）：`https://github.com/yzfly/douyin-mcp-server/blob/main/douyin-video/SKILL.md`
- Nomi 咬合合同：`docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md`（ConnectorDefinition/AssetSourceEvidence）
- Nomi 拆解入口：`electron/video/deconstructVideo.ts`、`electron/video/extractVideoFrame.ts:47`（resolveVideoLocalPath 已支持 http 直链）
