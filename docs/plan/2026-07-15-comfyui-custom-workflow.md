# ComfyUI 自定义 workflow「两者都做」— 计划

> 用户群反馈：内置 `comfyui-local` 只有一条写死的 SD 文生图（checkpoint 锁死 v1-5），装了 WAN2.2+WanVideoWrapper+VHS 想接本地文生/图生视频接不进来。用户 2026-07-15 拍板「两者都做」：① 预置 WAN 即用；② 自定义 workflow_api.json 导入。相关记忆 `comfyui-custom-workflow-decided-pending`、`local-comfyui-provider-shipped`。

## R5 已核实（官方源，非记忆）

- **workflow API 格式**（`docs.comfy.org/development/api-development/workflow-api-format`）：节点 ID 为键，每节点 `{ inputs:{…}, class_type:"…", _meta:{title} }`；inputs 值要么是**直接值**（数字/字符串），要么是**连线** `[源节点ID, 输出槽序号]`。这是 ComfyUI「Export (API)」导出的格式，**和 UI 保存格式不同**（UI 格式是 nodes[]+links[]+布局）。导入必须收 API 格式、对 UI 格式给明确提示。
- **`/upload/image`**（`docs.comfy.org/api-reference` + 社区）：`multipart/form-data`，字段 `image`(文件)、可选 `type`(input/temp/output,默认 input)、`subfolder`、`overwrite`；返回 `{name, subfolder, type}`；按字节 hash 去重。LoadImage 的 `image` 填 `subfolder ? "subfolder/name" : name`。**注意：返回的是文件名不是公网 URL**，与现有 assetIngestion（都返 urlPath 公网 URL）不同 → 需新策略。
- **VHS_VideoCombine 输出**（Kosinkadink/ComfyUI-VideoHelperSuite）：`/history` 的 `outputs.<node>` 下是 **`gifs`** 数组（历史命名，mp4/webm 也用这个键），每项 `{filename, subfolder, type}` → `/view?filename=&subfolder=&type=`。**现 transform 只读 `images` → 视频取不到（根 bug）**。
- **WAN2.2**（`docs.comfy.org/tutorials/video/wan/wan2_2`）：ComfyUI 0.3.46+ 原生支持，节点 `UNETLoader`/`CLIPLoader`/`Wan22ImageToVideoLatent`/`CreateVideo`/`SaveVideo`（5B TI2V 一图既能 t2v 又能 i2v）。用户装的 kijai **WanVideoWrapper + VHS** 是社区路（另一套节点 + VHS 输出）。→ **自定义导入才是稳的**（用户带自己跑通的图，节点/模型名都对得上）；预置服务原生 WAN 用户。

## 两条路 = 一个引擎两个入口（P4）

底层注参引擎已通用（`{{request.params.X}}` 深层递归注入任意 JSON、`/prompt`+`/history` 轮询、`comfy_*` 前缀避 taskTemplateParams 清空）。**两条路都产出同一种东西**：一个 `{prompt:<注了{{}}的图>, client_id}` 的 create op + 一条 query op。区别只在图从哪来、参数怎么绑：

| | 预置 WAN（①） | 自定义导入（②） |
|---|---|---|
| 图从哪来 | 我们 bake 的原生 WAN API-json | 用户 Export(API) 导入 |
| 参数绑定 | 我们预设好（prompt/首帧/帧数…绑到已知节点） | 自动识别常见节点 + 用户确认剩余 |
| 存哪 | curated model+mapping（code-owned） | **用户自有 model+mapping**（防 reconcile 覆盖） |
| 模型文件 | 参数暴露（默认标准名） | 图里本来就写好了 |

## 关键：用户自有 workflow 不能挂 curated（防 reconcile 覆盖）

`seedBuiltins.reconcileModels/reconcileMappings` 会在每次启动对 curated 的 `parameters`/`create`/`query` 做**漂移覆盖**。所以自定义导入的图必须存成**用户自有的 model+mapping**（走普通 upsertModel/upsertMapping，不在 curated 列表里 → 不被覆盖）。这与 onboarding 自接模型同待遇。

## 分步（逐步推进 · 每步独立可测可上）

- **S1 视频输出变换（地基，服务两路）**：`comfyui-history` 变换扩成也读 `gifs`/`videos`（+ 带视频扩展名的 `images` 兜底）→ 出 `video_url`；图片路不变（先 images→image_url）。纯函数 + 单测（mock VHS /history）。← 本轮先做
- **S2 首帧上传（地基，i2v 必需）**：新 assetIngestion 策略 `comfyui-upload`——POST `/upload/image`（multipart，field `image`），取回 `name`(+subfolder) 作为**文件名字符串**（非 URL）注入到 LoadImage 绑定的参数。改 `assetLocalization.resolveLocalAsset` 识别该策略。单测（mock server）。
- **S3 自定义导入后端**：解析 workflow_api.json（校验 API 格式、非 UI 格式给提示）；自动识别可映射节点（LoadImage=首帧、CLIPTextEncode/正向=提示词、VHS/SaveVideo/SaveImage=输出、KSampler.seed/steps…=数值参数）；把用户绑定的节点 input 替换成 `{{request.params.X}}` / `{{request.prompt}}`；生成用户自有 model(kind 由输出类型定)+mapping(taskKind 由 i2v/t2v/t2i 定)。纯函数为主 + 单测。
- **S4 导入 + 映射 UI**：接入页「本地 ComfyUI」卡加「导入工作流」；贴 workflow_api.json → 自动识别结果预览 → 用户确认/微调映射（哪个节点收提示词/首帧/输出）→ 存。读真实外壳组件再画样张（R8）。
- **S5 预置 WAN**：抓真实原生 WAN API-json（Comfy-Org/workflow_templates，验证节点/字段）bake 成 curated model+mapping，模型文件名/帧数/步数暴露成参数。**记得几个跑通的 workflow**（用户可贡献自己的 WanVideoWrapper 图当预置基）。
- **S6 R13 + 文档**：真机（用户的 ComfyUI 或 mock server）走 t2v/i2v 端到端；更新 handbook。

## 不动项 / 回滚

- 现文生图 curated（`comfyui-txt2img`）行为不变——S1 只**加**视频分支，图片分支恒等。
- runtime/requestPipeline/taskResultQuery **不用改**（引擎已通用）。
- 回滚：每步独立 commit，可单独 revert。

## 验收门

- S1：单测——VHS `gifs` 响应 → `video_url` 正确拼 `/view`；纯图响应仍出 `image_url`；无输出仍原样（继续轮询）。
- S2：mock server 收到 multipart 上传、图注入 LoadImage、/prompt body 里 LoadImage.image = 上传回的文件名。
- S3：给一个 WAN i2v API-json，自动识别出首帧/提示词/输出节点，产出的 create.body.prompt 里对应 input 变成 `{{}}`。
- 端到端（S6）：真机 i2v 出视频（`data-kind="video"` 节点出 mp4）。

五门每步全过；push 前 `pnpm run gates`。
