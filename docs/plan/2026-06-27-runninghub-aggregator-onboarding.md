# RunningHub 聚合器接入 —— 注册表驱动 + 默认精选 + 全量折叠

> 日期：2026-06-27 ｜ 状态：待用户拍板（范围已定：生成器全做/默认精选/全量折叠；阻塞项：API key 验收）
> 关联记忆：[[seedance-2.0-4k-mini-onboarding]]（已有 Seedance via kie/apimart）·[[model-onboarding-must-cover-full-api-doc]]·[[onboarding-connected-available-split]]（已接入/可接入分层）·[[jimeng-cli-onboarding-researched-blocked-on-vip]]（卡 vip 验收的同构先例）

## 0. 一句话

RunningHub 是 **aggregator**（一个 key 解锁 355 个标准模型 API）。接它的价值不是「又一家 Seedance」，是「一次接入=一整片广度」。但 355 全铺给用户选 = 商品化 + 选择瘫痪 + 验不动。**所以：写生成器把全量做成可得，但 UI 默认只亮 3–5 个最新 SOTA（真跑验收），其余折叠在「展开全部」后。**

## 1. 已验证的事实（不是猜，来自实查）

- **API 形状**（实读开源插件 `core/task.py`/`rest.py`，Apache-2.0）：
  - 提交 `POST https://www.runninghub.cn/openapi/v2/{endpoint}`，endpoint 来自注册表
  - 轮询 `POST https://www.runninghub.cn/openapi/v2/query`
  - 鉴权 `Authorization: Bearer <KEY>`，响应 `{code:0,data,msg}`，状态 `SUCCESS/FAILED/RUNNING/QUEUED/CANCEL/CREATE`
  - → **和我们 kie/apimart 同构，runtime 零改**
- **契约源**：`HM-RunningHub/ComfyUI_RH_OpenAPI` 的 `models_registry.json`（1.18MB，355 模型，Apache-2.0）。每条含 `class_name/display_name/name_cn/name_en/endpoint/output_type/category/params[]`；`params[]` 含 `fieldKey/type(STRING|LIST|IMAGE|...)/required/defaultValue/options[]/maxInputNum/accept/maxSize`。**这就是「用别人做好的确保正确」的复用对象——吃数据，不跑它的 Python。**
- **盘子**：355 = 视频 198 / 图片 78 / 文本 44 / 音频 19 / 3D 16。厂牌：Kling 40·Seedance 27·Vidu 22·Wan 19·MiniMax 17·PixVerse 15·RHArt(自营)…
- **会员墙**：免费用户调不了 API，**最低 Personal 会员**（Consumer key）。无合法免费路径，不逆向（同即梦只走官方）。

## 2. 范围

**做（v1）**：视频 + 图片 + 音频三类（≈295，Nomi 现有节点家能落）。
**不做（v1）**：文本 44 + 3D 16（Nomi 无对应节点家，要先造新 archetype，且方向本身存疑，单独立项）。
**默认亮的精选**（真跑验收，R5 已核当前 SOTA）：
- 视频：`bytedance/seedance-2.0-global/{text-to-video,image-to-video,multimodal-video}`、`kling-v3.0-pro/{text-to-video,image-to-video}`、（候选）`vidu/text-to-video-q3-pro`、`minimax/hailuo-2.3/t2v-standard`
- 图片：`seedream-v4.5/text-to-image`、`seedream-v5-lite/text-to-image`、（候选）`bytedance/jimeng-4.6/*`
- 终选 3–5 个，验收通过即进默认；其余 290 折叠。

## 3. 架构（声明驱动，runtime 不碰）

参照 Explore 勘查的现有 vendor 接入三层：

### 3.1 生成器（新增，核心）
`scripts/genRunninghubCatalog.ts`（构建期跑，非运行时）：
1. 读 vendored `vendor/runninghub/models_registry.json`（连 LICENSE 一起 vendor，标注 Apache-2.0 出处）
2. 过滤 `output_type ∈ {video,image,audio}`
3. 每条 →
   - **create op**：`endpoint` → HttpOperation path；`params[]` → body 模板 + paramMap 翻译
   - **archetype 投影**：`LIST`→select 控件 + options；`IMAGE`→参考槽（按 maxInputNum/accept/characterIndexed）；`STRING`→文本/prompt；按 `name_en` 的 `text-to-video|image-to-video|start-end|multimodal` 归并模式
   - **variant 归并**：同 category 的 pro/std/fast/版本号 → archetype variants（避免 Kling 40 条摊平成 40 个模型）
4. 输出 `electron/catalog/generated/runninghub.gen.ts`（数据，巨壳门岗豁免或分片）+ `src/config/modelArchetypes/generated/runninghub.gen.ts`
5. 生成器**幂等**，注册表更新重跑即同步（derive-not-hardcode）

### 3.2 catalog（主进程，手写薄壳）
- `electron/catalog/runninghubVendor.ts`：vendor 种子（baseUrl `…/openapi/v2`、bearer、status 动词映射、共享轮询 op `POST /query` + response_mapping 抽 `data` 里 video/image/audio url）
- `seedBuiltins.ts:297-348`：import generated + seedVendor + reconcileModels + reconcileMappings 各一行（参照 dreamina `:309/:322/:347`）
- 素材上传：先复用 `ANON_UPLOAD_CHAIN` 兜底（`assetLocalization.ts:307`）；若 RunningHub 有专属 upload 端点再补 `CURATED_*_INGESTION`

### 3.3 UI（默认精选/全量折叠，复用现成分层）
复用 [[onboarding-connected-available-split]] 的「已接入/可接入 + 自适应默认」：
- 默认只渲染精选组（展开）+「展开全部 RunningHub 模型（290+）」折叠入口
- 一个 RunningHub key 输入位（32 位 Consumer key）

## 4. 不动项（防越界）
- `electron/runtime.ts` / `tasks/taskResultQuery.ts` / `capabilityCore/*` / `main.ts` IPC —— 声明驱动通用引擎，**一行不改**
- 已有 Seedance via kie/apimart 保留（P4 多渠道并存，非删旧，RunningHub 是新增渠道不是替换）
- 文本/3D 不碰

## 5. 验收门（P3：全绿≠完成）
- 五门：`pnpm run gates`
- 生成器单测：注册表 fixture → 断言生成的 create op/archetype 形状（端点拼接、LIST→options、IMAGE→槽 min/max）
- 种子单测：`runninghubVendor.test.ts`（vendor/model/mapping reconcile）
- **真生成验收（需 key）**：每个 archetype 家真跑 1 条最省档（Seedance t2v / Kling t2v / Seedream t2i…），VLM/人眼判出片正确；评测额度默认授权直接花
- R13 真机走查：模型设置面板看到精选+展开、连一个 key、画布跑一镜出片

## 6. 回滚
- 生成产物 + 薄壳全在独立文件 + seedBuiltins 几行登记；revert 这些文件即净退。
- vendor 用稳定身份键（vendorKey=`runninghub`、modelKey=endpoint），不 rename（守 [[never-wipe-user-data-on-update]]）。

## 7. 阻塞 / 待用户
- **API key + Personal 会员**（用户独有资源）：无 key 我能做到「生成器+全量声明+UI 五门绿」，但真生成验收挂起（同即梦卡 vip）。拿到 key 即补跑精选验收 → 才算接好。
- 终选哪 3–5 个进默认精选：按验收结果定（出片质量/速度/价格）。

## 7b. v1 兼容集（用户拍板：先兼容 apimart 现有 + 3D 最新几个）

**口径收窄**：v1 不做全量 295，先把 **apimart 现有模型**经 RunningHub 兼容（一个 key 当替代渠道，P4），外加 **3 个最新 3D**（要新造 3D 节点家）。生成器仍吃注册表，只是 emit 范围限定到这批。

### 视频（7，全 ✅，复用现有 archetype）
| apimart | RunningHub 端点（官方稳定版优先） |
|---|---|
| Sora 2 | `rhart-video-s-official/text-to-video`·`/image-to-video`(+pro) |
| Veo 3.1 | `rhart-video-v3.1-pro-official/{text-to-video,image-to-video,start-end}` |
| 可灵 3.0 | `kling-v3.0-pro/{text-to-video,image-to-video}`·std |
| Seedance 2.0 | `bytedance/seedance-2.0-global/{text-to-video,image-to-video,multimodal-video}` |
| Wan 2.7 | `alibaba/wan-2.7/{text-to-video,image-to-video,reference-to-video}` |
| Hailuo 2.3 | `minimax/hailuo-2.3/{t2v-standard,i2v-standard,t2v-pro,i2v-pro}` |
| Omni-Flash-Ext | ≈ `rhart-video-v3.1-*-official/video-extend`（⚠️需核能力一致） |

### 图片（4 ✅ + 2 ❌ 缺口）
| apimart | RunningHub | |
|---|---|---|
| Seedream 4.5 | `seedream-v4.5/{text-to-image,image-to-image}` | ✅ |
| Nano Banana | `rhart-image-v1/{text-to-image,edit}`(+pro) | ✅ |
| GPT Image 2 | `rhart-image-g-2-official/{text-to-image,image-to-image}` | ✅ |
| Qwen-Image 2.0 | `alibaba/qwen-image-2.0/{text-to-image,image-edit}`(+pro) | ✅ |
| Imagen 4 | — | ❌ RH 无，apimart 独占 |
| Z-Image Turbo | — | ❌ RH 无，apimart 独占 |

### 音频
TTS ✅ `rhart-audio/text-to-audio/speech-2.8-hd`(MiniMax 多档)；**转写(ASR) ❌ RH 无**（apimart Whisper 独占）。

### 3D（3 个最新，需新造节点家 —— 见 §7c）
| 模型 | 端点 | 输出 |
|---|---|---|
| 混元3D v3.1 | `hunyuan3d-v3.1/{text-to-3d,image-to-3d}` | .glb |
| HiTem3D v21 | `hitem3d-v21/{image-to-3d,multi-image-to-3d}` | .glb |
| Meshy 6 | `meshy6/{text-to-3d,image-to-3d}` | .glb |

> 缺口诚实标在 UI：Imagen 4 / Z-Image / Whisper 转写 留在 apimart，不假装 RH 能跑。

## 7c. 3D 节点家（新造，让 3D 能落地）

**研究结论（R6）**：同类（ComfyUI Load3D / 3d-viewer-pro / tldraw custom shape）都是「节点内嵌 Three.js 交互预览」。**架构决策：复用 Nomi 现有 R3F + drei 栈，不引 model-viewer**（后者塞第二套 Three.js = 违反 P1 + 包体翻倍）。**零新依赖**。RunningHub 3D 输出 = .glb，正好命中 `useGLTF`（只吃 glb；.obj 不做，MVP 只 glb）。

**复用（0 改）**：R3F+drei+three 依赖、`useGLTF→clone→<primitive>` 管线（`scene3dObjects.tsx:96`，错误边界 `:78`）、`<Canvas>`/灯光/OrbitControls 模式（`scene3dSceneView.tsx`）、落盘 `importLocalFile`/`nomi-local://`、**CSP 已放行 wasm**（`main.ts:441`）。

**新建**：① `<Model3DViewer url>` 薄组件（抄 Mannequin 去骨骼数学 + 加 OrbitControls 让用户转）；② 一个 3D archetype（仿 `audioArchetype.ts` 声明 `text_to_3d`/`image_to_3d`）；③ runner 接入（仿 `electron/audioTaskRunner.ts`：fetch glb 字节→importLocalFile→model3d 资产）。

**要改的分发点（Explore 钉死的清单）**：
1. `nodes/registry.ts:61` 加 plugin；`:16` `GenerationNodeExecutionKind` 加 `model3d`；`:17` 图标键（`IconCube` 复用）+ `renderRegistry.tsx:33` NODE_ICONS
2. 渲染走层 A（推荐，最不碰巨壳）：`resolveRenderKind.ts:6,17` + `NodeCardBody.tsx:24` 加 `model-3d-card`
3. `generationCanvasTypes.ts:10` `GenerationResultType` 加 `'model-3d'`；`:12` taskKind 加 `'model3d'`；`:31` 默认分类 case
4. `config/modelArchetypes/types.ts:58` `ArchetypeTransportTaskKind` 加 `text_to_3d`/`image_to_3d`；`:140` archetype `kind` 加 `model3d`
5. `runner/catalogTaskResultParse.ts` `generationTypeForTask` + `runner/generationNodeExecutor.ts`/`generationRunController.ts` executionKind 分支加 `model3d`
6. `electron/assets/assetPaths.ts:8,33` 补 `model/gltf-binary↔.glb` 映射（否则 glb 落成 octet-stream/file）
7. 确认 `generationCanvasSchema.ts` zod 枚举注册表驱动（自动覆盖则免改）
8. TimelineTrackType **不动**（3D 不进时间线）；若要「转盘视频进时间线」走现有 video 路径

## 8. 工作量
- 生成器：中（核心是注册表 schema → 我们 archetype/op 的映射规则 + variant 归并）
- 薄壳 + 登记：小（有 6 家样板）
- 真生成验收：按精选数量，需 key
- 主要风险：注册表 `params` 的边角类型（多图/音频参考、@引用多模态）映射到我们参考槽机制的精度 → 靠生成器单测 + 精选真跑兜
