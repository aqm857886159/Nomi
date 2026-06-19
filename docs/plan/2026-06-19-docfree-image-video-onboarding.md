# 接入自建/第三方中转的图片·视频模型（Issue #8）

> 状态：**已实现并验证（2026-06-19）**。S1b mock + S1c 后端 + S1d UI + S1e mock E2E(7/7) + S2 删读文档，全部完成并 push main（commit bfc4e3b/f1b3cb2/9d42875）。
> 真实最后一公里（reporter 用真 new-api 跑探测 tests/transport-spike/newapi.mjs 确认字段）待 reporter 回执；防御式 extractAssetUrl 兜底。
> 坑：S2 删除期间并行会话经共享 index 把本人 staged 的 doc-reader 删除带走推 main、未带对应代码改动致 main 编译坏；已在 9d42875 补齐修复。
> 关联：[#8 中转站添加绘图和视频模型没有文档不能接入](https://github.com/aqm857886159/Nomi/issues/8)。

## 1. 问题 & 根因

issue：「一些中转站没有接口文档，或者用 **newapi** 没有自己的接口文档地址，不能接入绘画和视频模型。」

**现状**：「添加模型」里图片/视频**只有「AI 读文档」一条路**（[OnboardingWizard.tsx](../../src/ui/onboarding/OnboardingWizard.tsx) `inputMode==='docs'`）。无文档的中转无从粘贴 → 卡死。

**真实调研结论（R5/R6，2026-06-19）**：
- 参数分歧分两层：**传输层按"中转软件"**（apimart 走 `/v1/tasks` 轮询、modelscope 要 `X-ModelScope-Async-Mode` header、new-api 走 `/v1/video/generations/{id}`），**参数层按"模型"**（同一 new-api 端点 kling 用 `metadata.image_tail`、jimeng 用 `metadata.req_key`）。
- 没有"一个通用格式"能通吃 → "AI 读文档抹平差异"不可靠（差异在 per-model metadata，AI 抠不准）→ **读文档该删**。
- **[new-api](https://github.com/QuantumNous/new-api)（⭐39k）/ [one-api](https://github.com/songquanpeng/one-api)（⭐35k）是开源中转软件**：很多"中转站"底层就是它。它的接口被软件固定死，**一个适配器 = 所有自建该软件的中转**（不像 apimart 一家一接）。issue reporter 明确用 new-api。
- 注意：**new-api 自建 → baseUrl 各不相同**，不能像 apimart 做"固定 baseUrl 的种子"，而是**用户填自己 baseUrl 的传输模板**。

**Nomi 架构契合**：vendor=传输适配器、archetype=模型能力。new-api 就是又一个 vendor 传输（同 apimart/kie/modelscope），模型复用 archetype。零并行版（P1）。

**new-api 传输（已扒全，R5）**：
- 图片：`POST /v1/images/generations`（**同步**，OpenAI 形状）→ `data[].url|b64_json`。
- 视频：`POST /v1/video/generations`（**异步**）→ `{task_id, status:processing}`；轮询 `GET /v1/video/generations/{task_id}` → `status: succeeded|failed` + 结果 url。
- 来源：[图片](https://doc.newapi.pro/api/openai-image/) · [视频创建](https://doc.newapi.pro/api/generate-video/) · [视频轮询](https://www.newapi.ai/en/api/query-video/)

## 1b. 读代码关键发现（2026-06-19，避免造并行版 P1）

- **图片基本已通**：runtime fallback 路径（[runtime.ts:612-652](../../electron/runtime.ts)）对无 curated mapping 的模型，已 POST `/v1/images/generations`（标准 OpenAI body）并支持**同步**（`extractAssetUrl` 认 `data[0].url` / `data[0].b64_json`，[runtime.ts:376](../../electron/runtime.ts)）+ **异步**（无 url 则 admit 轮询）。→ **图片不需要写新传输适配器**（写了就是并行版）；缺口仅在 **onboarding UI 不让用户加 image 模型**（手填路径写死 `targetKind:"text"`）。
- **视频要写显式 mapping**：fallback 打 `/v1/videos/generations`（复数）≠ new-api `/v1/video/generations`（单数）+ 轮询 `GET /v1/video/generations/{id}`。→ 视频需 create/query mapping，且轮询结果 url 字段要真测探明（探测脚本 `tests/transport-spike/newapi.mjs` 已就绪）。

## 2. 方案：onboarding 开 image/video 口 + new-api 视频 mapping

把 new-api 协议做成一个传输模板，用户填「自己的 baseURL + key + 模型 id + 类型(图片/视频)」即接入，复用现有 catalog mapping 机制（commitOnboardedModelToCatalog 已支持 targetKind image/video + draft.mappingCreate/Query）。

**参数层 MVP**：
- 图片：通用 new-api 图片 archetype（`prompt/size/n/quality/response_format`，覆盖 dall-e/gpt-image 族）。
- 视频：通用 new-api 视频 archetype（`prompt/duration/size/image` 公共字段，能出片）。model-specific metadata（kling 的 image_tail 等）留后续按 archetype 细化。
- 目标：**任何 new-api 模型都能"接上并出片"**，先解决 issue 的"不能接入"。

## 2c. 最终用户体验（样张已拍板 2026-06-19）

**中转优先 · 一次拉全 · 按模型分类**（不在顶上按图片/视频一刀切——那样只能一次弄一种）：
1. 填一次中转（协议[new-api 默认] + 服务器地址 + key）。
2. 「拉取这个中转开放的模型」(`/v1/models`，现有 `handleFetchModels` 已有)。
3. 列出全部模型，每个**自动判类型**（`guessModelKind` 按 id 关键词猜，图片/视频/文本，**用户可下拉改**）。
4. 勾选 → 「添加选中的 N 个」，一次混合加多类型。
**实现 = 扩现有「手填」路径**（[OnboardingWizard.tsx](../../src/ui/onboarding/OnboardingWizard.tsx) manual 分支已有 预设/baseURL/key/TagsInput 拉取/测试/保存），不另起 UI（P1）。现状它把模型全当 text 提交（[catalogCommit.ts:268](../../electron/catalog/catalogCommit.ts)）——改成带 per-model kind。

## 2d. 参数 UI 策略（避免造通用 archetype 的 P1 风险）

- **已知模型**（flux/kling…）：commit 不写死 archetypeId，渲染层 `resolveArchetypeForModel` 按 `identifierPatterns` **自动命中现有 archetype**（架构本就供应商无关）。
- **未知模型**：commit 时给**标准 flat 参数** `meta.parameters`（`ModelParameterControl[]`，含 `image-url` 类型表达参考图槽），渲染层 archetype 解析失败时 fallback 到它。
- **不造通用 archetype**（广 identifierPatterns 会盖具体模型 = P1 风险）。
- ⚠️ **待 mock 验证**：runtime fallback 的图片 body 把节点参数塞在嵌套 `extras` 发（[runtime.ts:634](../../electron/runtime.ts)），vendor 可能不认 → 富参数可能需给图片也建显式 mapping（基础 prompt→出图 fallback 够，size/quality 选择器要 mapping）。mock 跑一次定夺。

## 3. 切片（分两片，解耦）

| # | 切片 | 内容 | 验证 |
|---|---|---|---|
| **S1 核心·解决 #8** | new-api 传输适配器 | `electron/catalog/newapi*.ts`（图片同步 op + 视频异步 create/poll op + status 词表）；commit 入口（用户 baseUrl 套模板，仿 commitManualOpenAiCompatibleModels）；onboarding 加「new-api 中转」入口 | 单测 + **真实 E2E（需用户 new-api key）** |
| **S2 清理·P1** | 删 AI 读文档子系统 | 删 `electron/ai/onboarding/`（agent/docExtractors/specExtractors/curlBlueprint/draft/reporter…）+ IPC + UI `inputMode==='docs'` + bridge；图片/视频入口指向 S1 | 五门 + 走查无残引用 |

> 先 S1（加新、可验证、直接修复 reporter），后 S2（删旧，独立 PR，避免风险与功能耦合）。P1「加新必删旧」靠 S1→S2 紧邻落地保证，不留两条并行图片/视频入口。

## 4. 不动什么
- 不动 catalog/runtime mapping 执行机制（new-api 是又一组 op 模板）。
- 不动文本 manual 路径、apimart/kie/modelscope 品牌策展。

## 5. 验收门
- [ ] **真实 E2E（接入即验证，必过，需用户资源）**：用一个真实 new-api 中转 baseURL+key，图片真出图 + 视频真出片（轮询走通 succeeded）。video 轮询响应里"最终 url 字段路径"需真测定型（手配必漂）。
- [ ] 五门全过。
- [ ] 单测：new-api op 模板 + commit（image/video 各建出正确 mapping/targetKind/poll）。
- [ ] R13 走查：onboarding「new-api 中转」入口 → 填 URL/key/模型 → 节点能选并出片。
- [ ] R8：onboarding 入口与样张对账。
- [ ] R7：架构（按软件协议 vs 按品牌）6 角色 review（本方向已与用户讨论定，落地时补 CTO/前端/后端视角校验）。

## 6. 资源依赖
- **S1 的真实 E2E 需要一个 new-api 中转的 baseURL + key**（用户独有资源）。代码可先按 spec 写 + 单测，但不真测不报"done"（手配必漂）。

## 6b. 可发现性改造 A+B（2026-06-19 追加，用户拍板样张通过）

问题：中转站（含图片/视频）入口混在一排 LLM 预设 chip 里（第 12 个「自定义」），用户看不出「接自己中转能出图/视频」。根因：onboarding 心智是「挑 LLM 厂商」，中转/图片视频不是一等公民。

- **B 面板入口卡**（OnboardingDrawer）：「预置供应商」下方加一段「接你自己的中转」+ 强调色卡「接入你的中转站 · new-api（图片/视频/文本，一次拉全）」→ 开 Wizard 并预选 new-api。原「添加模型」卡改文案为「添加其他模型 / 官方厂商·自定义接口」。
- **A 弹窗分组**（OnboardingWizard + providerPresets）：预设按 `group` 分两组——「中转站（文本/图片/视频）」拎到最上（new-api + 自定义），下面「官方厂商（文本）」LLM chip 弱化。Wizard 接 `initialPreset` prop 供 B 预选。
- 中转站组只放 [new-api][自定义]（不放冗余的「OpenAI 兼容」，P1）。
- 验收：R8 与样张对账 + R13 真机走查（面板看到卡 → 点开弹窗中转组在最上）。

## 7. UX（onboarding 入口）
```
添加模型 → 类型/来源：
  ├ 文本模型（现有预设/自定义，不变）
  └ 图片 / 视频（中转）→ 协议 [new-api]  + 你的服务器地址 + key + 模型 id + 类型(图片|视频) + 测试连接
（旧「AI 读文档」入口 S2 删除）
```
