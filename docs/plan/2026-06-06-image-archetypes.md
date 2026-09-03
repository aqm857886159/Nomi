# 执行文档：把图像模型接入「模型档案」体系（image archetypes）

> 裁决：已被统一模型档案/能力目录取代；证据：`src/config/modelArchetypes/index.ts:63-75`、`electron/shared/videoCapabilities/registry.ts:42-45`、`docs/plan/2026-08-30-unified-model-integration-certification.md:31-40`。

> Rule 4 执行文档。自包含：读它 + CLAUDE.md（总纲/总纲之二/通用第一）+ 现有 `src/config/modelArchetypes/`
> + `electron/catalog/kie*.ts` 即可接手。**用户已拍板**：调研 kie.ai 当前模型 → 把核心图像/最新视频模型做成档案；
> UI 通用（复用 Seedance/HappyHorse 已建的模式条 + 参考槽 + 拖入/连线），**不出新样张**（通用第一·交互层）。

## 0. 现状（一页）

- 档案体系（`src/config/modelArchetypes/`）目前**只支持视频**：`ModelArchetype.kind = "video"`、
  `ArchetypeTransportTaskKind = "text_to_video" | "image_to_video"`。Seedance / HappyHorse / Seedance-Fast 三个。
- 图像模型（GPT Image 2 t2i/i2i、gemini-omni）**没有档案** → 走 flat 启发式回退（能用、无模式条/数组槽/拖入连线）。
- 传输：所有 kie 模型同 `createTask`/`recordInfo`；图像结果路径 = `data.resultJson.resultUrls.0`（读 image_url）。
- 已就位的通用件（这次新增档案直接复用，不重写）：模式条、AssetTile/Picker 参考槽、拖入/连线加参考、
  `referenceImageUrls` 数组单源、单源对账（mapping+model 按 seed id 自愈）、模型路由按 modelKey 精确选、
  零额度「接入即验证」结构门（遍历每档案×模式断言参考值进请求——**新档案自动纳入**）。

## 1. 调研结论（kie.ai，2026-06 实时核对）

接入优先级（用户点名 + 调研补充 Nano Banana）：

| 优先 | 档案 | kind | 模式（modelEnum / taskKind） | 槽 | 标量参数 |
|---|---|---|---|---|---|
| 1 | **GPT Image 2** | image | 文生图(`gpt-image-2-text-to-image`/text_to_image)、图生图(`gpt-image-2-image-to-image`/image_edit) | i2i：image_ref 数组(inputKey=`input_urls`) | aspect_ratio(auto/1:1/3:2…) |
| 2 | **Seedream**（字节） | image | 文生图(`seedream/4.5-text-to-image`/text_to_image)、改图(`bytedance/seedream-v4-edit`/image_edit) | 改图：image_ref 数组(≤10, inputKey 待核) | image_size/resolution |
| 3 | **Nano Banana**（Google） | image | 文生图(`google/nano-banana`/text_to_image)、改图(`google/nano-banana-edit`/image_edit) | 改图：image_ref 数组(inputKey 待核) | image_size/output_format |
| 4 | **Kling 3.0** | video | 文生视频 / 图生视频(首尾帧 image_urls) / 元素参考(`@element`) | 首/尾帧单槽 + kling_elements 数组(复杂，先简化) | mode(std/pro/4K)、duration(3-15)、aspect_ratio、sound |

- 字段精确值见各模型 doc（已抓）：GPT i2i `input.{prompt,input_urls[],aspect_ratio}`；Kling `kling-3.0/video`
  `input.{prompt,image_urls[],sound,duration,aspect_ratio,mode,multi_shots,multi_prompt[],kling_elements[]}`。
- **Seedream/Nano Banana 改图的 input 键名 + 结果路径，实现前再各抓一次 doc 核对**（别凭记忆）。
- 其余模型（Veo/Hailuo/Sora2/Flux/Imagen/Ideogram/Qwen/Midjourney…）→ 不做档案，走**通用回退**，不挡用户。

## 2. 架构改动：把档案体系从「video-only」扩到「image」（最小、向后兼容）

1. `ModelArchetype.kind`: `"video"` → `"video" | "image"`。
2. `ArchetypeTransportTaskKind`: 增 `"text_to_image" | "image_edit"`。
3. `ArchetypeMode` 增可选 `transportTaskKind?`（**覆盖档案级**）——图像档案的 t2i/i2i 两模式 taskKind 不同
   （video 档案所有模式同 taskKind，仍用档案级）。
4. `resolveTaskKind`（catalogTaskActions）：archetype 分支对 **image executionKind 也生效**，取
   `currentMode.transportTaskKind ?? archetype.transportTaskKind`（现仅 video 生效）。
5. 路由已就位：per-mode `modelEnum` + 已做的 modelKey 精确路由 → 每模式打到自己的 mapping，不撞桶。

## 3. 模型整合（跟 HappyHorse 同范式，避免迁移痛）

- HappyHorse 先例：**1 个伞模型 `happyhorse` + 档案 4 模式（per-mode modelEnum=真 kie 端点）**。
- GPT Image 2 照此：seed **1 个伞模型 `gpt-image-2`** + 档案 2 模式；档案 `identifierPatterns` **包含旧的两个 key**
  （`gpt-image-2-text-to-image`/`-image-to-image`）→ 老节点按身份自动套上档案，**无需数据迁移**。
- 旧的两个独立 model seed：从 CURATED_MODELS 移除（伞模型取代）；旧 mapping 仍按 taskKind+modelEnum 路由可用。
- 现有 `isBrokenKieImageMapping` repair 保留（修 onboarding 抽错的视频形状坏图像 mapping）。

## 4. 分阶段（每个模型一个垂直切片，逐个 commit）

A. **架构扩展**（§2，无模型）：类型 + resolveTaskKind + 测试。← 本次起步
B. **GPT Image 2 档案**：定义档案 + 伞模型 + mapping body 读 archetypeInput(`input_urls`) + 注册对账 + 测试。
C. **Seedream**：先抓 doc 核字段 → 档案 + mapping + 测试。
D. **Nano Banana**：同 C。
E. **Kling 3.0**：先做「文生/图生视频」两模式（首尾帧），`@element` 元素引用作为后续增强。

## 5. 验收门（每切片）

- 单测：档案模式/槽声明、archetypeInput 投影（含 image taskKind 互斥）、resolveTaskKind 取对 taskKind。
- **零额度「接入即验证」结构门自动覆盖新档案**（catalogTaskActions.test 遍历 MODEL_ARCHETYPES）——
  新档案声明了槽，参考值必须进请求体，否则红。
- CI 五门绿；档案 UI 复用现成件（design-fidelity 不变）。
- **真实出片验证**：需 kie 额度（用户暂不充）→ 先把档案/映射/零额度校验全做完，真跑等额度。

## 6. 不做 / 回滚

- 不给长尾模型逐个做档案（通用回退兜底）。
- Kling `@element` 多镜头本期从简。
- 回滚：档案是纯数据声明 + 向后兼容类型扩展；移除某档案 = 该模型回落通用回退，不影响别的。
