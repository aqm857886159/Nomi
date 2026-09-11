# 真实付费验收只用 APIMart；task_failed 先怀疑素材本身，别先怀疑链路

> 📎 教训 · 首次记录 2026-08-24 · 补充 2026-09-11 · 状态：现行
> **触发场景**：涉及真实供应商 smoke / 付费验收 / 在线出片验证；APIMart 请求以 `task_failed`
> 收场且 `cost` 恒 0；怀疑「音频/参考图参数写错了」或「APIMart 侧不可达」时先查这条

**结论**：
1. 用户没有即梦（火山/Dreamina）账号，真实付费在线验收一律走 **APIMart**（已有真实出片证据：
   `grok-imagine-1.5-video-apimart` 6s MP4）；不要把即梦列为选项。
2. APIMart 本机直连不通，**只能走本地代理 127.0.0.1:7897**（`curl --noproxy '*'` 会超时）—— 看到
   `fetch failed` 先查代理，不是契约错。
3. **`task_failed` / `cost:0` 且 create/query 两端报文本身"看着都对"时，先怀疑喂给供应商的素材内容
   本身是不是退化占位符（纯色/近空白小图、静音片段），而不是先怀疑 audio_urls/image_urls 这条链路
   或某个新功能"接坏了"**。2026-09-11 用真实 APIMart 请求实测验证：同一条链路（同一份
   `buildArchetypeInputParams` 构造 → AssetIngestion 落地公网 URL → `doubao-seedance-2.0` omni
   `image_to_video`）——喂 `tests/ux/fixtures/test-upload.png`（100×100 单色占位图，`file` 一测
   即现）会稳定 `task_failed`；换成一张真实照片（`resources/onboarding-demo/kid.jpg`，720×720）
   后，**图生视频、以及图+音频参考（`audio_urls`+`generate_audio:true`）都真实出片成功**。结论：
   "音频一等参考"功能与 APIMart 侧契约都是通的，之前 5 次探针失败的根因是测试脚本自己用了一张
   退化占位图做参考图，不是产品代码或音频链路的缺陷。

**为什么会踩**：
- APIMart 自己的图片上传端点（`electron/catalog/assetIngestionRegistry.ts:28-34`，
  `POST https://api.apimart.ai/v1/uploads/images`）对这张占位图直接返回
  `400 {"code":"invalid_request_error","message":"invalid image content"}`；但该端点失败后，
  代码会正确回落到 KIE 的通用公网临时文件host（`kieai.redpandaai.co/api/file-*-upload`，
  见同文件 `CURATED_VIDEO_INGESTION.kie`，因为 apimart 自己没声明 video/audio 通道）拿到一个能
  正常 200 的公网 URL。所以最终喂给 `doubao-seedance-2.0` 生成接口的 `image_urls` **表面上是一个
  可正常访问的 https URL**，排查时容易停在"链路/可达性没问题"就转而怀疑参数契约——而真正被
  APIMart 自己判定过"invalid image content"的那个信号,在这一步被吞掉了,只在出站抓包里能看到。
- 官方文档核实（`docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation`，注意真实 slug
  是 `seedance-2-0` 不是 `doubao-seedance-2-0`，后者 404）：`duration` 4–15s、`audio_urls` 最多 3 条
  且总时长 ≤15s、必须搭配 `image_urls`/`video_urls` 一起用——这些我们的请求体全部满足，文档没有
  任何一条能解释这次失败,进一步印证问题不在字段契约。
- **副作用发现（未在本轮修，已登记为独立技术债）**：每次 `tasks.result` 轮询都会把
  `image_urls`/`audio_urls` 这两个引用素材重新上传一遍到 KIE 临时文件host（`electron/tasks/
  taskResultQuery.ts:172-179`，`executeProfileOperation` 在 `stage:"query"` 时仍然把
  `cached.request`（含原始 extras）整个喂给参数渲染引擎，而 `query` 操作本身只是
  `GET /v1/tasks/{id}`，根本不需要这两个字段）。一次 5 分钟排队的生成会因此产生 20+ 次多余的
  第三方文件上传，纯浪费带宽 / 占第三方 host 配额，不是本次失败的根因,但排障时会污染出站抓包
  （每条 poll 后面跟一对 upload，容易被误读成"重试逻辑在反复调用某个坏接口"）。

**怎么用**：
- 付费验收前先把出站报文抓下来（主进程唯一 fetch 入口 `electron/appFetch.ts` 临时包一层，按
  `NOMI_DIAG_CAPTURE_FILE` 之类的 env 开关落盘，Authorization 头打码）；这样即使请求被判定失败,
  字段名、model id、最终喂给供应商的 URL 是否可达都仍然可判。
- 写/改付费 smoke 脚本前，**先看它用的素材夹具是不是"真实内容"**：`file <path>` 看分辨率、
  `ffprobe` 看音频时长，一张几十字节的纯色小图不是合格的参考图输入，不能只因为"跑得起来、能拿到
  taskId"就当作代表性夹具。
- kie 账号余额是负的会全体 402（`GET api.kie.ai/api/v1/chat/credit` 直接查）；火山账号未开通两个
  型号分别报 429/404。
- 写付费 smoke 脚本的坑：`referenceImages` 别塞 `data:` URI（先导入成正经资产）；
  `fetchTaskResult` 入参键是 `taskId` 不是 `id`；`tasks.result` 跨 app 实例不可信，终态要直接打
  supplier 自己的查询端点。

**出处**：
- 2026-08-24/26 原始记录（APIMart-only 决策、kie 余额、本地代理限制）。
- 2026-09-11 复测：`scripts/audio-ref-diag-probe.mjs`（诊断专用，非产品测试套件成员）；
  出站抓包与结论细节见诊断分支 `diag/audio-paid-smoke-20260911`。
