# LibTV vs Nomi 功能差距分析与补齐方案

> 2026-09-07 · 基于《LibTV使用指南》（wiki 原文 + Downloads docx 全文解析）与 Nomi 真实代码盘点（逐项有 file:line 证据，见文末附录）。
> 结论先行：**LibTV 的"大件" Nomi 基本都有甚至更强；差距集中在 9 个小工具型功能，其中 6 个没有根本性难度，2 个中等，1 个建议放弃。**
> 配套文档：逐项全量对比 `2026-09-07-libtv-full-feature-by-feature-comparison.md`（81 项交互版 `.html` 同名）· **深度构建调研 + 对抗评测 + 量化验收门 `2026-09-07-libtv-gap-remediation-research-and-adversarial-review.md`**。

---

## 一、总览对比表

图例：✅ 已有（真实代码证明） · 🟡 部分/弱实现 · ❌ 没有

| # | LibTV 功能 | LibTV 能力摘要 | Nomi 现状 | 判定 | 补齐难度 |
|---|---|---|---|---|---|
| 1 | 无限画布 + 5 类基础节点 | 文本/图片/视频/音频/脚本 | 14 种节点（多出角色/场景/关键帧/3D/画板/全景/剪辑） | ✅ 领先 | — |
| 2 | 节点连线工作流 | 连线、打组、整组执行、保存工作流 | 连线 + 依赖波次批量执行 + 任务中心 + 工作流模板库 | ✅ 领先 | — |
| 3 | 剧本→分镜脚本节点 | 剧本拆 shot + 角色/场景/道具资产提取 + 批量生图/生视频 | storyboardPlan IR → 资产锚（含身份 DNA）→ 分镜表 → 批量条 → 冻结门一致性 | ✅ 持平（资产化程度相当） | — |
| 4 | 视频拉片（逐帧解析） | 分镜拆解 → 表格（景别/运镜/时长/人声） | 本地切点检测 + 多帧 VLM + Whisper 合流 → 分镜表 → 勾选落画布 | ✅ 持平 | — |
| 5 | 导演台（3D 构图/运镜） | 3D 白模 + 机位 + 运动轨迹 + 一键跟随 | 3D 场景编辑器 + 12 种运镜预设 + 轨迹捕捉 → 参考视频 | ✅ 领先 | — |
| 6 | 视频合成（时间轴） | 多段拼接 + 音轨 + 拖拽/裁剪 + 预览 | 多轨时间轴（转场/字幕/磁吸/撤销）+ ffmpeg/Remotion 多后端导出 | ✅ 领先 | — |
| 7 | 图像生成器（多模型/风格/参考） | 10+ 图像模型、风格库、多参考 | 20+ 图像模型档案、多参考最多 14 图 | ✅ 持平 | — |
| 8 | 视频生成器（多模型/首尾帧） | 可灵/Wan/Seedance 等 | 35 个视频模型档案，Seedance 2.5 首尾帧/多参考 30 图 | ✅ 持平 | — |
| 9 | TTS / 音乐 / 音效 | Eleven V3 / Minimax / Mureka | 豆包/Seed/MiniMax/Eleven TTS + Suno(可续写)/Lyria 等 | ✅ 持平 | — |
| 10 | 智能引用 AutoLink | 提示词打字时自动 @ 匹配画布素材 | @引用 mention 体系（素材库 chip）已有，但无"边打字边推荐"实时匹配 | 🟡 | 低 |
| 11 | 扩图（outpainting） | 6 种画幅比外扩，1K/2K/6K | ❌ 无 | **缺失** | 低 |
| 12 | 重绘（inpaint 画笔涂抹改图） | 画笔涂抹 + 提示词修改 | ❌ 无画笔 inpaint（有 AI 元素拆解编辑，可覆盖一部分） | **缺失** | 低-中 |
| 13 | 智能续写（视频从任意点续拍） | 选起点 → 延续人物/场景/风格续生成 | 有 return_last_frame + 抽尾帧落节点，链路差一步 UX 串联 | **缺失（易补）** | 低 |
| 14 | 视频高清化/超分 | 2/4/6 倍放大 + 30/60/90fps 补帧 | ❌ 无视频 upscale（图像有即梦 upscale） | **缺失** | 中 |
| 15 | 片段重拍 | 时间轴选段 + 逐段文字描述重拍 | ❌ 无（有手动切镜 + 重新生成，但无时间轴选段重拍 UX） | **缺失** | 低 |
| 16 | 人声/背景音分离 | 分离干净人声或 BGM | ❌ 无 | **缺失** | 低 |
| 17 | 分离音视频 | 画面/音频分离 | ❌ 无独立入口（ffmpeg 一行命令） | **缺失** | 低 |
| 18 | 音频截取/变速/切分 | 精准裁剪、变速、按时间点切分 | ❌ 无音频变速控件 | **缺失** | 低 |
| 19 | 音色克隆 | 录音样本 → 专属音色 → 持续配音 | 仅 Runway Seed Audio 一条克隆参考通道 | 🟡 | 低-中 |
| 20 | 深度动作捕捉 | 视频提深度 → 风格无关运镜参考 | ❌ 无（3D 角色是键盘手动驱动） | **缺失** | 中-高 |
| 21 | 全景 720° 生成 | 文本/参考图生成全景 + 多视角截图 | 有全景节点（查看/截图），无**生成** | 🟡 | 中 |
| 22 | 宫格类工具（多机位九宫格/剧情推演/25宫格） | Slash 一键生成宫格分镜 | 有四/九宫格**切分**，无宫格**生成**预设；联系表拼图已有 | 🟡 | 低 |
| 23 | 图像基础编辑 | 高清/扩图/重绘/擦除/抠图/裁剪 | 抠图/裁剪/旋转/切图/高清放大有；擦除、扩图、重绘无 | 🟡（差 3 项） | 低 |
| 24 | 镜头聚焦（框选出特写分镜） | 框选 → 细节特写生成 | ❌ 无显式入口（可用裁剪+图生图绕行） | 缺失 | 低 |
| 25 | 多角度（三维网格球选机位重渲） | 8 水平+4 俯仰+3 景别 | 3D 场景可导出多机位构图图，但没有"对已有图片改机位重渲" | 🟡 | 低-中 |
| 26 | 打光/人像调节/情绪调节 | 26 点位打光、去 AI 塑料感、25 种表情 | ❌ 无显式工具（可由图像编辑模型 prompt 化实现） | 缺失 | 低 |
| 27 | 主体库（跨片一致主体） | 多图/视频建主体，生成时调用 | 角色/场景/道具定妆卡 + 资产锚体系已有（架构不同但目标一致） | ✅ 持平 | — |
| 28 | 视频剪辑（单段裁取） | ≤10min 裁剪、I/O 打点 | ClipNode trim + 手动切镜 | ✅ 持平 | — |
| 29 | 分镜组（多图拼宫格统一管理） | 智能排序、拼接 2K/4K 大图 | 联系表拼图已有 | ✅ 持平 | — |
| 30 | 分享/社区/发布 | 画布分享链接、社区发布 | ❌ 无协作（本地优先产品，当前非目标） | 缺失 | 暂缓 |

---

## 二、缺失功能逐项调研（怎么补、用什么补）

### A 档：没有根本性难度，纯串联/现成能力（6 项，建议先做）

#### A1. 智能续写（视频续拍）
- **路径**：Nomi 已有 `return_last_frame`（Seedance 2.5）和 `extractVideoFrameToNode` 抽尾帧。缺的只是一条 UX 链：视频节点选时间点 → 抽该帧落关键帧节点 → 自动新建 i2v 视频节点并连线 → 续写提示词输入框。
- **改动面**：1 个面板（起点选择）+ 复用抽帧与连线 API。不新增模型。
- **工作量估计**：1–2 天。

#### A2. 片段重拍
- **路径**：同 A1 的链路家族：时间轴选段（Nomi 时间轴已有选区交互）→ 每段文字描述 → 逐段生成"重拍任务"（首帧 = 原段首帧 + 重拍提示词 → i2v）→ 结果替换回原视频轨。
- **改动面**：一个"重拍"弹层 + 任务编排，全部复用现有 i2v 档案。

#### A3. 音频截取 / 变速 / 切分
- **路径**：纯 ffmpeg（`atrim` / `atempo` / `asplit`），Nomi 主进程 ffmpeg 基建完整（`electron/export/` 20+ 文件）。在音频节点加 3 个工具按钮。
- **注意**：`atempo` 支持区间 0.5–2.0，超范围需级联。

#### A4. 分离音视频 + 人声/背景音分离
- **分离音视频**：ffmpeg `-vn/-an` 一行命令，半天。
- **人声分离两条路径**：
  - API：ElevenLabs `/v1/audio-isolation`（≤500MB / 1 小时，按量计费）——Eleven 已在 Nomi 供应商栈里，最省事；
  - 本地：Demucs / MossFormer2（用户机器有 Python 环境与 Whisper 本地先例），零 API 成本，符合"本地优先"人设。
- **建议**：先接 Eleven API 快速可用，本地 Demucs 作为离线选项二期。

#### A5. 扩图（outpainting）
- **路径**：不需要专用模型。用已接入的图像编辑模型（Nano Banana 2 / Seedream 5 Pro / GPT-Image）的标准做法：把原图按目标画幅贴到新画布上（本地 canvas 合成即可），原图内容 + "补全四周画面"的指令发给图生图模型。Seedream 5 Pro 与 Nano Banana 都能稳定完成。
- **改动面**：一个"扩图"工具弹层（选目标画幅比 + 本地合成基准图 + 调用现有图生图档案）。

#### A6. 重绘画笔（inpaint）+ 擦除
- **路径**：与扩图同一家族。涂抹 mask → 两种实现：
  - 快：把"标注了修改区域的图 + 修改指令"发给 Nano Banana 2 / Seedream 5 Pro（它们支持框选/指令式精准编辑，LibTV 自己也是这么宣传 Seedream 5 Pro 的）；
  - 稳：接入支持 inpaint 的模型档案（如 SD 系/魔搭 Edit，Nomi 已有魔搭 Image/Edit）。
- **注意**：画笔 UI 可复用现有画板节点（Leafer）能力，不必从零写涂抹组件。

### B 档：中等难度，需要选型/新档案（3 项）

#### B1. 视频高清化 / 超分
- **调研结论**：API 侧 Replicate 有 real-esrgan-video（快、便宜）、runwayml/upscale-v1（≤4K、40s 内视频）、topazlabs/video-upscale（质量最好、贵）；补帧可用 Google/FILM 插帧。Nomi 有 Replicate 接入先例（元素拆解 qwen-image-layered 走的就是 Replicate）。
- **建议**：做 1 个 `videoUpscale` 任务档案（Replicate real-esrgan-video 起步，模型可换），ffmpeg 管帧率提升（`minterpolate`/`fps` 滤镜）。视频超分耗时随长度增长，需要接进现有常驻任务队列 + 进度面板。
- **工作量**：3–5 天（含任务队列接入与长视频分片）。

#### B2. 音色克隆（补强）
- **调研结论**：MiniMax Speech 2.8 官方 Voice Clone API 明确可用：上传 10s–5min 音频（File Upload API → file_id）→ `POST /v1/voice_clone`（自定义 voice_id + clone_prompt 提升相似度）→ T2A 合成。注意事项：克隆音色 7 天内须用一次否则被清（国内版）；需企业认证（国内版）；首次使用克隆音色收一次性解锁费。另有一条阿里云百炼通道（DashScope `action: voice_clone`）。
- **Nomi 现状**：MiniMax Speech 2.8 档案已有，只差"克隆音色管理"一小块（上传 → 克隆 → 存 voice_id → 下拉可选）。
- **建议**：在音频节点加"我的音色"面板。ElevenLabs 也支持 Professional Clone，可作第二供应商（走 P4 档案声明槽设计，不做并行版）。

#### B3. 深度动作捕捉
- **调研结论**：LibTV 用自有模型提深度视频。开源可行路径：Depth Anything V2（逐帧深度，本地或 Replicate 均有）、ProPainter/DepthCrafter 做时序稳定视频深度。Nomi 3D 场景节点已有轨迹→视频渲染管线，深度视频可作为 i2v 的运动参考输入。
- **建议**：接 Replicate depth-anything-video 或本地 DepthCrafter，输出深度视频落画布节点。**难度中-高**（时序稳定性、算力），建议排在 A/B 档其余项之后，先验证 Seedance 多参考对深度视频的实际收益再决定做不做。

### C 档：价值重估后再说（2 项）

#### C1. 全景图生成
- Nomi 有全景查看/截图，缺生成。路径：图像模型出 2:1 等距柱状投影图（Seedream/Nano Banana 可出，质量不稳定）→ 落全景节点。LibTV 自己也承认户外空场景失败率高、接缝难闭合。
- **建议**：不单独立项；作为图像节点的一个画幅/风格预设（"360° 全景（等距柱状）"）顺带支持，落到全景节点直接可查看，边际成本≈0。

#### C2. 深度协作/分享
- 本地优先产品当前阶段不做多人协作，与 LibTV（云端 SaaS）定位不同。仅记录，不排期。

### D 档：prompt 化打包（1 个动作覆盖 4 项）

多机位九宫格 / 剧情推演四宫格 / 25宫格连贯分镜 / 打光 / 人像去塑料感 / 情绪调节 / 镜头聚焦——这些在 LibTV 里是"预设按钮"，本质是**经过调优的提示词模板 + 宫格切分**。
- Nomi 已有宫格切分、联系表、提示词库。
- **建议**：把这 7 个做成提示词库里的官方预设分组（如"分镜预演""质感修复"），一键注入图像节点生成器，配合已有切图工具。成本主要是调词与验收样张，不是工程。这在架构上完全符合 P4（通用槽，模型无关）。

---

## 三、落地排期建议

| 批次 | 内容 | 理由 |
|---|---|---|
| **P0（1 周内）** | A1 智能续写、A3 音频工具三件套、A4 分离音视频、A6 扩图 | 全是现有能力的 UX 串联/ffmpeg，快速把"缺失清单"砍掉一半 |
| **P1（第 2 周）** | A2 片段重拍、A5 人声分离（Eleven API + 本地 Demucs 二选一先行）、A6 重绘画笔、D 档预设包 | 覆盖 LibTV 最出圈的两个功能（片段重拍/逐帧拉片生态） |
| **P2（第 3–4 周）** | B1 视频超分、B2 音色克隆面板、A1' AutoLink 实时引用 | 中等工程量，走完整 R5 对账 + 样张验收 |
| **择机** | B3 深度动作捕捉、C1 全景生成预设 | 先验证收益，不承诺排期 |

**每项验收口径（P3/R16）**：真实素材端到端跑通「素材进 → 功能用 → 结果回流画布/时间轴 → 导出」，Playwright 走查 + 人眼判断样张，不留半成品。

---

## 四、关键判断（为什么 LibTV 有些功能"看起来多"）

1. **LibTV 的一大类功能是提示词预设的产品化包装**（宫格、打光、情绪、人像调节），没有模型壁垒——Nomi 用提示词库 + 现有图像编辑模型可覆盖，且 P4 架构下更干净。
2. **LibTV 的另一大类是 ffmpeg 级工具**（音频截取/变速/切分、分离音视频、视频裁剪）——Nomi 的 ffmpeg 基建比它还深（多后端导出），缺的只是按钮。
3. **真正有壁垒的只有三样**：5min 超长直出（模型侧能力，受供应商限制）、专业音色克隆生态、深度动捕。前两者 Nomi 可通过供应商档案补齐，第三个建议观望。
4. **Nomi 反超的地方**：14 类节点 vs 5 类、35 个对账视频档案、本地推理（Whisper/抠图/ComfyUI）、多轨时间轴、3D 导演台轨迹系统。对标叙事应该是"LibTV 有的我们串得出来，我们有的它没有"。

---

## 附录：Nomi 现状证据索引（file:line）

| 能力 | 证据 |
|---|---|
| 14 种节点注册表 | `src/workbench/generationCanvas/nodes/registry.ts:61-276` |
| 依赖波次批量执行 | `src/workbench/generationCanvas/runner/dependencyWaves.ts:1-47` |
| 工作流模板库 | `src/workbench/library/workflowLibrary.ts:6-22,90` |
| 多参考上限 14 图 | `src/config/modelArchetypes/nanoBanana2.ts:117,170` |
| 图像编辑工具条 | `src/workbench/generationCanvas/nodes/useNodeImageEditing.ts:15-22`、`NodeImageEditToolbar.tsx:16` |
| 本地抠图 WASM | `src/lib/removeBackground.worker.ts:1-14` |
| 视频档案注册表（35 个） | `electron/shared/videoCapabilities/registry.ts:61-96` |
| Seedance 2.5 首尾帧/多参考/尾帧返回 | `electron/shared/videoCapabilities/seedance25.ts:4-45` |
| 12 种运镜预设 | `src/workbench/generationCanvas/nodes/scene3d/cameraMovePreset.ts:160-216` |
| 轨迹→参考视频 | `electron/video/framesToVideo.ts:1-7` |
| 剧本→分镜 IR | `src/workbench/generationCanvas/agent/storyboardPlan.ts:12-80` |
| 分镜批量条 | `src/creation/storyboard/StoryboardBulkBar.tsx:5-16` |
| 视频拉片 | `electron/video/deconstructVideo.ts:1-13`、`detectShotCuts.ts:1-20` |
| 多轨时间轴 | `src/timeline/TimelinePanel.tsx:1-40` |
| 多后端导出 | `electron/export/exportPlanner.ts:3-9` |
| 素材库/@引用 | `src/workbench/assets/AssetLibraryPanel.tsx`、`AssetMentionChip.tsx` |
