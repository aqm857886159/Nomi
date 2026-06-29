# AGNES AI 接入（全模态免费网关）

> 2026-06-30。把新加坡 Sapiens AI 的 **Agnes AI**（OpenAI 兼容网关，文本/图片/视频三模态**无限期免费**）接成 Nomi 的策展 vendor + 品牌卡。
> 走 **Path A（curated seed vendor）**，克隆 `apimart`（唯一一个文本+图+视频全模态 OpenAI 兼容样板）。

## 为什么做 / 用户摩擦（D1/D2）

- **摩擦**：Nomi 三条腿（文本大脑 / 生图 / 生视频）都要钱或要配置。新用户想白嫖跑通全流程没有一个"一个 key 全解锁且免费"的起点。
- **AGNES 正好填这个洞**：邮箱注册不绑卡、一个 key 解锁三模态、免费层 RPM 20（个人/原型够用）。定位等同 modelscope 的"免费文本大脑"，但 AGNES 把**图+视频也免费**了 → 成为 onboarding 最省事的免费起点。
- **结构（D2）**：纯传输接入，不碰护城河；复用既有 curated vendor 机制，零新 UI（`VendorOnboardCard` 通用），边际成本=加几个声明文件。

## API 事实（官方文档 + GitHub 目录核实，R5/R6）

来源：`agnes-ai.com/doc` · `wiki.agnes-ai.com/en/docs/*.md` · `github.com/AgnesAI-Labs/Agnes-AI`

- **base_url**：`https://apihub.agnes-ai.com/v1`（vendor.baseUrl 存**裸** `https://apihub.agnes-ai.com`，op.path 带 `/v1`，避 joinUrl 双前缀）
- **auth**：`Authorization: Bearer <KEY>`

| 模态 | model id | 端点 | 形状 | 取结果 |
|---|---|---|---|---|
| 文本 | `agnes-2.0-flash` | `/v1/chat/completions` | 标准 OpenAI 同步，工具调用+视觉+流式，512K 上下文 | AI SDK 直连（无 mapping）|
| 图片 | `agnes-image-2.0-flash` / `agnes-image-2.1-flash` | `/v1/images/generations` | **同步** `{created,data:[{url,b64_json}]}` | `data.0.url` |
| 视频 | `agnes-video-v2.0` | 提交 `POST /v1/videos` | **异步**，提交回 `{video_id,task_id,status:"queued"}` | 见下 |

**视频两个必处理的坑**：
1. 轮询端点 `GET https://apihub.agnes-ai.com/agnesapi?video_id=<ID>`——**不在 `/v1` 下**，且 video_id 走 **query 参数**（不是路径参数）。
2. 成品 mp4 URL 藏在 `remixed_from_video_id` 字段（不是 `video_url`，官方文档自己都写错）。**此字段不在 runtime 防御式 extractAssetUrl 的 11 条兜底路径里 → 必须靠显式 `response_mapping.video_url` 取**（mock 测试盯死点）。
- status 动词：`queued` / `in_progress` / `completed` / `failed`
- 图生视频：单图顶层 `image`(string)，多图/关键帧 `extra_body.image`(array) + `extra_body.mode:"keyframes"`
- 视频 wire：`width/height/num_frames/frame_rate`（`num_frames` 满足 8n+1 且 ≤441；`duration=num_frames/frame_rate`）

**图片坑**：图生图参考图放 `extra_body.image`(array)，`response_format` 也必须在 `extra_body` 内（不能顶层）。

## 范围（要动的文件）

**新增（`electron/catalog/`，克隆 apimart 三件套）**
- `agnesVendor.ts` — vendor 种子（裸 baseUrl + bearer + `providerKind:"openai-compatible"`）+ 视频轮询 op（query 参数版）+ status 归一表
- `agnesImages.ts` — 图片同步 create op（t2i + edit）+ 模型列表（2.0/2.1）
- `agnesVideos.ts` — 视频异步 create op（t2v + i2v）+ 模型列表
- `agnesTexts.ts` — 文本大脑 `agnes-2.0-flash`（kind=text，无 mapping）

**新增（`src/config/modelArchetypes/`，AGNES 是全新模型族，必须新建档案）**
- `agnesImage.ts` — `agnes-image` 档案：t2i（size 控件）+ edit（image_ref 槽 inputKey=image，写进 extra_body）
- `agnesVideo.ts` — `agnes-video` 档案：t2v + i2v；用户侧控件=比例+清晰度(480p/720p/1080p)+时长(秒)；paramMap 派生 width/height/num_frames，frame_rate 字面量 24

**新增 transform（`electron/catalog/paramTranslate.ts`）**
- `agnesVideoWidth` / `agnesVideoHeight`（比例×清晰度档位→像素，8 倍数对齐）
- `agnesVideoNumFrames`（时长→round(duration×24) 贴到最近 8n+1，clamp ≤441）

**改（装配/目录）**
- `electron/catalog/seedBuiltins.ts` — import + `AGNES_CURATED_MODELS/MAPPINGS` 派生 + `seedVendor`/`reconcileModels`/`reconcileMappings` 各一行；`seedVendor` 的入参 union 加 `typeof AGNES_VENDOR_SEED`
- `src/config/modelArchetypes/index.ts` — 注册两个新档案
- `src/config/knownVendors.ts` — 加一条 `vendorKey:"agnes"` 目录（glyph 兜底，promo 指官网注册）
- `electron/catalog/modelKindHeuristic.ts` — 补 `agnes-image`/`agnes-video` 关键词（仅 Path-B 手动添加兜底；curated 已显式 kind，非必须但补全）

## 不动项

- runtime 状态机 / requestPipeline / async 轮询循环：零改动（声明驱动，新 vendor 只加声明）
- 既有 vendor（apimart/kie/...）：不碰
- 全局 CSS / 通用接入卡 UI：不碰（P4 通用卡按目录数据渲染）
- 本地素材吞入：AGNES 收公网 URL，参考图走既有 anon-chain/upload 兜底（vendor 不声明 assetIngestion → 走通用回退，与 apimart 同）

## 设计取舍（自主决定，记此备查）

- **视频参数暴露比例+清晰度+时长而非 raw width/height/num_frames**（D1：不让用户按"帧"思考）；wire 字段经 paramMap 派生。代价=加 3 个 transform；收益=UX 和站内其它视频模型一致。
- **图片 2.0 + 2.1 都种，共用一个 `agnes-image` 档案**（同 API 形状，仅 model id 不同）。
- **文本 `agnes-2.0-flash` 种成免费大脑**：和 modelscope 免费 Qwen 并列，给没付费用户多一个 tool_use 可用的免费 agent 大脑。

## 回滚

纯增量：删 4 个 catalog 文件 + 2 个档案 + 3 个 transform，回退 seedBuiltins/index/knownVendors/modelKindHeuristic 的增量行即可。老装机的 catalog.json 里已种的 agnes 记录由 reconcile 幂等管理，删代码后成孤儿但不影响其它 vendor（可加 prune 表，非必须）。

## 验收门

1. **五门全过**（filesize→tokens→lint→typecheck→test→build）
2. **mock E2E**（仿 `tests/transport-spike/` + 既有 mock onboarding E2E）：
   - 文本：`agnes-2.0-flash` chat + tool_use 双通
   - 图片：t2i 取到 `data.0.url`；edit 参考图进 `extra_body.image`
   - 视频：提交 → 轮询 query 带 `video_id` → status `completed` 时从 **`remixed_from_video_id`** 取到 mp4 URL（盯死反常字段）
3. **接入即验证（live，需用户 AGNES key）**：真跑文本/图/视频各一次，确认：
   - 视频 wire 数字字段（width/height/num_frames 经 transform 出字符串）AGNES 是否接受——不接受则加数字强转
   - 图片 extra_body 嵌套 body 是否被 vendor 正确解析
4. **R13 真机走查**：模型设置出现 AGNES 卡 → 填 key → 已接入；画布选 AGNES 图/视频模型跑通

> live(3)/R13(4) 需要用户去 `platform.agnes-ai.com` 注册拿免费 key（用户独有资源）。其余（1/2 + 全部编码）先自主做完。
