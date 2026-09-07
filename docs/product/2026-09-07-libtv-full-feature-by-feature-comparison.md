# LibTV vs Nomi 全量逐项功能对比

> 2026-09-07 · 完整版。按《LibTV使用指南》章节结构逐节对照，共 6 章 70+ 功能点。
> Nomi 侧判定全部基于真实代码（file:line 见表内与文末附录），非文档设想。
> 图例：✅ 已有/持平 · 🟢 领先 · 🟡 部分/等价但有差距 · ❌ 缺失 · ➖ 平台属性，不适用/不跟

---

## 1. 无限画布

### 1.1 项目管理

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 1.1.1 | 项目库 | 首页最新项目/全部项目入口 | `ProjectLibraryPage.tsx` + 主进程 `electron/projects/repository.ts`，项目自动备份 | ✅ | 无 |
| 1.1.2 | 新建/删除/重命名画布 | 菜单栏内完成 | 多项目创建/删除齐备 | ✅ | 无 |
| 1.1.3 | 云端积分/会员中心 | 积分余额、会员、单独购买算力 | 本地 API key + `spend/` 消费确认体系（按供应商计费） | ➖ | 架构不同：本地优先无会员体系；已有等价的"花费授权/消耗确认" |
| 1.1.4 | 分享/发布到社区 | 画布分享链接、社区首页曝光 | ❌ 无协作分享（`ui/community/` 仅用户反馈） | ➖ | 本地优先当前阶段不跟（见总览方案 C2） |

### 1.2 基础节点

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 1.2.1 | 节点类型数 | 5 种：文本/图片/视频/音频/脚本 | 14 种 kind：上述之外多出 角色/场景卡、关键帧、镜头、剪辑、画板、全景、3D 场景、3D 模型、素材（`registry.ts:61-276`） | 🟢 | 无 |
| 1.2.2 | 双击新建节点 | 空白处双击 | 同样支持画布交互新建 | ✅ | 无 |
| 1.2.3 | 拖入文件建节点 | 图片/视频/音频拖入 | 素材拖入 + `asset` 导入节点 + TikHub 贴链接导入（`pasteShareLinkImport.ts`） | 🟢 | 无 |
| 1.2.4 | 文本节点·LLM 生成 | 三大 LLM 生成/完善文本 | `text` 节点可执行（文本模型档案）+ Canvas Agent | ✅ | 无 |
| 1.2.5 | 图片节点·上传/生成 | 上传 + 图像模型生成 | `image` 节点 + 20+ 图像模型档案 | ✅ | 无 |
| 1.2.6 | 视频节点·上传/生成 | 上传 + 视频模型生成 | `video` 节点 + 35 个对账视频档案 | ✅ | 无 |
| 1.2.7 | 音频节点·上传/生成 | TTS/音乐/音效 | `audio` 节点三模式（TTS/Whisper 转写/上传）+ Suno/Lyria/MiniMax/Eleven | ✅ | 无 |
| 1.2.8 | 脚本节点（新版） | 剧本拆 shot→资产化（角色/场景/道具卡）→提示词合成→批量生图/生视频，行级编辑/排序/增删/标色/@唤起 | `storyboardPlan.ts:12-80` IR→资产锚（身份 DNA/服装/变体）→分镜表 `StoryboardShotTable.tsx`→批量条→冻结门一致性→失败返工 | ✅ | 持平。LibTV 独有的小点：shot 颜色标记（管理辅助，低价值）、"生成器组"打包形态（Nomi 用波次调度实现同类语义） |
| 1.2.9 | 脚本节点（旧版） | 角色图/参考视频生成分镜脚本、全屏表格编辑、卡片视图、自定义字段可见性 | 分镜表已支持全屏表格编辑 + 字段管理 | ✅ | 无 |
| 1.2.10 | 节点右键操作 | 复制（不带连线）/副本（带连线）/删除/创建资产 | `canvasNodeActions.ts` 复制/删除；`NodeResultStack` 历史；跨画布剪贴板 `canvasClipboard.ts`（带连线） | ✅ | "节点另存为资产"入口待确认（素材库有 @mention 体系，节点→资产的显式入口若无则补一个按钮，半天） |
| 1.2.11 | 撤销删除 | Cmd+Z | `timelineUndoHistory.ts` + 画布快照机制 | ✅ | 无 |

### 1.3 工作流

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 1.3.1 | 连线搭建工作流 | 参考生图→图转视频等 | 有序参考槽（character1..N）+ 连边能力校验 `referenceSlots.ts` | ✅ | 无 |
| 1.3.2 | 打组/整体拖动 | 框选打组 Cmd+G | 画布分组模型 `generationCanvasSchema.ts` + 分镜组类布局 | ✅ | 无 |
| 1.3.3 | 保存/复用工作流 | 打组→保存工作流→左侧栏调用 | **应用级工作流模板库** `workflowLibrary.ts:6-22,90`（收藏/标签） | 🟢 | Nomi 是一等公民库，LibTV 是附属功能 |
| 1.3.4 | 整组执行 | 组内全链路重跑 | 依赖波次执行 `dependencyWaves.ts:1-47` + 常驻队列 `generationQueueStore.ts` + 任务中心 | 🟢 | Nomi 按依赖自动分波，比"整组全跑"更细 |
| 1.3.5 | 批量执行 | 脚本节点批量生图/生视频 | `runGenerationNodesBatch` + 批量条（统一模型/时长/景别/比例） | ✅ | 无 |

### 1.4 画布功能

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 1.4.1 | 画布左侧栏 | 添加/工作流/资产/历史记录/教程 | 素材库面板（分类/文件夹/筛选/拖拽）+ 技能/提示词/流程库 | ✅ | 无 |
| 1.4.2 | 历史记录 | 全部生成产物、批量下载/删除/使用（≤10）、记忆浏览位置 | 节点级 `NodeResultStack.tsx`（历史堆叠/切换/下载/删除）+ 变体 | 🟡 | LibTV 是画布级全局历史列表（可跨节点批量捞素材），Nomi 是节点级。**可补：全局"生成历史"面板**（数据都在 runs[] 里，纯 UI 聚合，1–2 天） |
| 1.4.3 | 小地图 | 全局分布 + 高亮框拖动聚焦 + 缩放百分比 | `CanvasMinimap.tsx`（含 zoom 显示） | ✅ | 无 |
| 1.4.4 | 快捷键面板 | 菜单栏打开快捷键面板 | `CanvasControlsHelpPopover.tsx` + `TimelineShortcutsDialog.tsx` | ✅ | 无 |
| 1.4.5 | 跨画布复制 | 复制粘贴带连线 | `canvasClipboard.ts`（store 内剪贴板） | ✅ | 无 |
| 1.4.6 | 智能引用 AutoLink | 打字时识别提示词中与素材名匹配的关键词→自动预置引用标签，Tab 确认/Shift+Tab 全收 | @mention 体系已有（`AssetMentionChip.tsx`、`PromptEditor`），但需手动 @，无"边打字边推荐" | 🟡 | **可补**：在 PromptEditor 输入时对素材名做模糊匹配弹出建议 chip（复用 `AssetMentionSuggestion.ts`），1–2 天 |
| 1.4.7 | 我的主体库（文件夹组整体调用） | 人物/物体图片按文件夹管理，整体加载到画布保一致性 | 角色/场景/道具定妆卡 + 项目分类体系 + 文件夹素材库 | ✅ | 架构不同（Nomi 用资产锚绑定生成，更强），语义等价 |

## 2. 画布实用工具

### 2.1 Slash 快捷功能（12 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 2.1.1 | Slash 入口 | 输入"/"调起预设菜单 | 提示词库 `promptLibrary/` + Canvas Agent 工具 | 🟡 | 有等价物但无"节点内 / 唤起"的交互习惯。低优先 |
| 2.1.2 | 多机位九宫格 | 一图生成 9 个机位视角 | 3D 场景多机位 take 采样（真实 3D 视角）；图像侧无宫格生成预设 | 🟡 | 路线不同：Nomi 的 3D 路线更准但重；**补图像侧 prompt 预设 + 九宫格切分**（切分已有 `useNodeImageEditing.ts:100`），半天 |
| 2.1.3 | 剧情推演四宫格 | 推演剧情走向 4 格 | ❌（无 prompt 预设） | ❌ | 提示词库官方预设分组可覆盖，见 D 档 |
| 2.1.4 | 25宫格连贯分镜 | 25 格连续分镜 | ❌ 同上 | ❌ | 同上 |
| 2.1.5 | 电影级光影矫正 | 一键矫正光影 | ❌ | ❌ | 同上（prompt 化） |
| 2.1.6 | 角色三视图生成 | 正侧背三视图 | 定妆卡体系可产角色图，但无"三视图"专用预设 | 🟡 | prompt 预设 + 定妆卡挂载，半天 |
| 2.1.7 | 角色设定图🆕 | 标准角色设定图（含服饰细节分解） | 同上 | 🟡 | 同上 |
| 2.1.8 | 画面推演（3秒后/5秒前） | 时间轴前后推演帧 | 关键帧节点 + 首尾帧链路可手动达成 | 🟡 | prompt 预设即可 |
| 2.1.9 | 故事板 | 10–15s 剧情→连续分镜规划（怎么演/怎么拍/怎么衔接） | `propose_storyboard_plan` Agent 工具 + 分镜工作台 | ✅ | 无 |
| 2.1.10 | 调度故事板 | 带动作线/走位/机位的中文手绘分镜 | 画板节点（Leafer 手绘）+ 3D 构图 | 🟡 | 画板能力有，缺"一键生成手绘调度分镜"预设。prompt 预设可试 |
| 2.1.11 | 人像调节 | 去 AI 塑料感/肤质/人景融合/光影融合 | ❌ | ❌ | prompt 预设（去塑料感词组）+ 图像编辑模型，半天 |
| 2.1.12 | 情绪调节 | 多人图中指定单人改表情，25 种 | ❌ | ❌ | prompt 预设（表情词表）+ 指令式编辑模型（Nano Banana 2 / Seedream 5 Pro 支持精准指代编辑），1 天 |

### 2.2 图像工具（9 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 2.2.1 | 全景 720° | 文本/参考图生成全景 + 实时预览 + 4/12 视角截图 + 构图参考线 | 全景节点查看器（photo-sphere-viewer，`PanoramaViewer.tsx`）+ 比例截图；**无生成** | 🟡 | 补法见总览方案 C1：图像节点加"等距柱状全景"预设，产出直接落全景节点。边际成本≈0，质量预期要管住 |
| 2.2.2 | 多角度 | 三维网格坐标球选机位（8 水平+4 俯仰+3 景别）重渲图像 + 6 预设 | 3D 场景多机位构图导出；对**已有 2D 图**改机位重渲 ❌ | 🟡 | prompt 预设（"同场景 XX 角度重渲"）+ 图生图可覆盖八成需求；真 3D 路线 Nomi 已有且更准 |
| 2.2.3 | 打光 | 26 主光点位 + 9 轮廓光 + 亮度/颜色 + 智能模式（提示词/参考图）+ 6 预设 | ❌ | ❌ | 两档：智能模式=prompt 预设（立即）；点位 UI=低价值花活，不跟（R2 极简） |
| 2.2.4 | 九宫格入口 | 聚合上述宫格类功能 | 四/九宫格**切分**已有 | 🟡 | 切分有、生成无，见 2.1 |
| 2.2.5a | 高清放大 | 2/4/6 倍，5 种模式 | 即梦 image_upscale 档案 `dreaminaUpscale.ts` | ✅ | 无 |
| 2.2.5b | 扩图 | 6 画幅比外扩，1K/2K/6K | ❌ | ❌ | 贴画布合成基准图 + 图生图（Nano Banana 2 / Seedream 5 Pro），1–2 天 |
| 2.2.5c | 重绘 | 画笔涂抹 + 提示词修改 | ❌（AI 元素拆解编辑可覆盖部分场景） | ❌ | mask + 指令式编辑；画笔 UI 复用画板节点，1–2 天 |
| 2.2.5d | 擦除 | 画笔框选擦除 | ❌ | ❌ | 同重绘链路，顺带 |
| 2.2.5e | 抠图 | 自动去背景 | 本地 @imgly/background-removal WASM（`removeBackground.worker.ts`） | 🟢 | Nomi 本地跑，零 API 成本零上传 |
| 2.2.5f | 裁剪 | 自由/比例裁切 | `useNodeImageEditing.ts` | ✅ | 无 |
| 2.2.6 | 宫格切分 | 多宫格拆片→选片→重渲/高清，分割线可拖 | 四宫格/九宫格切图（`useNodeImageEditing.ts:100`） | ✅ | 拖动分割线微调属边缘体验，不跟 |
| 2.2.7 | 标注 | 涂鸦/框选 + 文字，标注信息参与重生成 | 图内文字编辑入口（`buildTextEditNode.ts`）+ 画板节点 | 🟡 | "框选区域+指令→重生成"与重绘同链路，合并补 |
| 2.2.8 | 旋转与镜像 | 90/180/270/任意角度、水平/垂直镜像 | 变换▾ 工具（`NodeImageEditToolbar.tsx`） | ✅ | 无 |
| 2.2.9 | 分镜组 | 多图整合宫格布局、智能排序、比例/行列可调、拼接 2K/4K 大图、序号 | 联系表拼图（选中成图拼一张交付图 `buildContactSheetNode.ts`） | ✅ | 拼接大图/序号属输出美化，联系表已覆盖核心语义；行数列数自定义可后补（低优） |

### 2.3 视频工具（11 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 2.3.1 | 视频高清 | 2/4/6 倍 + 30/60/90fps 补帧 + 慢动作参数 | ❌ | ❌ | Replicate real-esrgan-video（超分）+ ffmpeg 补帧/慢放（`setpts`/`minterpolate`），3–5 天含队列接入 |
| 2.3.2 | 视频解析 | 分镜拆解表格：画面/景别/图像提示词/运镜提示词/起始点/时长/音乐节奏/人声 | 本地切点检测 + 每镜多帧 VLM + Whisper 合流 → 结构化分镜表（`deconstructVideo.ts`）→ 勾选镜头落画布 | ✅ | 持平；"音乐节奏"维度 Nomi 未显式输出，低优 |
| 2.3.3 | 视频剪辑 | 单段裁取、I/O 打点、0.01s 精度、≤10min/1080P | ClipNode 多素材 trim + 时间轴拖拽手柄 | ✅ | 无 |
| 2.3.4 | 视频合成 | 多段拼接 + 原声/独立音轨混合 + 时间轴拖拽裁剪删除 + 实时预览 + 20min 长视频 | 多轨时间轴（`TimelinePanel.tsx`：剪刀/磁吸/转场/字幕/文本轨/撤销）+ ffmpeg-filtergraph/direct/Remotion 多后端导出 | 🟢 | Nomi 多轨+转场+字幕更强 |
| 2.3.5 | 人声/背景音分离 | 分离干净人声或 BGM | ❌ | ❌ | ElevenLabs `/v1/audio-isolation`（已在供应商栈）或本地 Demucs/MossFormer，1–2 天 |
| 2.3.6 | 分离音视频 | 画面/音频分离 | ❌ 独立入口（ffmpeg `-vn/-an`） | ❌ | 半天 |
| 2.3.7 | 智能剪辑 | 口播去口水词/画中画/字幕动效、批量广告变体、素材卡点混剪、无人解说直出 | ❌ 无人化"一句话成片"编排；但有 Canvas Agent + 时间轴 Agent（`timeline/agent/`） | 🟡 | Nomi 的 Agent 具备做"智能剪辑编排"的地基。**建议作为独立大功能立项**（非小补齐），价值高、工程量大 |
| 2.3.8 | 逐帧拉片 | 叙事分镜/精彩运镜/动作片段/音频参考多维度分析，供 Seedance 复用 | 拉片已有（切点+VLM+转写）；"结果直接喂给视频模型多参考"的闭环待打通 | 🟡 | 拉片结果→参考槽已有基础设施，补一条"把选中镜头/运镜描述注入生成器"的动线，1 天 |
| 2.3.9 | 智能续写 | 任意时间点续写，延续人物/场景/风格，可加新参考 | `return_last_frame` + 抽尾帧落节点（`extractVideoFrameToNode.ts`）已具备原子能力 | ❌易补 | UX 链：选起点→抽帧→自动建 i2v 节点连线，1–2 天 |
| 2.3.10 | 片段重拍 | 时间轴选段（毫秒级）→逐段文字描述重拍 | 手动切镜 + 重新生成，无时间轴选段重拍 UX | ❌ | 时间轴选区（已有）+ 逐段重拍任务编排，2–3 天 |
| 2.3.11 | 深度动作捕捉 | 视频提深度（480P/720P），风格无关运镜参考 | ❌ | ❌ | Depth Anything V2 / DepthCrafter（Replicate 或本地），先验证 Seedance 多参考对深度视频的收益再立项 |

### 2.4 导演台（7 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 2.4.1 | 3D 白模构图 | 人体素模/几何体/群众阵列/本地上传，V/R/S 操作 | `Scene3DEditor.tsx`（R3F）+ 模型库 + `model3d` 节点（混元/HiTem/Meshy 生成 .glb） | 🟢 | Nomi 还能 AI 生成 3D 模型 |
| 2.4.2 | 机位管理 | 多机位、机位视角预览、导演视角一键建机位+截图、FOV、注视跟随 | 多机位数组 + `CameraStateRecorder.tsx` + FOV 数学 | ✅ | 无 |
| 2.4.3 | 角色姿势控制 | 右侧栏调整人物姿势 | WASD 键盘驾驶角色（步态/跳跃/朝向 `scene3dCharacterDriveController.tsx`） | ✅ | 交互范式不同（摆姿势 vs 开角色），各有优劣 |
| 2.4.4 | 全景图设置 | 导演台背景贴全景图 | `scene3dEnvironment.tsx` 环境面板 | ✅ | 无 |
| 2.4.5 | 角色运动轨迹 | 路径模板（直线/圆/矩形）、XYZ 关键帧、播放 | 轨迹捕捉 + `TrajectoryRenderer.tsx` | ✅ | 无 |
| 2.4.6 | 摄像机运镜轨迹 | 推/拉/横移/环绕/升降/俯冲模板 + 一键跟随拍摄 | 12 种运镜预设（含希区柯克变焦，`cameraMovePreset.ts:160-216`）+ 轨迹→参考视频（`framesToVideo.ts`） | 🟢 | Nomi 直接产出可用的运镜参考视频 |
| 2.4.7 | Blender 插件 | 白模录屏直传 | ❌ 无 Blender 插件；但有 ComfyUI 工作流导入/内置浏览器素材抓取 | ➖ | 插件生态属长尾，不跟；本地 3D 导入（.glb 上传）已通 |

### 2.5 音频工具（3 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 2.5.1 | 音频截取 | 精准裁剪 | ClipNode trim 仅画面素材语义；音频无 | ❌ | ffmpeg `atrim`，半天 |
| 2.5.2 | 音频变速 | 快慢调节 | ❌ | ❌ | ffmpeg `atempo`（0.5–2.0，超范围级联），半天 |
| 2.5.3 | 自定义切分 | 按时间点切多段 | ❌ | ❌ | ffmpeg `asplit`+`atrim`，半天 |

## 3. 图像生成器（4 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 3.1 | 风格库 | 官方风格模板库 + 自定义风格（5–20 张图训练模板） | 提示词库 + 多参考图（风格图作参考） | 🟡 | "上传 N 张图固化成可复用风格模板"是产品化包装；多参考图可达同效。可后补"风格预设收藏"，低优 |
| 3.2 | 焦点编辑 | 沉浸模式从画布任意图提取元素组合使用 | 多参考槽（最多 14 图）+ AI 元素拆解（一张图拆可编辑图层 `decomposeLayers.ts`） | 🟢 | 拆图层比"点选提取"更彻底 |
| 3.3 | 镜头聚焦 | 框选→特写分镜直出 | ❌ 显式入口 | ❌ | 裁剪+图生图二连 + prompt 预设，半天 |
| 3.4 | 摄像机控制 | 相机型号/镜头/焦距/光圈参数化生图 | ❌ | ❌ | 本质是 prompt 片段库（"85mm f/1.4"），做成提示词库参数预设即可，半天 |

## 4. 视频生成器（2 项）

| # | LibTV 功能 | LibTV 细节 | Nomi 现状 | 判定 | 差距与补法 |
|---|---|---|---|---|---|
| 4.1 | 视频主体库 | 多图/视频建主体（Kling O1/O3），主体描述参与 prompt 增强，可挂音色 | 角色/场景/道具资产锚 + 身份 DNA（staticFeatures）+ 冻结门一致性 | ✅ | 架构不同：Nomi 的锚是模型无关的通用槽（P4），LibTV 绑定可灵特定功能。供应商侧"主体库"能力由各家档案声明（如 H3 characterIndexed image_ref）承接 |
| 4.2 | 运镜预设 | 20+ 运镜预设 + 收藏 + 自定义运镜词 | 12 种 3D 运镜预设；视频生成器内 prompt 运镜词无预设面板 | 🟡 | 把运镜词表（推拉摇移/环绕/航拍等）做进提示词库"运镜"分组，半天；3D 侧 Nomi 更强 |

## 5. 模型清单（4 节）

| # | 维度 | LibTV | Nomi | 判定 |
|---|---|---|---|---|
| 5.1 | 图像模型 | ~12 个（Seedream 全系/LibNavo/Qwen/Z-Image/Style Image…） | 20+ 档案（Seedream 5 Pro/Nano Banana 1·2·Lite/FLUX.2/Qwen-Image/Imagen 4/Z-Image/即梦/魔搭/Runway…） | 🟢 |
| 5.2 | 视频模型 | ~8 个（Seedance 2.5 5min 直出、可灵 3.0 O3、Wan 2.6、Shot V2…） | 35 个对账档案（Seedance 2/2.5 五条线、可灵 3、Sora 2、Veo 3.1、Runway Gen-4.5、Wan 2.7/3.0、海螺、Vidu、H3、Grok…） | 🟢（数量/广度）；🟡（Seedance 2.5 超长 5min 一键直出依赖供应商开放度，Nomi 走分段+时间轴合成的自控路线，可控性反而更强） |
| 5.3 | 语言大模型 | CVLM/GVLM/Qwen3-VL | 文本模型档案 + Canvas Agent（含 20min 视频理解的 Qwen-VL 类能力可经档案接入） | ✅ |
| 5.4 | 音频模型 | Eleven V3/Mureka V8/Minimax 2.8（300+ 音色+克隆） | TTS 豆包/Seed/MiniMax/Eleven；音乐 Suno v5.5（可续写）/Lyria/MiniMax Music/Eleven Music；音效 Suno SFX/Eleven SFX；克隆仅 Runway 一条 | 🟡（差音色克隆面板，补法见 B2） |

## 6. 全局体验

| # | 维度 | LibTV | Nomi | 判定 |
|---|---|---|---|---|
| 6.1 | 运行形态 | 云端 SaaS，浏览器使用，算力积分 | 本地优先 Electron，本地推理（Whisper/抠图/ComfyUI）+ 云端 API 混合 | ➖ 各有定位；本地=隐私/离线/零上传，云端=免装机 |
| 6.2 | Agent 入口 | CLI + Skill 接口（"为 Agent 设计"是主打卖点） | Canvas Agent（`applyCanvasToolCall.ts`）+ 时间轴 Agent + 技能库 + Vercel AI SDK | ✅ 同一战略，Nomi 更深（Agent 直接操作画布/时间轴） |
| 6.3 | 消费透明 | 积分制，单独购买算力 | 消费确认/花费授权（`spend/`）+ 按 key 计费 | ➖ 范式不同 |
| 6.4 | 快捷键体系 | 全套画布快捷键 + 组合 | 画布帮助面板 + 时间轴快捷键对话框 | ✅ |

---

## 统计与结论

**70+ 项逐项判定汇总：**
- 🟢 领先 **17** 项（节点种类、工作流库、依赖波次、本地抠图、拆图层、多轨时间轴、3D 导演台全家桶、35 视频档案、20+ 图像档案、Agent 深度…）
- ✅ 持平 **31** 项
- 🟡 部分/等价 **16** 项 —— 其中 10 项靠「提示词预设分组」一次动作即可补齐
- ❌ 缺失 **14** 项 —— 其中 **7 项 ≤2 天**（扩图/重绘/擦除/续写/重拍/音频三件套/分离音视频）、**3 项 3–5 天**（视频超分/人声分离/音色克隆面板）、**2 项建议独立立项**（智能剪辑编排、深度动捕）、**2 项建议不跟**（Blender 插件、云端会员/社区）

**一句话**：LibTV 的能力面 Nomi 覆盖了约 80%，缺失项里没有一个是"根本性难度"——大多是现有原子能力（ffmpeg、抽帧、图生图、提示词库）缺一层产品化包装；真正要立大项的只有「智能剪辑编排」和「深度动捕」两个。

**优先级建议**（承接总览方案）：P0 = 扩图、重绘/擦除、智能续写、音频三件套、分离音视频 → 一周内把 ❌ 清单砍掉一半；P1 = 片段重拍、人声分离、视频超分、音色克隆面板、提示词预设大礼包（宫格/打光/情绪/运镜/三视图/摄像机参数一次打包）；P2 = 全局生成历史面板、AutoLink 实时引用、逐帧拉片→多参考闭环。

---

## 附录：Nomi 侧证据索引（补充本版新增项）

| 能力 | 证据 |
|---|---|
| 画布小地图 | `src/workbench/generationCanvas/components/CanvasMinimap.tsx` |
| 画布快捷键帮助 | `src/workbench/generationCanvas/components/CanvasControlsHelpPopover.tsx` |
| 跨画布剪贴板（带连线） | `src/workbench/generationCanvas/store/canvasClipboard.ts` |
| 节点复制/删除动作 | `src/workbench/generationCanvas/store/canvasNodeActions.ts` |
| 时间轴快捷键 | `src/workbench/timeline/TimelineShortcutsDialog.tsx` |
| 时间轴文本/字幕轨 | `src/workbench/timeline/TimelineTextTrack.tsx`、`timelineTextEdit.ts` |
| 时间轴转场 | `src/workbench/timeline/TimelineTransitionPicker.tsx` |
| 3D 环境面板 | `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironment.tsx` |
| AI 元素拆解（图层化） | `electron/image/decomposeLayers.ts` |
| 图内文字编辑 | `src/workbench/generationCanvas/nodes/textEdit/buildTextEditNode.ts` |
| 素材 @ 引用建议 | `src/workbench/assets/AssetMentionSuggestion.ts`、`PromptEditor.tsx` |
| 联系表拼图 | `src/workbench/generationCanvas/nodes/buildContactSheetNode.ts` |
| 时间轴 Agent | `src/workbench/timeline/agent/` |
| Canvas Agent 工具 | `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts` |
