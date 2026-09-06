# TikHub API 对账笔记（自媒体内容检索）

> 状态：📎 长期参考（接口契约笔记，随 TikHub 版本变化时更新）
> 实读日期：**2026-09-06** · 契约来源：`https://api.tikhub.io/openapi.json`（OpenAPI 3.1.0，`info.version = V5.3.2`，spec 自述 `更新时间 2026-06-22`，`环境 Production`）
> 相关：脚本 `scripts/research/tikhub-search.mjs` · 手册 `docs/engineering/agent-orchestration-playbook.md` §15 · 模板 `docs/research/TEMPLATE.md`

## 0. 为什么要接这个（底层逻辑）

调研 agent 现在的信息面只有两类：论文（arxiv）和英文技术博客/开源仓库。**中文自媒体那一整层是盲区**——抖音 / 小红书 / B站 / X 上的创作者每天在讲「我用什么工具、卡在哪、这个新模型到底能不能用」，那是离 Nomi 目标用户最近的一手摩擦，而它从来没进过我们的调研输入。

TikHub 是一个多平台自媒体数据聚合 API：一个 key、一套鉴权、16+ 平台的关键词检索。接它解决的真实摩擦是「反方 agent 要先查别人怎么做，但它只能查得到英文世界」。

**它不解决什么**：它给的是**原文**，不是判断。脚本刻意不做 AI 改写（只截原文前 300 字），因为在「先查别人」这个场景里，二手转述正是要防的东西。

## 1. 基础参数（逐项抄自 spec，不是记忆）

| 项 | 值 | 出处 |
|---|---|---|
| Base URL（非大陆） | `https://api.tikhub.io` | `info.description` → `🔗 Base URL/基础路径` |
| Base URL（中国大陆） | `https://api.tikhub.dev` | 同上，spec 明写主域名在大陆被墙、**请勿跨区使用** |
| 鉴权 | 请求头 `Authorization: Bearer {token}` | `components.securitySchemes.HTTPBearer` |
| 备用鉴权（不推荐） | Cookie `Authorization=Bearer {token}` | 同上；本仓**不使用**这条路径 |
| 方法 | `GET` / `POST`（按端点，见 §2） | `info.description` → `基本HTTP设置` |
| 限流 | **QPS 10/秒** | `info.description` → `⚡ Rate Limit/速率限制` |
| 建议超时 | `>=30s and <=60s`（脚本取 30s） | 同上 |
| 建议重试 | `Max Retry: 3`（脚本总尝试 3 次 = 重试 2 次） | 同上 |
| 端点总数 | 1063 条 path | 本次实读 `openapi.json` 统计 |
| 计费 | 每次成功请求计费（响应默认 message 就写着 `本次请求将被计费`） | `components.schemas.ResponseModel.message_zh` |

文档入口（都在 spec 的 `info.description` 里给出）：
- Swagger UI：<https://api.tikhub.io>
- Apifox 文档：<https://docs.tikhub.io>
- 机器可读契约：<https://api.tikhub.io/openapi.json> ← **本笔记的唯一真相源**
- 状态监控：<https://monitor.tikhub.io>

## 2. 我们用到的四个关键词检索端点

选择原则：每个平台只挑「关键词 → 内容列表」那一个，不碰榜单/达人/电商族（那是另一件事，要用再开）。

### 2.1 抖音 · `POST /api/v1/douyin/search/fetch_video_search_v1`

请求体（`VideoSearchV1Request`，全部可选、都有默认值）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyword` | string | 关键词 |
| `cursor` | integer | 偏移游标，翻页用，取上一次响应的 `data.cursor` |
| `sort_type` | string | `0`=综合 `1`=最多点赞 `2`=最新发布 |
| `publish_time` | string | `0`=不限 `1`=最近一天 `7`=最近一周 `180`=最近半年 |
| `filter_duration` | string | `0`=不限 `0-1` / `1-5` / `5-10000` |
| `content_type` | string | `0`=不限 `1`=视频 `2`=图片 `3`=文章 |
| `search_id` | string | 翻页用，取上一次响应 |
| `backtrace` | string | 翻页回溯标识，取上一次响应 |

同族还有 `fetch_general_search_v1/v2/v3`（综合搜索，请求体字段完全相同）与 `fetch_video_search_v2..v5`。本仓用 `video_search_v1`。

**响应形状（已用真实响应核对）**：spec 里 `data` 是无类型的，但免费 demo 端点 `GET /api/v1/demo/douyin_search/app/general_search`（固定关键词「美食」、缓存 1 小时、**免鉴权**）返回的是同一族结构，2026-09-06 实抓 1.27MB 响应确认：

```
{ code, request_id, message, message_zh, router, params,
  data: { status_code, cursor, has_more, backtrace, extra: { logid, … }, log_pb: { impr_id },
          data: [ { type, aweme_info: { aweme_id, desc, create_time,
                                        share_url, share_info: { share_url, … },
                                        author: { uid, nickname, … },
                                        statistics: { digg_count, comment_count, … } } }, … ] } }
```

要点：条目在 `data.data[]` 而不是 `data.aweme_list`；正文在 `aweme_info.desc`；时间是**秒级** `create_time`；翻页三件套 = `data.cursor` + `data.extra.logid`（当 `search_id`）+ `data.backtrace`。

### 2.2 小红书 · `GET /api/v1/xiaohongshu/app_v2/search_notes`

query 参数：`keyword`（必填）、`page`（从 1 开始）、`sort_type`（默认 `general`）、`note_type`（`不限`/`视频笔记`/`普通笔记`/`直播笔记`）、`time_filter`（`不限`/`一天内`/`一周内`/`半年内`）、`search_id`、`search_session_id`（后两个翻页时回传首次搜索的返回值）、`source`、`ai_mode`。

注意：时间筛选是**中文枚举**，不是时间戳。⚠️ **填错不会报错**——2026-09-06 实测 `time_filter=one_week` 与 `time_filter=<10 位时间戳>` 都照样返回 HTTP 200，只是筛选静默失效。所以枚举值只能靠测试钉住（`XHS_TIME_FILTERS` + `xhsTimeFilter()` 的四档映射有夹具逐档断言）。

**响应形状（2026-09-06 用真实 key 实抓核对）**——比其它三家**多包一层**信封：

```
{ code, request_id, …, data: {                      ← TikHub 信封
    code, success, msg, page, next_page,
    search_id, search_session_id,
    data: {                                          ← 小红书自己的信封
      items: [ { mix_track_id, model_type: 'note',
                 note: { id, title, desc, timestamp,   ← 秒级
                         type, xsec_token,
                         user: { nickname, userid, red_id } } }, … ] } } }
```

三条要点：
1. 条目在 **`data.data.items[]`**，不是 `data.items`。写成后者时 `pickFirst` 会退到 `data.data` 拿回一个**对象**，`Array.isArray` 判否 → **HTTP 200、退出码 0、0 条记录**，在报告里和「今天没人聊」一模一样。
2. `items[]` 里混着 `model_type` 非 `note` 的卡片（广告/用户），归一前要剔掉。
3. 笔记链接必须带 **`xsec_token`**：裸 `/explore/<id>` 对未登录访客打不开。正确形状是 `https://www.xiaohongshu.com/explore/<id>?xsec_token=<token>&xsec_source=pc_search`。
4. 翻页看服务端给的 **`next_page`**（没有 `has_more`）；给不出就是到底了，不许自己 `page + 1` 硬翻。

### 2.3 B站 · `GET /api/v1/bilibili/web/fetch_general_search`

query 参数：`keyword`、`order`、`page`、`page_size` **四个都是必填**；可选 `duration`、`pubtime_begin_s`、`pubtime_end_s`（10 位秒级时间戳）。脚本固定 `order=totalrank`、`page_size=20`。

同族另有 `GET /api/v1/bilibili/app/fetch_search_all` 与 `fetch_search_by_type`。

### 2.4 X（Twitter）· `GET /api/v1/twitter/web/fetch_search_timeline`

query 参数：`keyword`（必填）、`search_type`（默认 `Top`）、`cursor`（游标翻页）。

### 2.5 各平台结果流里都混着非内容卡片

四家都会在搜索结果里塞非创作者内容的卡片，归一前必须剔掉，否则它们会在报告里堆成一排**假的**「未解析出字段」：

| 平台 | 混入的东西 | 判据 |
|---|---|---|
| 抖音 | `type: 6` 相关搜索词卡片（只有 `related_word_list`） | 有没有 `aweme_info` |
| 小红书 | 广告 / 用户卡片 | `model_type === 'note'` |
| B站 | `type: 'ketang'` 付费课程投放（`pubdate` 恒 0） | `type === 'video'` |
| X | 非推文模块卡片 | `type === 'tweet'` |

另：抖音的 `share_url` 带着 TikHub 抓取账号的 `did` / `iid` 等追踪参数，不该进调研产物——脚本改用规范短链 `https://www.douyin.com/video/<aweme_id>`。

## 3. 统一响应信封（`ResponseModel`）

所有端点共用：

```
{ code: 200, request_id, message, message_zh, support, time, time_stamp, time_zone,
  router, params, data: <平台原始载荷> }
```

`422` 返回 FastAPI 的 `HTTPValidationError`（`{ detail: [ValidationError, …] }`）。

**400 的含义（2026-09-06 定性，重要）**：spec 里每个端点都只声明 `200` 和 `422`；参数类型不合走 FastAPI 的 **422**，而枚举值填错**照样 200**（见 §2.2）。也就是说 **400 在这套 API 上不可能是「参数不对」**，只能是上游平台抓取层当时没抓到——那是重试能救的一类抖动。脚本因此把 400 归进 `isRetriableStatus`；2026-09-06 的验收跑里小红书正好吃到一次 400，重试后拿回 3 条，实地印证了这条判断。把 400 当致命错的代价是**一次抖动抹掉整个平台**。

**401 的真实形状**（2026-09-06 用假 token 实测，见 §5）：

```
{"detail":{"code":401,"request_id":"…","message":"Invalid API token, your submitted API token is <你提交的 token>. …","message_zh":"…"}}
```

⚠️ **这条很重要**：TikHub 会把你提交的 token **原样回显在错误信息里**。所以任何把响应体写进日志/报告/截图的代码，都必须先脱敏——`tikhub-search-lib.mjs` 的 `redact()` 就是为这条存在的，并且有测试盯着（`401：不重试，且响应里回显的 token 被抹成 ***`）。

## 4. 字段归一：四家均已实抓核对（2026-09-06）

spec 把每个端点的 `data` 都声明为**无类型**（`ResponseModel.data` 没有 schema），所以字段路径只能靠真实响应核对。**四家已各用真实 key 实抓一次并逐字段对账**，全部记为 `fieldConfidence: verified-against-live-response` + `fieldsVerifiedOn: 2026-09-06`：

| 平台 | 条目路径 | id | 时间 | 作者 | 正文 | 本轮 `missingFields` |
|---|---|---|---|---|---|---|
| 抖音 | `data.data[]` → `aweme_info` | `aweme_id` | `create_time`（秒） | `author.nickname` / `author.uid` | `desc` | 空 |
| 小红书 | `data.data.items[]` → `note` | `id` | `timestamp`（秒） | `user.nickname` / `user.userid` | `desc` | 空 |
| B站 | `data.data.result[]` | `bvid` | `pubdate`（秒） | `author` / `mid` | `title` + `description` | 空 |
| X | `data.timeline[]`（**扁平**） | `tweet_id` | `created_at`（字符串） | `user_info.name` / `screen_name` | `text` | 空 |

两处原先写错、已修：
- **小红书**条目层级少数一层（详见 §2.2），结果是静默 0 条。
- **X** 的条目是**扁平**的，原先按 `rest_id` / `user.screen_name` 取，两个都恒空 → 每条都缺 `id` 和 `url`。真实字段是顶层的 `tweet_id` / `screen_name`，作者名在 `user_info.name`。

归一层仍然保持容错：上游随时会改形状，少字段要留空 + 记进 `missingFields`，**不许静默丢条目**——「这个平台今天没人聊」和「我们没解析出字段」在报告里长得一模一样，那是最贵的一种假绿。产物 JSON 的 `summary` 段就是为了让这三种状态（`ok` / `empty` / `failed`）一眼分得开。

## 5. 本机验证记录（2026-09-06，无 key 环境）

| 路径 | 命令 | 结果 |
|---|---|---|
| 契约实读 | `curl https://api.tikhub.io/openapi.json` | HTTP 200，3,028,187 字节，1063 条 path |
| 真实响应形状 | `curl https://api.tikhub.io/api/v1/demo/douyin_search/app/general_search` | HTTP 200，1.27MB，19 条结果，确认 §2.1 结构 |
| **缺 key** | `env -u TIKHUB_API_KEY node scripts/research/tikhub-search.mjs --q … --out …` | `✖ TikHub 未配置：TIKHUB_API_KEY 为空，今天没查成`，**exit 2** |
| **坏 key** | `TIKHUB_API_KEY=<假值> node scripts/research/tikhub-search.mjs --q … --platform douyin,bilibili` | 两个平台各 HTTP 401、**不重试**、回显 token 被抹成 `***`；全平台失败时 **exit 3** |

## 5b. 真实 key 验收记录（2026-09-06）

| 项 | 结果 |
|---|---|
| 四平台各 `--limit 3` | 抖音 3 / 小红书 3 / B站 3 / X 3，**四家 `missingFields` 全空** |
| 小红书 400 复现 | 验收跑里实地吃到一次 HTTP 400，重试后成功拿回 3 条 → 印证 §3「400 = 上游抖动」 |
| 枚举容错实测 | `time_filter=one_week` / `=<时间戳>` 均返回 200（**填错不报错**，只有测试拦得住） |
| 脱敏 | 跑完 `grep` 产物与全仓，key 前 12 位命中 **0 个文件** |

真实 key 只存在于用户 `~/.zshenv`，没有出现在仓库、文档、测试、日志或截图的任何位置。

## 6. 怎么设 key

```bash
export TIKHUB_API_KEY="…"   # 从 https://www.tikhub.io 用户中心创建
```

放进 `~/.zshenv`（而不是仓库里的任何文件）。脚本**不接受** `--key` 参数——命令行参数会进 shell 历史、进 CI 日志、进截图。
