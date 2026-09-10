# C71 先查别人 / 反方事实报告（2026-09-10）

## 核心反方结论

把 `6` 换成 `8` 或 `10` 没有修掉额度所有权错误；把官网示例 `Semaphore(10)` 抄到 JSON 也一样。供应商额度取决于实际服务端、账号、模型、接口，而非模型品牌。**公开文档没有给的数字必须保留 unknown，不能伪装为 unlimited，也不能拍一个默认。RPM 不等于整个异步生成生命周期的并发数。** 最早共享边界必须覆盖所有真实提交入口，且供应商任务直到终态才释放 inflight 槽；HTTP 提交响应只结束请求，不结束生成。

已按 web-access 技能检查 Node/CDP 可用，使用公开官方 Markdown/HTML 获取一手原文；没有使用第三方转述、模拟重放或付费请求。本报告只读生产文件。

## 限制 / 出处 / 我们怎么用

| 供应商 | 核实限制 | 官方出处 | 运行时使用 |
|---|---|---|---|
| APIMart | 公开文档未发布图/视频统一并发数字、RPM 数字、账号分层表或额度查询 API。MJ 文档明确存在每分钟提交上限但未给值，真实生成并发由系统容量决定、超过排在供应商。 | https://docs.apimart.ai/en/development ; https://docs.apimart.ai/en/api-reference/images/midjourney/best-practices ; https://docs.apimart.ai/en/index | `unknown` 为事实状态；不要把原厂 MiniMax/Google 等限制套到 APIMart。已知账号契约/真实响应头可覆盖 unknown。无已知额度时不创建人造固定生命周期队列，保留明确更低的用户偏好、实时 429 冷却与观测到的自适应限制。 |
| MiniMax 中国区（Nomi 当前 api.minimaxi.com） | 按模型/接口/账号分层，详见下表；主账号和子账号共享。H3 并发 30、RPM 300；其他类型不能拿 RPM 当 inflight。 | https://platform.minimaxi.com/docs/guides/rate-limits | 数据档案需绑定 endpoint region + account tier + model/interface；账号类型未知不能默认为充值。明确文档值可以进入带 URL 的契约数据，运行时代码仅读契约，用户只可压低。 |
| DeepSeek | 账号级模型并发：deepseek-v4-pro 500；deepseek-v4-flash / deepseek-v4-flash-vision-exp 2500。超过 429；相同账号所有 API key 合计。扩容需申请，无额外费用。未公布 RPM/TPM 数字/动态额度查询 API。 | https://api-docs.deepseek.com/quick_start/rate_limit ; https://api-docs.deepseek.com/quick_start/error_codes | 只对明确模型 ID 生效，旧 V3 / unknown 模型不能套 V4 数字；流式请求从发送直到完整响应一直占并发。按账号聚合，扩容账号以其契约覆盖。 |

## APIMart 原文及排除证据

- Development：`429 | Rate limit exceeded | Reduce request frequency`。
- MJ best-practices：`The platform has a per-minute submission cap; exceeding it returns 429, which needs backoff retry.`
- 同页：`Actual generation concurrency is determined by system capacity; exceeding it queues; a task staying in SUBMITTED for a long time usually means it is queued.`
- 同页：429 建议 `Exponential backoff + jitter`。示例是 `time.sleep((4 ** attempt) + random.uniform(0, 1))`，属于 MJ 集成建议，不能声称为所有 API 的强制退避契约。
- 同页 `sem = asyncio.Semaphore(10) # client submits at most 10 concurrently` **只是示例，不是供应商上限**。
- 首页：`Check latency and rate limits in Console Dashboard.` 因此公开站没数不等于账号控制台没数，但不能猜测控制台具体字段或虚构接口。
- 官方 Models Metadata API https://docs.apimart.ai/en/api-reference/texts/models/list 支持 category/tags/schema 扩展，阅读页中无 rate/concurrency 配额字段。
- 官方 token balance https://docs.apimart.ai/en/api-reference/account/token-balance 与 user balance https://docs.apimart.ai/en/api-reference/account/user-balance 返回余额/credits。`unlimited_quota` 是资金余额令牌额度，**不等于无限并发**。这两个接口不能作为并发发现 API。
- 所读官方文档未承诺 `Retry-After` 一定返回；只能“响应实际有则尊重”，不能写作“供应商保证”。

## MiniMax 中国区实际分档

| API / 模型 | 免费账号 | 充值账号 | 并发 |
|---|---|---|---|
| MiniMax-M3 | RPM 20 / TPM 1,000,000 | RPM 200 / TPM 10,000,000 | 未公布 |
| M2.7 / M2.7-highspeed / M2.5 / M2.5-highspeed / M2.1 / M2.1-highspeed / M2 | RPM 20 / TPM 1,000,000 | RPM 500 / TPM 20,000,000 | 未公布 |
| Hailuo 系列 Video Generation | RPM 20（表未分层） | 同左 | 未公布（—） |
| MiniMax-H3 Video Generation V2 | RPM 300（表未分层） | 同左 | inflight 30 |
| T2A v2 speech-02-hd/turbo, 2.6-hd/turbo, 2.8-hd/turbo | RPM 10 | RPM 20 | 未公布 |
| Voice Cloning | RPM 60 | RPM 60 | 未公布 |
| Voice Design | RPM 20 | RPM 20 | 未公布 |
| Image Generation | RPM 10 / 文档另写 TPM 60 | 同左 | 未公布 |
| Music Generation music-2.6 / music-cover / music-2.0 | RPM 3 / CONN 3 | RPM 120 / CONN 20 | 见左 |

中国区原文：“我们会根据您使用的模型、接口以及您拥有的账户类型，对您的账号（包括主账号+子账号）实施相应的速率限制策略。即您的主账号和子账号共同享有以下所有速率限制。”

中国区原文：“您将收到速率限制的返回报错……此时 API 将会拒绝满足进一步的请求，直到经过指定的时间。”

**地区差异：** 国际区 https://platform.minimax.io/docs/guides/rate-limits T2A 是 RPM 60，音乐未列免费层并含 Music-3.0；不能用于当前 `.com` 中国区种子。中国区 image 表中的 TPM 60 与图像接口语义可疑：如不实际消费 tokenizer 不要伪造 token 计量或改称 RPM。

错误码官方 https://platform.minimax.io/docs/api-reference/errorcode （中国区应以对应中文错误页复核）：1002 rate limit → retry later；1039 token limit → retry later；1041 conn limit → contact if persists；2045 rate growth limit → avoid sudden increases/decreases。当前 Nomi `categorizeVendorFailure` 把无 HTTP 状态的 >=1000 一概归 input/nonretryable，会错过这族限流，必须通过供应商契约分类，避免把其他供应商同数字业务码误判。

## DeepSeek 原文

- `A request counts as one concurrent connection from the time it is sent until the model response is complete`。
- `Concurrency limits are calculated at the account level, regardless of which API Key is used`。
- `For a given account, API requests within the concurrency limit will receive a response; when the concurrency limit is exceeded, you will receive an HTTP 429 error code`。
- 扩容账号仍有 user_id 单独限制，默认各 user_id 合计；不能为每 key 各开完整池。
- Error Codes：429 `Please pace your requests reasonably.` 未给固定退避时长，也未承诺 Retry-After。
- 旧知识 “DeepSeek 不限并发” 已过时，此处是今日实时一手文档。

## 本地接入边界与最小建议

- `electron/catalog/types.ts:231` Vendor 与 `:256` Model 都仅有 `meta?: unknown`，无已类型化并发/RPM/TPM契约。`src/config/modelArchetypes/types.ts:129` 是供应商无关模型能力档案，不能把 account/region quota 放入模型本体。
- `electron/catalog/minimaxOfficial.ts:4` 当前 seed baseUrl `https://api.minimaxi.com`，注释明确同一 key 走 `.io` 会 401。供应商限制按实际 baseUrl region 取值。
- `electron/vendor/vendorHttp.ts:56` VendorErrorStructured 未保留 Retry-After；`:100` categorizeVendorFailure 无供应商上下文，>=1000 一概非重试。建议共享 HTTP 响应边界解析 Retry-After（秒/HTTP date）、适用 x-ratelimit headers，结构化穿过 IPC；仅识别供应商已声明的逻辑码。
- `electron/catalog/nativeWireProfiles.ts:20` 是报文契约映射，已有模型身份→create/query 表；调度限制应该是旁边供应商事实，而不是新增一套模型身份系统。
- `src/workbench/generationCanvas/runner/catalogTaskActions.ts:153` 有轮询 429 退避，但不能代替 create 限流；submit 和 poll 需按真实接口作用域分别计速，不能每秒 poll 消耗“Video Generation create RPM”误桶。
- 最小契约内容：来源 URL、核实日期、endpoint/region、provider account scope、task operation/model matcher、known/unknown、可选 inflight/RPM/TPM、账号 tier、限流业务码；代码计算 min(明确供应商上限, 更低用户偏好)，未知不偷偷落到拍脑袋常量。
- 并发必须占到上游任务终态；RPM 只统计对应接口真实请求。上游可承接队列时应记录 `provider_queued`，不能报告为 Nomi 队列。
- 自适应新值应由观测限流时有效 in-flight/时间窗/响应元数据派生；不要加“失败后固定变成 3”“最大 8”“每次恢复到 12”。每账号/接口独立，不能一个供应商429停所有人。
- 真验证：2 镜素材只能证明这两镜真实端到端八站；第7/8镜等待只能来自真实8路loopback进入生产队列，不得声称2镜付费样本测到了第7/8镜。真实旧版基线不存在时如实写“无同条件基线”，不能复用缩放数据。

## 原始证据文件

`/tmp/c71-apimart-development.txt`、`/tmp/c71-apimart-index.txt`、`/tmp/c71-apimart-mj.txt`、`/tmp/c71-apimart-models.txt`、`/tmp/c71-apimart-token.txt`、`/tmp/c71-apimart-user.txt`、`/tmp/c71-minimax-cn.txt`、`/tmp/c71-minimax-limits.txt`、`/tmp/c71-minimax-errors.txt`、`/tmp/c71-deepseek.txt`、`/tmp/c71-deepseek-errors.txt` 为抓取原文。

## 补充：APIMart 通用视频队列与真实控制台（优先采用本节）

通用任务状态官方 https://docs.apimart.ai/en/api-reference/tasks/status （原文 `/tmp/c71-apimart-tasks.txt:455`）明确 `pending - Queued for processing`、`processing - In progress`，并声明 result.videos 用于 video generation。VEO3 https://docs.apimart.ai/en/api-reference/videos/veo3/generation 与 Hailuo https://docs.apimart.ai/en/api-reference/videos/minimax-hailuo/generation 的 `/v1/videos/generations` 初次响应均为 `status: submitted, task_id`，随后用通用任务查询。因此 **server-managed queue 有通用视频独立证据，不靠 MJ 外推**；仍无实际 inflight 数字。

按父任务要求，在自己创建的新后台 tab 检查现有登录态控制台：`https://apimart.ai/zh/overview` 无并发/RPM/TPM/速率限制字段；`https://apimart.ai/zh/keys` 顶部公开展示 **RPM: 500**。

进一步检查该页官方前端代码：`https://apimart.ai/_next/static/chunks/2srszfg7l1hai.js` 命中片段：

```js
children:["RPM: ",(0,i.jsx)("span",{className:"font-medium text-foreground",children:"500"})]
```

**证据等级：供应商官方产品 UI 声明的通用 RPM，不是实时账号 API 返回值。** 该数字可作为带页面 URL/核实日期的 APIMart 通用请求速率契约初值，并由实际限流响应降低；不能声称是 account-specific capacity，也不能拿 RPM500 变成生成并发500。页面没有按任务种类注明 scope，因此若用此值，最保守的契约语义为供应商 API 共享 RPM（注意该页没定义 poll 是否消耗额度，需要真实429观测），而不是每模型分别500。

当前页面资源可见 `/api/user/self`、`/api/web/user/self`、`/api/status`、`/api/web/key_group/list`；普通浏览器 fetch 调前三个账号接口返回401，故本次没有得到带有效前端认证头的账号配额响应；`/api/status` 200 的公开配置中无 rate/concurrency/rpm/tpm 字段。没有输出 token、邮箱或用户 ID，没有创建/修改 key、账号或计费状态。已关闭自建后台 tab，不操作用户原有 tab。

因此最小诚实表示：`inflight: unknown + queueOwner: provider`，`requestsPerMinute: 500 + source: official-console-static`。初值是官方声明的 RPM，未知 inflight 不需要数字化成 Infinity；调度直接交给其已声明队列，在本地只对真实请求速率、用户明确更低偏好以及429反馈实施准入。若接口模型有独立 quota，应由后续观测/账号契约覆盖此泛用声明。

## 补充：MiniMax 中国区错误码差异

已复核 https://platform.minimaxi.com/docs/api-reference/errorcode ，原文 `/tmp/c71-minimax-cn-errors.txt`。1002 “请求频率超限” → “请稍后再试”；1041 “连接数限制” → “请联系我们”；2045 “请求频率增长超限” → “请避免请求骤增骤减情况”。**中国区1039写“Token 限制 → 请调整 max_tokens”**，与国际区 retry-later 不同；不能在当前 `.com` 一概把1039归可重试速率超限。2056 是 Token Plan资源窗口限制，与PAYG调用限速也要区分。
