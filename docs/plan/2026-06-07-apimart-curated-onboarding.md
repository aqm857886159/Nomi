# apimart 策展接入 + 战略转向「通用接入 → 策展两家」（R4 计划稿）

> 2026-06-07。本文是多文件改动的执行前文档（R4）。决策表见 §6，请用户拍板后再细化落地。
> 撤销声明：`docs/plan/2026-06-06-universal-model-onboarding.md` 描述的「描述符 + 通用解释器接长尾」方案**本轮撤销**（理由见 §1）。该文档保留为研究材料，不再演化为产品；`tests/transport-spike/*` 同样归档。

## 0. 一句话

用户给一个 key，我们把 apimart（和已有的 kie）这两家中转站**预置好的全部图片/视频模型**一键接入。文本模型已处理完，不在本轮范围。Agent Harness 是独立轨道（见 `docs/plan/2026-06-07-agent-harness-hardening-plan.md`），不被本轮阻塞。

## 进度（2026-06-07 实时）

- ✅ **A 轨后端完成**：12 个高频模型（6 图 + 6 视频）全部接入并**用真 key 端到端真测出真媒体**（图 png/jpeg、视频 mp4），结果路径全部命中。两个里程碑已 commit+push（`feat(catalog): apimart 策展接入 P0 …`）。
- ✅ **B 档案分层**已实现（`vendorParams` + `specializeArchetypeForVendor` + vendorKey 线程化）。共享档案：Seedream/Nano-banana/GPT/Kling 用 vendorParams；结构差异的 Seedance 用独立 apimart 档案（B/A 合理混用）。
- ✅ **assetIngestion**：apimart = `inline-base64`（编辑/i2v 带本地图可用）。
- ✅ **推广链接格式确认**：`https://apimart.ai/register?aff=CODE`（R6 对标 Infinite-Canvas 实证）。用户取自己的 `aff` 码即可嵌入。
- ⏳ **待办**：B 轨前端「一个 key 全通」样张（R8 先行）+ 推广位；视频 i2v 本地素材；Qwen 改图本地图（仅公网 URL）/ VEO 资产上传两类边界增强。

## 1. 战略转向（R3 决策表 · 为什么撤销「通用接入」）

| 维度 | 原「通用接入」（撤销） | 新「策展两家」（采纳） |
|---|---|---|
| 用户体验 | 给一个中转 key + 自己懂参数才能接长尾 | 一个 key → 预置全部模型立即可用 |
| 工程负担 | 描述符 + 解释器 + 长尾测试矩阵无止境 | kie 模板复用 → apimart 一组配方 |
| 验证 | 长尾模型 100% 验证不可行（违反 P3） | 每家挑高频模型真测 |
| 风险 | 模糊承诺、易失败 | 边界清晰：列表内能用，列表外明说「暂未支持」 |
| 商业 | 无变现通道 | 两家都可走推广链接 |
| Agent Harness | 仍需做 | **仍需做（不变，独立轨道）** |

「文档 + key 逐个手配」对用户不可行；「对未知模型的通用接入」工程上不可行。两条都堵死 → 转向**策展**。

## 2. R5 文档精读：apimart 真实契约（已核验，推翻两个原假设）

抓取自 `docs.apimart.ai`（llms.txt + 各模型 generation.md + tasks/status.md）。

**⚠️ 原假设被推翻的两点（这就是 R5「不凭二手摘要手搓」的价值）：**
1. ~~「图片是 OpenAI 兼容 `/v1/images/generations` **同步**族」~~ → **错**。图片也是**异步任务**：`POST /v1/images/generations` 同样返回 `{code, data:[{task_id, status:"submitted"}]}`，要轮询。
2. ~~「轮询 `/v1/tasks/status`」~~ → **错**。轮询是 `GET /v1/tasks/{task_id}`，task_id 是**路径参数**，不是 query。

**供应商（裸 baseUrl + bearer，与 kie 同约定）**
- `baseUrl = https://api.apimart.ai`（裸），`Authorization: Bearer <token>`。

**创建（图片 / 视频统一形状）**
- 图片：`POST /v1/images/generations`，body `{ model, prompt, size?, resolution?, n?, image_urls?, watermark? }`
- 视频：`POST /v1/videos/generations`，body `{ model, prompt, duration?, resolution?, aspect_ratio?, image_urls? }`
- 响应：`{ "code": 200, "data": [ { "status": "submitted", "task_id": "task_xxx" } ] }`
  - **task_id 在 `data[0].task_id`（数组下标 0）** —— 与 kie 的 `data.taskId`（单层）不同。

**轮询（图片 / 视频统一）**
- `GET /v1/tasks/{task_id}`（路径参数）+ 可选 `?language=zh`
- 响应：`{ code, data: { status, progress, result: {...}, error?: {message,code,type} } }`
- status 值：`pending` / `processing` / `completed` / `failed` / `cancelled`（与 kie 的 success/fail/generating 不同 → 需 statusMapping）
- 图片结果 URL：`data.result.images[0].url[0]`（注意 `url` 本身是**数组**）
- 视频结果 URL：`data.result.videos[0]...`（文档未给 video item 精确字段 → **接入时用真 key 探一次定型**）
- 失败信息：`data.error.message`

**✅ 已用真 key 端到端核验（2026-06-07，`tests/transport-spike/apimart.mjs`，Seedream 4.5 文生图）**：
- create HTTP 200 `{code:200,data:[{status:"submitted",task_id:"task_01KTGKH..."}]}` —— task_id 确在 `data[0].task_id`。
- 轮询 `GET /v1/tasks/{task_id}?language=zh`，status `pending`→`completed`，~10s 出图。
- 结果 `data.result.images[0].url[0]` 命中，拉回 HTTP 200 `image/jpeg` 真图。
- **环境坑**：Node `fetch`(undici) 默认不读 `HTTP_PROXY` → 探测需 `NODE_USE_ENV_PROXY=1`；apimart 需代理可达（生产 Electron 已有代理支持，不影响）。
- ⏳ 视频 item 字段仍待 `node tests/transport-spike/apimart.mjs video` 探一次定型。

**结论：传输层零改动即可支持 apimart（已核验 `electron/ai/requestPipeline.ts`）**
- `operation.path` **会做模板渲染**（[requestPipeline.ts:239](../../electron/ai/requestPipeline.ts)）→ 轮询写 `path: "/v1/tasks/{{providerMeta.task_id}}"` 即可，无需改传输。
- create 响应抽 task_id：`extractTaskId` 接受显式 dot-path（[requestPipeline.ts:286](../../electron/ai/requestPipeline.ts)），`followPath` 支持 `.0` 数组下标 → create op 写 `response_mapping: { task_id: "data.0.task_id" }`。
- `looksLikeLogicalError` 只在 `code>=400` 触发，apimart 成功是 `code:200`，不误判。

## 3. 复用现状（已读代码，给出 file:line）

kie 的策展基建是教科书级模板，apimart 照搬：
- 每模型一份文件：vendor seed + model seed + create/query `HttpOperation` + `response_mapping`。范例 [electron/catalog/kieSeedream.ts](../../electron/catalog/kieSeedream.ts)、[kieSeedance.ts](../../electron/catalog/kieSeedance.ts)。
- 注册：[electron/catalog/seedBuiltins.ts](../../electron/catalog/seedBuiltins.ts) 的 `CURATED_MODELS` + `CURATED_MAPPINGS` 两张表（幂等 insert + 漂移自愈）。
- 选路：[electron/catalog/types.ts](../../electron/catalog/types.ts) `selectTaskMapping`（按 vendor+taskKind+modelKey 优先级选 mapping）。

**P4 红利 —— 档案供应商无关**：[src/config/modelArchetypes/index.ts](../../src/config/modelArchetypes/index.ts) `resolveArchetypeForModel` 按模型身份（modelKey/alias）或显式 `meta.archetypeId` 解析档案。apimart 的 Seedream/Kling/Nano-banana/GPT-Image-2 **可直接复用 kie 已建档案**（标 `meta.archetypeId`）；Sora/Veo/Wan/Hailuo/Vidu/Grok/Imagen/Flux/Qwen/Z-Image 等新模型需建新档案。

## 4. ⚠️ 必须先定的架构岔路：档案参数与供应商字段耦合

**问题**：档案（archetype）的参数控件**写死了 kie 的字段名+取值枚举**。例：[seedream.ts:11-14](../../src/config/modelArchetypes/seedream.ts) 文生图参数是 `aspect_ratio`(1:1…) + `quality`(basic/high)。但 apimart seedream-4.5 的字段是 `size`(1:1…) + `resolution`(**2K/4K**，无 1K) + `n`。aspect_ratio 值能对上 size，但 `quality`(basic/high) 与 `resolution`(2K/4K) **字段名和取值都不同**，模板引擎只做字符串透传、不做值翻译 → 同一档案不能同时正确驱动两家。

这与 P4「档案声明槽、通用系统负责填、供应商无关」冲突在：档案目前把**供应商专有的字段枚举**也写进了"槽"。三个候选解（决策表 §6 D-1）：

- **A. 每家独立档案**（apimartSeedream / apimartSora…）。最直白、零耦合，但同一个模型身份在 UI 上若两家都接会出现两份档案——除非用「家族 family 合并显示」收口。违反「一个身份」的直觉。
- **B. 档案分层：身份+能力形状（modes/slots）供应商无关；params 允许 per-vendor 覆盖**。最贴合 P4，但要扩档案数据结构（archetype 增加 `vendorParams?` 维度）+ 改渲染层读取。工程量中等，一次到位。
- **C. 在 mapping 加值翻译表**（quality:basic→resolution:2K）。传输层局部改动，但把"语义翻译"散进每条配方，易漂、难维护，违反 R1 单源精神。

**推荐 B**（最符合 P4 与"一个身份"叙事），但它是架构改动，按 R7 应过六角色评审。**这是本轮唯一需要用户先拍的架构决策**——它决定后面所有 mapping 文件和前端形态怎么写。

## 5. 落地三轨（A 后端 / B 前端 / C Harness）

### A — apimart 策展接入（后端，本文件重点）
按 §6 决策定档案策略后，按 kie 模板逐模型写 mapping + 注册。新增供应商 seed `electron/catalog/apimartVendor.ts`。**先做一条薄垂直片真测打通**（沿用 kieSeedance.ts 注释里的「C1 薄垂直片」纪律），再扇出。
- 图片高频先做：seedream-4.5（+4.0/5-lite）、gemini-2.5-flash-image(nano-banana)、gpt-image-2、qwen-image、imagen-4。
- 视频高频先做（含真验）：sora-2、veo3.1、kling-v3(+omni)、seedance-2.0、wan2.7、hailuo-2.3、vidu-q3。
- 真验：用用户给的 key **每家挑代表模型各一次最小调用**（一张图 / 一条最短视频）。视频 item 字段借此定型（§2 留的口子）。
- **绝不把 key 写进任何仓库文件**（用环境变量传给一次性探测脚本）；测试后用户换一次 key。

### B — 前端「一个 key 全通」（设计稿先行 R8，本轮不实现）
现状不是「vendor 卡片网格」：接入入口是 [src/ui/onboarding/OnboardingWizard.tsx](../../src/ui/onboarding/OnboardingWizard.tsx) 的 modal「添加一个 AI 模型」，含「文本模型（手填预设）/ 图片视频（读文档）」两支 + 预设 chip。「一个 key 全通」要落进这里：
- apimart 作为**具名预设**：选它 → 填一个 key → 该家预置图片/视频模型**全部自动出现**在生成画布模型选项（无需逐个读文档）。kie 同理收口为预设。
- 推广位：预设区/成功页一行「通过我们的链接注册，享前 3 次充值 10% 返现」+ CTA。不弹窗、不强制、可见即可。
- 重复模型（两家都有 Kling/Seedream）：UI 只显示**一个身份**，按已配的 key 路由；两家都配时按默认（D-2）。
- **按 R8：先出 HTML 样张 → 用户拍板 → 才实现。本轮只出样张，不写前端代码。**

### C — Agent Harness 演进（独立轨道，不阻塞 A/B）
归口 `docs/plan/2026-06-07-agent-harness-hardening-plan.md`，本文件不展开。

## 6. 决策表（R3，请用户拍）

| # | 决策 | 选项 | 推荐 | 影响 |
|---|---|---|---|---|
| D-1 | 档案 vs 供应商字段耦合（§4） | A 每家独立档案 / B 档案分层+per-vendor params / C mapping 值翻译 | **B ✅ 用户已拍（2026-06-07）** | 决定全部 mapping + 前端形态，须先定 |
| D-2 | 重复模型默认路由（两家都配 key） | 价格低者 / 用户偏好设置 / 最近接入者 | **用户偏好设置 ✅ 用户已拍**（缺省价格低者） | 前端路由 + 一个设置项 |
| D-3 | 本轮扇出范围起点 | 一条薄垂直片真测 → 扇出 / 先铺全部图片 / 图视频各铺全 | **薄垂直片先**（C1 纪律） | 节奏，已倾向自治 |
| D-4 | 推广链接（**仅用户能做**） | 去 apimart 控制台拿邀请链接/优惠码 给我嵌 | 用户提供 | 前端推广位文案落实 |

## 7. 推广话术草稿（D-4 用户拿到链接后嵌入）

- 预设卡片副标题：「APIMart · 一个 key 接入 Sora 2 / Veo / Kling / Seedance 等全部模型」
- 推广行：「还没有 APIMart 账号？通过下方链接注册，**新用户前 3 次充值返现 10%**，价格低至官方 30%–70%。」
- CTA 按钮：「用优惠链接注册 →」（链接由用户提供；无链接则隐藏整行，不留死链）。
- 「为什么走我们的链接」（点开说明）：「你省钱（返现 + 折扣），我们也获得一点支持来持续维护 Nomi —— 双赢，且你用的是同一个 APIMart 官方服务，无任何区别。」

## 8. 不做 / 非目标

- 不做文本模型（已完成）。
- 不做长尾/未列出模型的「通用接入」（本轮撤销）。列表外明说「暂未支持」。
- 不在本轮写前端代码（R8 样张未拍板）。
- 不碰 Agent Harness（独立轨道）。

## 9. 风险 / 回滚

- 视频结果字段未文档化 → 真验定型前不声明该模型「已验证」（P3）。
- apimart 错误信封 `{error:{message}}` 与成功 `{code:200}` 不同 → 轮询解析需同时读 `data.error.message`，并核对失败态归一。
- 回滚：apimart 全部走新增文件 + seedBuiltins 表加行，幂等且按 key 跳过；删除新增文件 + 表行即回到 kie-only，零迁移。

## 附录 A — 首期 12 模型精确契约（R5 已抓，写 mapping 的单源）

所有创建端点：图 `POST /v1/images/generations`、视频 `POST /v1/videos/generations`；轮询 `GET /v1/tasks/{task_id}`；响应 task_id 在 `data[0].task_id`，结果图 `data.result.images[0].url[0]`、视频 `data.result.videos[0].*`（待 video 探测定字段）；status `pending/processing/completed/failed/cancelled`。

### 图片（6）
| 模型 | model enum | size(比例) | resolution | n | image_urls(改图) | 特有字段 |
|---|---|---|---|---|---|---|
| Seedream 4.5 ✅ | `doubao-seedream-4.5` | 1:1/4:3/3:4/16:9/9:16/3:2/2:3/21:9/9:21/auto | 2K/4K | 1-15 | ✅ | watermark, sequential_image_generation |
| Gemini 2.5 Flash(Nano Banana) | `gemini-2.5-flash-image-preview` | auto/1:1/2:3/3:2/3:4/4:3/4:5/5:4/9:16/16:9/21:9 | 1K only | 1-4 | ✅(≤14) | mask_url, official_fallback |
| GPT-Image-2 | `gpt-image-2` | 多比例+像素 | 1k/2k/4k | 1 only | ✅(≤16) | official_fallback；忽略 quality/style |
| Qwen-Image 2.0 | `qwen-image-2.0`(+`-pro`) | 1:1/4:3/3:4/16:9/9:16/3:2/2:3 | 1K/2K | 1-6 | ✅(仅公网URL) | negative_prompt |
| Imagen 4 | `imagen-4.0-apimart` | 1:1/4:3/3:4/16:9/9:16 | 无 | 1 only | ❌ t2i-only | 非法比例静默回退16:9 |
| Z-Image-Turbo | `z-image-turbo` | 1:1/4:3/3:4/16:9/9:16/3:2/2:3 | 1K/2K | ❌不支持 | ❌ t2i-only | prompt_extend |

### 视频（6）
| 模型 | model enum | 比例字段 | 清晰度字段 | duration | i2v 字段 | 音频 |
|---|---|---|---|---|---|---|
| Sora 2 ✅ | `sora-2`/`sora-2-pro` | `aspect_ratio` 16:9/9:16 | `resolution` 720p(pro+1024p/1080p) | 4/8/12/16/20(def4) | `image_urls`(≤1) | — |
| Veo3.1 | `veo3.1-fast`/`-quality`/`-lite` | `aspect_ratio` 16:9/9:16 | `resolution` 720p/1080p/4k | 8 only | `image_urls`(≤3)+generation_type(frame/reference) | — |
| Kling v3 | `kling-v3` | `aspect_ratio` 16:9/9:16/1:1 | **`mode`** std/pro/4k | 3-15(def5) | `image_urls`(≤2) | `audio`(bool) + negative_prompt |
| Seedance 2.0 | `doubao-seedance-2.0`(+fast/face) | **`size`** 16:9/9:16/1:1/4:3/3:4/21:9/adaptive | `resolution` 480p/720p/1080p | 4-15(def5) | `image_urls`(≤9) 或 image_with_roles | **`generate_audio`** |
| Wan 2.7 | `wan2.7` | **`size`** 16:9/9:16/1:1/4:3/3:4(仅t2v) | `resolution` 720P/1080P | 2-15(def5) | `image_urls`(1-2) | audio_url + negative_prompt, prompt_extend |
| Hailuo 2.3 | `MiniMax-Hailuo-2.3`(+`-Fast`) | **无** | `resolution` 768p/1080p | 6/10(def6) | **`first_frame_image`(字符串!)** | prompt_optimizer |

字段名分歧（aspect_ratio/size/无；resolution/mode；image_urls/first_frame_image；audio/generate_audio）→ 每条 mapping 的 body 各自翻译，archetype 的 per-vendor params 处理枚举差异（这就是 B）。

## 10. 验收门（R11 五门 + P3）

- `check:filesize` / `lint:ci` / `typecheck` / `test` / `build` 全过。
- 每家代表模型一次真生成出图/出视频（人眼判断，P3/R13），不是只看 expect。
- 与前端样张逐项对账（R8）后才报 B 轨完成。
