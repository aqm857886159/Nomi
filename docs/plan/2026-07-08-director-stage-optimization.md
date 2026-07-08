# 3D 导演台优化 plan（2026-07-08）

> 依据：`docs/research/2026-07-08-3d-director-stage-competitive-analysis.md`（竞品+前沿全查）。
> **决策门：A vs B 主押方向需用户拍板（产品方向岔路）。本 plan 记录分析 + 推荐 + 切片，实现前等 sign-off。**

## 背景（一句话）

「3D 站位导演台」已被 LibTV / TapNow 两个大厂做成赛道标配（素模+机位+截图，UX 更 polish）。它们**只做静帧站位，不出运镜视频**。Nomi 独有的是「动态 previz」（运镜出视频→video_ref + 走位/录 take/pose-over-time）。轻路径领跑者（Higgsfield/可灵）用参数化/单图推深度覆盖了「不搭 3D 也想精确运镜」的大多数镜头——这块 Nomi 缺。

## 取舍（核心决策，给用户）

| | A｜追站位 polish | B｜押动态 previz + 轻运镜入口（推荐） |
|---|---|---|
| 做什么 | 补上传 GLB / 普通图自动转全景 / 多机位一键批量分镜 | ①参数化运镜轻入口(学 Higgsfield) ②参考视频→运镜迁移 ③动态 previz 稳固+发现性 |
| 护城河 | ≈0，两大厂随时跟平 | 对手结构上抄不动（LibTV/TapNow 没动态 previz；Higgsfield/可灵没节点画布+精确 3D） |
| 用户摩擦 | 便利性提升，非解锁 | effect-first：不搭 3D 也能精确运镜（覆盖 90% 镜头）+ 独有能力做顺 |
| solo 适配 | 差（商品化拼迭代必输） | 好（押结构性差异，`nomi-solo-founder-strategy`） |

**推荐：主押 B，A 只做最小止血（多机位一键批量分镜，因它是 Nomi 已有多机位能力的小组合、直接提分镜效率）。**

## 范围（推荐路径，主押 B）

### ~~P0（与方向无关，先修）— `frameloop` 漏配~~ → 复查已修，撤销
- 2026-07-08 实查 `Scene3DFullscreen.tsx:630`：主编辑器 Canvas 已是 `frameloop={播放/录制/时间轴开 ? 'always' : 'demand'}`，静止即 demand，**不烧 GPU**。`docs/audit/perf/04-scene3d.md:671` 的 P0 是写在修复前的旧账（stale），无需再动。
- 教训：召回的审计反映的是写它当时的状态，用前先核实（D3）。
- **注意巨壳**：`Scene3DFullscreen.tsx` 已 792 行，逼近 R9 800 红线——后续任何改动只加/改必要行，不得涨破线；必要时抽出。

### B1｜参数化运镜轻入口（学 Higgsfield，最高杠杆）
- **痛点**：现在「精确运镜」只能走 AI 工具 `create_camera_move` 或手搭 3D 场景+轨迹。想「dolly-in 慢一点 + 长焦」的用户被迫进重流程。
- **做法**：在**视频/镜头节点**上加一个「运镜」可视化面板：运镜类型（复用已有 10 精确档 push/pull/orbit/crane/track/arc）+ 速度（slow/med/fast→时长）+ 景别 + 焦段/FOV + **可叠层**（如慢推+微摇）。产出仍走 `cameraMoveBuilder` → 灰模离屏 → `video_ref`（不新增底层，主要是 UI + 把 spec 做成控件 + 复用 `CameraMoveCaptureHost`）。
- **P4/一套核多出口**：AI 工具 `create_camera_move` 与手动面板共用同一 `cameraMoveBuilder` spec（单一真相源），不写两套。
- **UI 前必须**：读 `docs/design/nomi-design-system.md` + 看现有镜头节点真实外壳（`BaseGenerationNode` / `ShotPreviewOverlays`）+ 出可交互样张 + 用户拍板（R8，栽过 3× 脑补样张）。

### B2｜参考视频→运镜迁移（video_ref 来源放开）
- **痛点**：`attachCameraMoveToTarget` 已把「灰模片→video_ref+『跟随运镜』prompt」这桥做好了，但来源**固定是灰模片**。而 ReCamMaster/CamCloneMaster/可灵 MC 证明「任意参考片→迁移运镜」是 SOTA。
- **做法**：让用户把**任意参考视频**接到镜头 `video_ref` 槽（复用现有桥 + prompt 地板），灰模只是产 video_ref 的其中一条管道，不再是唯一。低成本、高杠杆。
- 复用记忆 `reference-must-not-wrap-paid-submit` / `video-timeout-recoverable-state` 的既有纪律。

### B3｜动态 previz 稳固 + 发现性
- **痛点**：记忆 `image-storyboard-mode-shipped` / `game-style-3d-character-control` 标「转视频真机点击未验（生成慢）靠单测」；护城河能力若不稳/不易发现=白搭。
- **做法**：运镜出视频 / 录 take 真机点击链路 R13 走查（NOMI_E2E=1，避 COOP/COEP 坑）；生成慢的进度反馈；入口发现性梳理。**评测额度默认授权，直接花。**

### A 最小止血｜多机位一键批量分镜
- Nomi 已有 `cameras: Scene3DCamera[]` 数组 + 新增机位。补一个「一次截取全部机位 → 批量出 N 张分镜参考图发到画布」工作流（对标 TapNow「全景/特写/过肩三张同时截」）。复用 `StagingCaptureHost` 逐机位捕获。
- 上传 GLB / 普通图自动转全景 → **延后**（便利性非解锁；Nomi 已有 2:1 全景导入）。

### 延后/观察（不做）
- **懒人模式 GEN3C/CamTrol**（给张图自动建 3D cache 做运镜）：盯开源成熟度，现在不接。
- **世界模型（Genie 3/Decart）**：2-3 年可能吃掉「搭 3D 中间层」的结构性威胁，持续观察，现在不改路线。

## 不动项
- 不删/不改现有 3D 编辑器主体（站位/轨迹/角色操控底层）；B1/B2 是**加轻入口**，非重写。
- 不打站位 polish 军备赛（不追上传 GLB/自动全景等商品化便利）。
- 不引入游戏引擎级物理/绑骨/唇形（既定缺口，诚实标）。

## 回滚
- 各切片独立、可单独 revert（B1 面板、B2 来源放开、B3 走查、A 批量分镜、P0 frameloop 互不依赖）。
- B1/B2 共用 `cameraMoveBuilder` 单一真相源，不产生并行版。

## 验收门
- **P0**：编辑器静止时 GPU 掉到 ~0（真机 / longTask 观测，非只 fps）；交互/播放正常刷新。
- **B1**：手动面板与 AI `create_camera_move` 产出同一 spec；样张与实现逐项对账（R8）；真机出一段运镜 video_ref 走查（R13）。
- **B2**：任意参考片接 video_ref 真机生成一次，运镜被跟随（真像素判断，非断言）。
- **B3**：转视频/录 take 真机点击端到端跑通、有进度反馈、零 console error。
- **五门**：filesize（Scene3DFullscreen 不破 800）→ tokens → lint → typecheck → test → build 全过（R11）。

## 待用户拍板
1. **主押 A 还是 B？**（推荐 B）
2. B 里先做哪个切片？（推荐 P0 先修 → B1 参数化运镜轻入口 → B2 参考视频迁移 → B3 稳固 → A 批量分镜）
