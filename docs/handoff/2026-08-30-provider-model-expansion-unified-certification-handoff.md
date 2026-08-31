# Nomi 供应商、旗舰模型与统一认证流程交接

> 状态：核心代码与合并前验证已完成；最新 `origin/main` 的本地合并冲突已解决但尚未创建 merge commit，合并后验证仍待复跑；外部阻塞项仍按账本诚实保留
>
> 交接日期：2026-08-30
>
> 正确工作树：`/Users/aoqimin/Desktop/Nomi-provider-model-expansion-20260830`
>
> 当前分支：`codex/provider-model-expansion-20260830`
>
> 当前任务分支：`codex/provider-model-expansion-20260830`（最终提交以合并前推送为准）
>
> 远端基线：已在本轮复核 `origin/main`；PR：`https://github.com/aqm857886159/Nomi/pull/241`

本轮执行结果和接手步骤见：[2026-08-31-provider-model-expansion-execution-summary.md](./2026-08-31-provider-model-expansion-execution-summary.md)。

## 0.1 2026-08-31 续接结果

- 认证账本现为 66 条：7 条 `live-certified`、其余按证据保持 `simulated` 或精确 `blocked`；不把未跑 canary 的模型写成 live。
- 代表性最小 canary 已通过 Nomi `ProductionRun`/结果校验/managed asset journal/新进程读回：KIE Gemini Omni 1.1、KIE Seedance 2.0、fal Nano Banana 2、Runway Gen-4.5 文生/图生视频；账本中的 provider receipt 已脱敏，完整 ID 只留本地忽略证据。
- Runway 上传根因已修复：初始化请求固定 `X-Runway-Version`，签名 S3 multipart 字段先于文件；XML 错误只保留短 Code/Message，不泄露签名 URL。
- 零费用验证：J0/J3、MCP spend confirmation（provider quota=0）、packaged restart/readback、trusted-audio、fault matrix、Electron smoke、ARM64 packaged MCP smoke 均通过；全量单测 932 文件/8,903 项通过。
- `electron-builder` 的 x64 目标在本机因 Electron runtime 下载连接挂起而有界中止；ARM64 dir 打包和 packaged smoke 已通过。该网络阻塞不影响源码或 ARM64 产物。
- KIE Suno music/extend/cover 仍因生产 ACK Worker 部署批准为 `blocked`；MiniMax/ElevenLabs/Meshy/APIMart 的账户、权限或官方合同缺口按账本保留，不做盲重试。

## 0. 给接手 AI 的第一条指令

不要从头重做，也不要把当前工作树清干净。这里有大量尚未提交的有效实现，必须先读、再逐项复核、补齐和验证。

不要在 `/private/tmp/nomi-pr221-main-merge.3Ci24q` 继续开发。那个目录只用于读取旧交接：

`/private/tmp/nomi-pr221-main-merge.3Ci24q/docs/handoff/2026-08-30-local-model-agent-runtime-architecture-handoff.md`

开始工作前按下面顺序读：

1. `AGENTS.md`
2. `docs/ARCHITECTURE-NOW.md`
3. `docs/plan/2026-08-30-unified-model-integration-certification.md`
4. 本交接
5. `docs/research/2026-08-30-flagship-provider-model-decision.md`
6. `docs/research/2026-08-30-kie-apimart-model-generation-audit.md`
7. 旧 LocalAI/Agent Runtime 交接

当前工作树状态：

- 127 个变更路径，其中 92 个已跟踪文件被修改。
- 已跟踪 diff 约为 `2679 insertions, 272 deletions`。
- 还有新目录、新测试、新档案、新供应商文件和 Logo 未跟踪。
- 没有 commit、push、PR。
- 不得 reset、checkout 或删除任何现有改动。
- `docs/plan/2026-08-30-unified-model-integration-certification.md` 是当前执行计划。
- `docs/plan/2026-08-30-provider-model-expansion-and-runtime.md` 已被新计划取代，只保留历史背景。

当前长期目标 ID 是 `01a04e58-f764-7b50-a946-c907362239bc`。目标不是只写一份调研，而是把本交接中的全部确定性工作、验证、主线整合和 PR 交付推进到底。

## 1. 用户已经拍板的产品方向

### 1.1 不改现有页面主逻辑

继续使用 Nomi 已有的选择顺序：

```text
模型 -> 供应商渠道 -> 参数
```

不要另做“模型中心”、供应商优先首页或新的参数面板。用户明确说页面逻辑不需要改。

本次 UI 只做以下低扰动增强：

- 供应商选择项补供应商 Logo。
- 模型选择项补模型品牌/供应商身份 Logo。
- 其余比例、时长、参数控件保持现有设计，不要顺手重做。
- 不需要样张，不要增加解释性卡片或营销式 UI。

### 1.2 只接当前最强和有明确价值的模型

目标不是堆数量。按 2026-08-30 这个时点优先：

- 当前旗舰图片模型。
- 当前旗舰视频模型。
- 音乐、音效、配音、转写等音频能力。
- 可进入素材库、可预览和下载的 3D 模型。
- 能稳定承接多个旗舰模型的通用平台。

旧模型若仍承担旧项目兼容可以保留，但不能把“旧项目可打开”说成“旧模型仍值得推荐”。

### 1.3 所有接入必须走同一套低成本流程

本次新增或修改过的每一个 `供应商 x 模型 x 模式` 都必须重新走：

```text
官方文档/OpenAPI
-> 复用现有模型/传输合同
-> 静态校验
-> 本地协议仿真
-> 故障矩阵
-> PR #221 MCP 零费用旅程
-> 最小真实 canary
```

测试原则：

- 真实付费测试只做最终兜底，不能拿真实额度调试字段。
- 先用官方 schema、模板校验、loopback 服务和故障注入排完问题。
- 每种不同 wire shape 最多一次最小 canary。
- 没有真实凭据时完成全部零费用工作，但只能标 `documented` 或 `simulated`，不能标 `live-certified`。

### 1.4 最终把流程固化为 Skill

`skills/model-integration` 必须升级为未来模型接入的强制工作流，至少包含：

- 官方证据模板。
- 模型档案和 Catalog mapping 对账表。
- 静态 gate。
- loopback 协议仿真模板。
- 故障矩阵。
- PR #221 MCP dry run。
- canary 成本预算和单次提交门禁。
- `documented / simulated / live-certified / blocked` 状态规则。
- 禁止猜 endpoint、model id、字段、枚举、限制和结果路径。

## 2. 最终用户体验

完成后，用户仍在原来的生成节点里工作：

1. 在模型管理中连接 KIE、APIMart、MiniMax、ElevenLabs、Meshy、fal 或 LocalAI。
2. 在图片、视频、音频或 3D 节点里选择模型。
3. 在模型下选择可用供应商渠道。
4. 只看到该模型和该渠道真实支持的参数与参考槽。
5. 生成任务进入同一套排队、查询、恢复、资产物化和错误提示。
6. 音频可试听、下载、加入素材流程。
7. GLB 可在素材库筛选、旋转预览、下载，应用重启后仍存在。
8. LocalAI 只连接用户已经启动的本地服务，不把运行时或模型权重打进 Nomi 安装包。

LocalAI 的用户体验必须保持诚实：

- `已连接` 只表示 endpoint 可达。
- `发现模型` 只表示 `/v1/models` 或 capability probe 返回了模型。
- `已认证可生成` 必须有真实执行与产物证据。
- Phase 1 是 external connector，不做 managed sidecar，不自动下载几十 GB 模型。

## 3. 必须复用的内部合同

不要另建一套模型、任务、资产或认证系统。

| 关注点 | 单一 owner | 本任务如何使用 |
|---|---|---|
| 模型身份、模式、槽位、参数 | `src/config/modelArchetypes` | 模型事实、来源和供应商参数特化 |
| 供应商传输 | Catalog `Model`、`Mapping`、`HttpOperation` | create/query/result、鉴权、body、状态、结果路径 |
| 无头默认值 | `scripts/gen-archetype-wire-defaults.ts` | 从档案生成，禁止手改 generated 文件 |
| 动态文档接入 | `electron/providerAdapter` | 编译和静态校验对话式接入草案 |
| 真实付费认证 | `electron/integrationCertification` | spend receipt、单次提交、产物验证、晋级 |
| 执行生命周期 | GenerationRuntime、ProductionRun | submit/query/reconcile/cancel/materialize |
| 项目资产 | managed assets / AssetRecord | 音频、视频、图片和 GLB 落盘、恢复、下载 |
| 版本发现 | `scripts/model-radar.ts` | 发现新模型，不从名字猜 API |
| 对话式入口 | PR #221 MCP、`skills/model-integration` | 编排同一合同，不能绕过 Catalog/认证内核 |

认证账本只能保存上面合同的引用、digest 和验证证据，不能复制一份参数枚举或 request body。

## 4. 完成状态定义

接手者必须在文档、测试名和最终汇报中保持这四档：

- `documented`：官方证据与 Nomi 声明逐项一致。
- `simulated`：静态、loopback、故障、持久化和 MCP 零费用门全部通过。
- `live-certified`：真实凭据下的最小 canary 和新进程读回通过。
- `blocked`：存在精确的外部前置条件缺失。

没有 API Key 或账户额度，不等于可以跳过前六个零费用阶段。

## 5. 当前工作树已经实现的内容

下面的“已实现”只表示代码已存在于脏工作树，尚未完成统一复核、最终全量验证或远端交付。

### 5.1 新官方供应商

- MiniMax：`electron/catalog/minimaxOfficial.ts`
- ElevenLabs：`electron/catalog/elevenlabs.ts`
- Meshy：`electron/catalog/meshyOfficial.ts`
- 内置种子清单：`electron/catalog/builtinVendorSeeds.ts`
- UI 已有新供应商文案和 Logo 资产。

最近一次目录统计是 15 vendors、106 models、151 mappings。接手后必须在最终实现收敛时重新计算，不能把这个历史数字当最终事实。

### 5.2 MiniMax 官方接入

当前代码声明：

- `MiniMax-M3` 文本。
- `MiniMax-H3` 文生视频和多模态视频。
- `speech-2.8-hd`。
- `speech-2.8-turbo`。

H3 已有 content 数组 transform、首尾帧与多模态参考互斥、create/query/status mapping。

官方复核的新发现：

- 官方当前同时列出 H3 和 H3-Max。
- H3 是更完整的 2K 多模态模型。
- H3-Max 是 480P/768P、5-15 秒的极速版本。
- 不要把两者合成一个 model id，也不要根据名字猜参数。
- 需要把 H3/H3-Max 的当前官方 API 文档逐项落进认证清单。

### 5.3 ElevenLabs 官方接入

当前代码声明：

- Eleven v3 TTS。
- Eleven Music v2。
- Eleven Sound Effects v2。
- Scribe v2 转写。

已经发现两处必须修正的合同错误：

1. Music v2 的 `seed` 不能与 `prompt` 同时提交，当前 archetype/body 仍可能同时发送。
2. Sound Effects v2 最新官方时长上限是 22 秒，当前档案写成了 30 秒。

这些不是文档备注，必须改生产声明和类级测试。

### 5.4 Meshy 官方接入

当前代码有 Meshy 7 image-to-3D：

```text
POST /openapi/v1/image-to-3d
GET  /openapi/v1/image-to-3d/{taskId}
result = model_urls.glb
```

Meshy 官方页面本轮抓取有超时，现有字段还没有完成本轮统一证据复核。必须重新取得官方文档/OpenAPI，再决定是否保持当前声明。

### 5.5 APIMart 音频扩充

`electron/catalog/apimartAudios.ts` 当前包含：

- 原有通用声音模型：TTS + Whisper。
- Suno V5.5 音乐。
- Suno Sounds V5.5 音效。
- FlowMusic Lyria 3.5 音乐。

异步音乐路径为：

```text
POST create -> GET /v1/music/tasks/{task_id} -> audio URL -> managed audio asset
```

APIMart 部分官方页面本轮抓取超时。不要仅凭当前代码或旧研究宣布正确，必须重新抓官方资料并逐项复核。

### 5.6 KIE Gemini Omni 1.1

当前代码：`electron/catalog/kieGeminiOmni11.ts`。

现有 mapping 只覆盖：

- `image_urls`
- `first_frame_url`
- `last_frame_url`
- `duration`
- `aspect_ratio`
- `resolution`
- `seed`

官方复核发现它还支持但当前未覆盖：

- `audio_ids`
- `video_list`
- `character_ids`

接手者必须补真实能力或逐项标 blocker，不能用“参考生视频”这个名字暗示已经覆盖全部 Omni 输入。

同时保持身份区分：KIE 的 `Gemini Omni Flash 1.1` 与 APIMart 的 `Gemini Omni Flash Preview` 不是同一个版本，不能合并档案或复用未经证明的 model id。

### 5.7 KIE Suno Sounds

当前代码只接了 KIE Suno Sounds V5.5：

- `POST /api/v1/generate/sounds`
- `GET /api/v1/generate/record-info?taskId=...`
- Sounds 的 `callBackUrl` 在官方文档中不是必填，所以当前 mapping 不发送 callback。

普通 Suno 音乐、上传续写和上传翻唱尚未接入。解决方案见第 8 节。

### 5.8 异步音频和同步音频

已经实现：

- 有 query 的 audio mapping 进入通用异步 create/poll 链。
- 无 query 的 TTS/STT 继续走同步音频 runner。
- 二进制音频、JSON 编码音频、multipart 转写都能进入现有资产和结果合同。
- KIE/APIMart 音乐和音效可以按 async audio 生命周期表达。

相关文件：

- `electron/audioTaskRunner.ts`
- `electron/audio/synchronousAudioResponse.ts`
- `electron/runtime.asyncAudio.test.ts`
- `electron/tasks/taskResultQuery.ts`

### 5.9 通用 result 阶段

`Mapping.result` 已加入通用执行合同：

```text
create -> query -> result -> normalize/materialize
```

它用于 fal 一类 queue API：status endpoint 只告诉是否完成，真正产物要从 result endpoint 获取。

本轮历史验证记录：4 个 result 相关测试文件，共 46 tests 通过。接手者仍需在最终代码收敛后重跑，不要只引用旧结果。

### 5.10 3D 完整可用层

已经实现的 3D 用户闭环：

- `model3d` 进入 managed asset。
- 素材库能筛选 3D。
- GLB 旋转预览。
- 鼠标拖动旋转。
- 下载 GLB。
- 窄窗口布局不重叠。
- 应用重启后恢复 3D 资产。

相关 E2E：`tests/ux/model3d-asset-library.e2e.mjs`。

历史 Electron 走查结果：26 assertions 通过，截图位于 `.model3d-asset-library-walk/`。这不是最终分支验证，后续仍需重跑。

### 5.11 Logo 和选择体验

已有：

- `src/config/modelProviderIdentity.ts`
- `src/design/NomiIdentityIcon.tsx`
- `src/design/NomiSelect.tsx` 接入 identity 图标。
- MiniMax、ElevenLabs、Meshy Logo。
- 已有 KIE、APIMart、火山、ModelScope 等 Logo 继续复用。

不要扩大 UI 范围。用户只要求在原有供应商和模型选择位置补 Logo。

### 5.12 LocalAI external connector

已有：

- `electron/localRuntime/localAiExternalProbe.ts`
- `electron/localRuntime/localRuntimeDescriptor.ts`
- 正常、异常和 loopback tests。

当前定位正确：

- 只连接用户已经启动的 LocalAI。
- 不安装 LocalAI。
- 不托管进程。
- 不下载模型。
- 不把模型权重打包进 Nomi。
- 文本继续复用已有 OpenAI-compatible path。

尚未完成：将 discovery/capability evidence 与统一认证账本、MCP 旅程和最终用户入口完整对齐。

### 5.13 生命周期和认证基础改动

当前工作树修改了：

- `electron/capabilityCore/generationRuntimeAdapter.ts`
- `electron/capabilityCore/generationOutputMaterializer.ts`
- `electron/productionRun/productionGenerationSubmission.ts`
- `electron/integrationCertification/*`
- `electron/providerAdapter/*`
- `electron/vendor/*`

目标语义：

```text
submit -> query/reconcile -> materialize -> verify -> settle
                         -> cancel
```

已经新增或修改的 root-cause 合同：

- `docs/fixes/2026-08-30-flagship-provider-declaration-boundary.root-cause.json`
- `docs/fixes/2026-08-30-generation-executor-lifecycle.root-cause.json`
- `docs/fixes/2026-08-30-model-radar-delegated-index.root-cause.json`
- `docs/fixes/2026-08-30-synchronous-audio-certification-boundary.root-cause.json`

任何继续修改高风险执行/网络/认证文件的工作，都必须按 `root-cause-remediation` skill 更新 schema-v3 合同和类级测试。

## 6. fal 官方 OpenAPI 已取得的证据

临时证据目录：`/tmp/nomi-model-integration-docs/fal-01.json` 到 `fal-17.json`。

17 个端点全部抓取成功，HTTP 200：

1. Nano Banana 2 文生图
2. Nano Banana 2 编辑
3. GPT Image 2 文生图
4. GPT Image 2 编辑
5. Seedream 5 Pro 文生图
6. Seedream 5 Pro 编辑
7. H3 Max 文生视频
8. H3 Max 图生视频
9. Seedance 2.5 文生视频
10. Seedance 2.5 图生视频
11. Kling 3 Pro 文生视频
12. Kling 3 Pro 图生视频
13. Gemini Omni Flash 1.1 文生视频
14. Gemini Omni Flash 1.1 参考生视频
15. MiniMax Music 3
16. ElevenLabs SFX v2
17. Hi3D v3.0 图生 3D

统一生命周期：

```text
POST endpoint -> GET status -> GET result
```

结果路径：

- 图片：`images[*].url`
- 视频：`video.url`
- 音频：`audio.url`
- 3D：`model_mesh.url`

fal 尚未写入生产代码。下一步应新建 `electron/catalog/falOfficial.ts`，接入 10 个逻辑模型、17 条精确 mapping，并复用当前 `Mapping.result` 通用阶段。

不要把 17 个端点压成一个猜字段的通用 body。可以复用生命周期构造器，但每条 endpoint 的官方 input schema、required 字段和 output schema必须有精确声明和测试。

## 7. 官方复核证据位置

公开文档抓取没有调用供应商生成接口，不消耗供应商额度。

临时证据位于：`/tmp/nomi-model-integration-docs/`

关键文件：

- `kie-suno-music.txt`
- `kie-suno-get-details.txt`
- `kie-suno-upload-extend.txt`
- `kie-suno-upload-cover.txt`
- `kie-suno-sfx.txt`
- `kie-file-upload.txt`
- `kie-omni.txt`
- `eleven-music*.txt`
- `eleven-sfx*.txt`
- `minimax-h3*.txt`
- `minimax-speech*.txt`
- `fal-01.json` 到 `fal-17.json`

`/tmp` 不是仓库证据真相源。接手者应把最终采用的官方 URL、checked date 和 covers 落回 archetype source、认证账本或研究文档，不要提交整个临时抓取目录。

所有联网操作必须加载 `web-access` skill，并优先一手官方文档或 OpenAPI。

## 8. KIE Suno 普通音乐和文件上传的可行解

这是本轮最后核实出的关键结论，尚未写入生产代码。

### 8.1 问题不是文件上传

KIE 官方 File Upload API：

- 上传免费。
- 支持 URL、stream、base64。
- 文件临时保存 24 小时。
- 返回临时公网 `uploadUrl`。

仓库已经有 KIE file upload transport，能把本地音频变成 KIE 可访问的公网临时 URL。

但 `uploadUrl` 只解决“输入音频 KIE 能不能下载”，不能代替 `callBackUrl`。

### 8.2 哪些接口强制 callback

KIE 当前官方 OpenAPI 把以下接口的 `callBackUrl` 列为 required：

- 普通音乐生成。
- 上传并续写。
- 上传并翻唱。

Suno Sounds 的 callback 不是必填，所以 Sounds 已经可以直接轮询。

### 8.3 官方允许 callback 与轮询分离

官方文档同时明确：

- 提交 schema 虽然要求 `callBackUrl`。
- 结果可以不依赖 callback，改用 `GET /api/v1/generate/record-info?taskId=...` 主动查询。
- 官方建议约每 30 秒查询一次。
- callback 必须公网可达、HTTPS、15 秒内返回 HTTP 200。
- callback 连续失败 3 次后停止重试。

官方证据：

- `https://docs.kie.ai/suno-api/generate-music.md`
- `https://docs.kie.ai/suno-api/get-music-details.md`
- `https://docs.kie.ai/suno-api/generate-music-callbacks.md`
- `https://docs.kie.ai/suno-api/upload-and-extend-audio.md`
- `https://docs.kie.ai/suno-api/upload-and-extend-audio-callbacks.md`
- `https://docs.kie.ai/suno-api/upload-and-cover-audio.md`
- `https://docs.kie.ai/suno-api/upload-and-cover-audio-callbacks.md`
- `https://docs.kie.ai/common-api/webhook-verification.md`

### 8.4 推荐方案：无状态 ACK relay

在 Nomi 现有 `nomiaqm.com` Cloudflare Worker 部署中增加一个极小的 callback ACK route，例如：

```text
POST https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack
```

它只做：

- 只接受 POST。
- 不解析 callback JSON。
- 不记录正文。
- 不保存 taskId。
- 不下载或转发音频 URL。
- 不接触用户 KIE API Key。
- 不成为任务状态真相源。
- 立即返回 HTTP 200 和固定 JSON `{"status":"received"}`。
- 返回 `Cache-Control: no-store`。
- 其他 method 返回 405。

桌面端仍然：

```text
提交任务并拿 taskId
-> 本地任务账本持久化
-> 每约 30 秒查询 record-info
-> 成功后由现有 bounded materializer 下载音频
-> 写入 managed asset
```

这解决了 KIE 的必填 callback 和 `CALLBACK_EXCEPTION` 风险，又不建设保存用户音乐的 webhook 后端。

### 8.5 安全和隐私边界

KIE 支持每个账户自己的 `webhookHmacKey`，签名为：

```text
base64(HMAC-SHA256(taskId + "." + timestamp, webhookHmacKey))
```

不要把用户的 HMAC key 或 API Key上传到 Nomi 服务器。ACK relay 不消费、不信任 callback 数据，也不据此改变任何状态，所以不能假装它做了签名认证；它只是丢弃后返回 200。

仍需在隐私说明中诚实写明：callback 请求正文会经过 Cloudflare 网络边界，但应用代码不读取、不持久化、不转发。若未来要用 callback 驱动状态，必须另做每用户签名验证和 replay protection，不能复用这个无状态 ACK 逻辑直接升级。

公共 ACK endpoint 还应通过 Cloudflare/Wrangler 能力限制请求体、速率和日志，但不能因为做不到 IP allowlist 就把用户 secret 放到 URL 或客户端二进制里。

### 8.6 Cloudflare 实现边界

当前 `wrangler.toml` 只有 static assets：

```toml
name = "nomi"
compatibility_date = "2026-05-04"

[assets]
directory = "./marketing"
html_handling = "auto-trailing-slash"
not_found_handling = "404-page"
```

接手者必须先核对当前 Cloudflare Workers Static Assets 官方文档，再添加 Worker entry 和 ASSETS fallback，保证：

- `/api/vendor-callbacks/kie/suno/ack` 先走 Worker。
- 其他路径仍由现有 `marketing/` 静态站提供。
- 首页、`/en/`、handbook、下载链接、404 行为不变。
- 有纯函数/Worker request tests。
- 有本地 Wrangler smoke。
- 不直接部署到生产默认分支。

### 8.7 KIE Suno 还有一个共享合同缺口

普通音乐、上传续写、上传翻唱属于同一个 Suno V5.5 模型，但使用不同 endpoint。当前 Catalog mapping 只按：

```text
(vendorKey, taskKind, modelKey)
```

寻址。三个模式都硬塞 `text_to_audio` 会发生 mapping 冲突，拆成三个模型行又会破坏模型身份和 UI。

推荐在共享 Catalog 边界增加可选 `modeId` discriminator：

```text
(vendorKey, taskKind, modelKey, modeId?)
```

并让 renderer、headless/MCP、runtime、mapping 静态校验和 seed reconciliation 共用同一个选择函数。当前 request extras 已携带 `archetype.modeId`，不要另造平行字段。

需要覆盖：

- 普通 music mode -> `/api/v1/generate`
- upload extend mode -> KIE 官方 upload-extend endpoint
- upload cover mode -> KIE 官方 upload-cover endpoint
- 三者共用 `record-info`
- upload modes 从 `audio_ref` 槽取得单个音频，并经过现有 KIE upload-stream transport
- 旧 mapping 没有 `modeId` 时仍作为 generic mode mapping，但不能在多个精确 mode 中任意取第一条
- UI 的参数/参考可达性必须看当前 mode 对应的 create body
- MCP 也必须带当前 mode 选择同一 mapping

这是通用合同能力，不要在 runtime 里写 `if (vendor === "kie" && model === "suno")`。

因为它修改高风险 mapping 路由，必须走 root-cause-remediation、schema-v3 合同、红测试、类级测试和旧数据兼容检查。

## 9. 认证账本和静态 gate 尚未完成

当前计划要求一份机器可校验的精确 inventory，但生产实现尚未落地。

账本至少应逐项引用：

- vendor key
- model key
- archetype id
- mode id
- mapping id
- 官方 evidence URL + checked date
- static gate 结果
- loopback 结果
- failure matrix 结果
- MCP dry-run evidence
- live canary evidence或 blocker
- 当前状态

账本不能复制 request body 或参数枚举。

静态 gate 至少检查：

- 所有 in-scope mapping 都有账本条目。
- 账本引用的 archetype/mapping/test 文件真实存在。
- mapping 的模板根合法。
- create/query/result 路径和 result media mapping 完整。
- generated defaults 未漂移。
- secret 不进入证据。
- `live-certified` 必须有 production executor receipt、managed artifact 和 fresh-process readback。
- `blocked` 必须有精确 blocker，不允许只写“未测试”。

## 10. fal loopback 和故障矩阵

接入 fal 后必须用 loopback 驱动生产 executor，覆盖四类媒体：

- image
- video
- audio
- model3d

至少覆盖：

- create 成功返回 request id。
- status = queued。
- status = running。
- status = completed。
- result endpoint 返回各媒体路径。
- 401。
- 402/余额不足语义。
- 429。
- 5xx。
- timeout。
- malformed/truncated JSON。
- missing request id。
- success 但 result 缺产物。
- MIME 不匹配。
- magic bytes 不匹配。
- oversized media。
- restart 后凭 taskId/result endpoint 恢复。
- create 回执未知时绝不盲目重提付费任务。

## 11. PR #221 MCP 零费用旅程

用户特别要求验证“只通过对话接入模型”的 PR 实现是否真的可用，并在发现问题时修它。

必须用真实 MCP 边界完成：

```text
begin
-> discover
-> compile official contract draft
-> static validate
-> select exact model/mode
-> produce immutable spend summary
-> stop before spend
```

验收：

- provider request count = 0。
- 没有 API Key 也能完成 dry run。
- 草案进入现有 providerAdapter/Catalog 合同，不绕过源码或直接写 JSON。
- MCP 输出能关联认证账本。
- 同一个模式从 UI 和 MCP 选择到同一 mapping。
- 如果 PR #221 缺 mode discriminator、result stage 或 audio/3D kind，修共享边界并补回归测试。

## 12. 最小真实 canary 策略

真实 canary 是最后一步，不是调试手段。

每个 distinct wire/lifecycle/output shape 只跑一次，且必须：

- 使用最便宜的合法参数。
- 单次 attempt 上限 1。
- 先记录预计成本；官方没给就写 `unknown`，不能编数字。
- 通过 production executor 发起。
- 经过 bounded download 和媒体校验。
- 写入 managed asset。
- 写入 journal/receipt。
- 新进程读回成功。

用户尚未提供 fal、KIE、APIMart、MiniMax、ElevenLabs、Meshy 等 API Key。不要把缺 key 当作阻止零费用工作完成的理由。最终需要 key 时，集中列出每家需要的 key、预计一次最小 canary 的用途和成本上限，再向用户要一次。

## 13. 推荐执行顺序

### Phase A：先修已知合同错配

1. 修 Eleven Music v2 `prompt`/`seed` 互斥。
2. 修 Eleven SFX v2 22 秒上限。
3. 补 KIE Gemini Omni 1.1 的真实参考能力或 blockers。
4. 重抓 Meshy/APIMart 官方证据。
5. 重新核对 MiniMax H3/H3-Max。

### Phase B：完成认证框架

1. 建机器可校验账本。
2. 建静态 coverage gate。
3. 关联 archetype、mapping、tests 和 MCP evidence。
4. 为现有本分支所有新增/修改条目回填，不只覆盖 fal。

### Phase C：解决 KIE Suno

1. 先用 loopback 为 `modeId` mapping selection 写红测试。
2. 在共享 Catalog 边界实现 mode discriminator。
3. 扩 Suno archetype：普通音乐、上传续写、上传翻唱。
4. 复用 KIE stream upload。
5. 增加无状态 Cloudflare ACK Worker 和静态站 fallback tests。
6. 三条 KIE Suno mode 做零费用协议仿真。

### Phase D：接 fal

1. 新建 fal vendor seed 和 `falOfficial.ts`。
2. 接 10 个逻辑模型、17 条 mapping。
3. 复用 `Mapping.result`。
4. 做完整 loopback 和 failure matrix。

### Phase E：MCP 和 Skill

1. 用 PR #221 MCP 实际走到 spend confirmation。
2. 修共享入口问题。
3. 升级 `skills/model-integration`。
4. 增加 Skill eval，证明它拒绝猜字段、拒绝无证据晋级、默认零付费。

### Phase F：最终验证和交付

1. contracts。
2. root-cause contracts。
3. typecheck。
4. focused tests。
5. full system tests。
6. Electron 用户旅程和截图人眼检查。
7. build/package。
8. `git fetch origin`。
9. 非破坏性整合 `origin/main` 的 6 个新提交。
10. 再跑高风险最终验证。
11. 只提交本任务相关文件。
12. push 当前任务分支。
13. 创建 PR。
14. 汇报 branch、commit、PR URL、验证结果、live-certified 和 blocked 清单。

不得直接 push、merge 或 squash 默认分支。

## 14. 需要特别防止的错误

- 不要把 APIMart Preview 当 KIE 1.1。
- 不要从模型名字猜 endpoint/model id。
- 不要用一个 generic body 覆盖 17 个 fal endpoint 的差异。
- 不要为 KIE Suno 塞假 callback URL。
- 不要用第三方 webhook.site 一类公共收集器接用户结果。
- 不要把用户 KIE webhook HMAC key 上传到 relay。
- 不要把上传成功说成音乐任务接通。
- 不要把静态文档通过说成真实 provider 通过。
- 不要把 `documented + simulated` 写成 `live-certified`。
- 不要为了省事把上传续写/翻唱拆成重复模型行。
- 不要为 LocalAI 打包 runtime 或权重。
- 不要新建第二套任务表、资产库、模型档案或认证服务。
- 不要在付费任务回执不确定时自动重提。
- 不要手改 generated archetype wire defaults。
- 不要扩大 UI 范围。

## 15. 当前未完成清单

- [ ] Meshy 官方证据重新取得并逐项复核。
- [ ] APIMart 最新音频/视频页面重新取得并逐项复核。
- [ ] Eleven Music/SFX 已知错配修复。
- [ ] KIE Gemini Omni 1.1 参考能力补齐或 blockers。
- [ ] MiniMax H3/H3-Max 明确建模。
- [ ] 机器可校验认证账本。
- [ ] 静态 certification coverage gate。
- [ ] KIE Suno mode discriminator。
- [ ] KIE Suno 普通音乐。
- [ ] KIE Suno 上传续写。
- [ ] KIE Suno 上传翻唱。
- [ ] Cloudflare 无状态 ACK Worker。
- [ ] fal 供应商和 17 条 endpoint mapping。
- [ ] fal 四媒体 loopback。
- [ ] 全量 failure matrix。
- [ ] PR #221 MCP 零费用真实旅程。
- [ ] `skills/model-integration` 升级和 eval。
- [ ] 本分支所有新增/修改模式回走统一流程。
- [ ] API Key 集中申请和最小 canary。
- [ ] 最终 contracts/typecheck/focused/full/Electron/build/package。
- [ ] 整合最新 `origin/main`。
- [ ] commit、push、PR。

## 16. 接手后的首批命令

```bash
cd /Users/aoqimin/Desktop/Nomi-provider-model-expansion-20260830

git status --short --branch
git diff --stat
git log --oneline --decorate -8

sed -n '1,260p' AGENTS.md
sed -n '1,320p' docs/ARCHITECTURE-NOW.md
sed -n '1,360p' docs/plan/2026-08-30-unified-model-integration-certification.md
sed -n '1,420p' docs/handoff/2026-08-30-provider-model-expansion-unified-certification-handoff.md
```

然后先跑窄范围现状验证，不要一上来跑付费 API，也不要在 127 个脏路径上直接做破坏性主线变基。

## 17. 交付完成定义

本任务只有同时满足以下条件才完成：

1. 用户要求的旗舰供应商和模型有官方证据支持。
2. 图片、视频、音乐、音效、配音/转写和 3D 的核心闭环可用。
3. LocalAI external connector 不增加安装包模型体积。
4. 所有本分支新增/修改模式都有认证账本状态。
5. 零费用静态、loopback、failure matrix 和 MCP 旅程通过。
6. 有凭据的条目完成最小真实 canary；无凭据条目诚实标状态。
7. KIE Suno callback 问题以可维护、低隐私暴露的方案解决，不是假 URL。
8. 接入流程已固化为 Skill 并有 eval。
9. contracts、typecheck、full system、Electron、build/package 通过。
10. 最新 `origin/main` 已非破坏性整合并复验。
11. 任务分支已 commit、push，PR 已创建。
12. 未直接修改或推送默认分支，未替用户 merge PR。
