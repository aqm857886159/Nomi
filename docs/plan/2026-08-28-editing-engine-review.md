# Nomi 剪辑引擎 build-vs-buy 评审

> 状态：🚧 进行中

- 日期：2026-08-28
- 评审基线：`origin/main` @ `25f7401db530380475e3cd5c593e5329422fc05e`
- 评审范围：Nomi 当前剪辑实现、在飞 PR #179/#207，以及 OpenChatCut、OpenCut（rewrite/classic）、MLT、libopenshot、FFmpeg、GStreamer/GES、Remotion、OpenTimelineIO；补充核对 OpenMontage 与 video-use 的 Agent 编辑协议。
- 调研方式：GitHub CLI API/源码读取；外部仓库按默认分支和 2026-08-28 可见的最新提交核对。没有把 README 的路线图当成已交付能力。

## 结论先行

不要把某个开源项目整体替换进 Nomi。行业里没有一个“所有产品都在用”的单一剪辑内核：专业 NLE 多为自研；Kdenlive/Shotcut 使用 MLT；OpenShot 使用 libopenshot；Web/Agent 产品通常是自有时间轴 + WebCodecs/Canvas/WASM + FFmpeg/Remotion 的组合。

推荐采用四层组合：

```text
Nomi TimelineState + EditPlan + Adoption/Undo（唯一事实源）
        |
        +-- Agent/MCP：read -> propose -> review -> apply
        |
        +-- FFmpeg native worker：解码、滤镜、音频混合、最终导出（现有底座）
        |
        +-- 可选 MLT worker：在 POC 通过后承载复杂多轨/转场/实时预览
        |
        +-- OpenTimelineIO/FCPXML：交换与专业 NLE 导出，不承担渲染
```

这条路线能快速提升能力，又不会给 Pi Agent、MCPSQ 或现有画布/采纳链增加第二套真相源。MLT 是唯一值得优先做原生 NLE POC 的候选；libopenshot 作为备选；OpenCut/OpenChatCut 主要提供能力清单和 Agent 协议参考，不能当作可直接嵌入的内核。

当前安全实现也已收敛到同一边界：Agent 与 Adoption 共用 kernel 的 canonical `timelineRevision`；时间轴工具只返回稳定素材 ID 和 `sourceAvailable`，不把本地 URL 送入模型；应用计划使用进程内 `planId + signature` 重放保护；Undo 必须携带应用返回的 `undoToken + expectedRevision`，时间轴被用户或其他 Agent 修改后会拒绝撤销。上述保护不改变 Pi Agent、MCPSQ、React Flow 或 Electron bridge 的所有权。

## Nomi 现状（代码事实）

| 能力 | 当前事实 | 影响 |
|---|---|---|
| 时间轴模型 | `TimelineState` 固定 image/video/audio 三轨，文字在独立 `textClips[]`，转场只有 metadata（`src/workbench/timeline/timelineTypes.ts:3-5,23-46,48-78`）。 | 不能直接表达任意 overlay/text/effect 轨、每 clip 音量、变速或关键帧。 |
| 基础编辑 | 纯函数已有 add/move/remove/split/trim/framing；同轨防重叠、移动不自动推动后续片段（`src/workbench/timeline/timelineEdit.ts:69-109,141-176,179-202,403-490`）。 | 可作为 EditPlan 的安全内核；不能把当前 trim 宣称成 ripple/roll。 |
| 原子应用 | Adoption 先构造完整新轴，校验失败不落地；成功只压一层 Undo，并有 compensation（`src/workbench/adoption/adoptionApply.ts:5-13,48-106,109-161`）。 | 这是 Agent 接线必须复用的边界，外部引擎不能直接写 store。 |
| Agent 工具 | capability 映射目前只有文稿、画布和 storyboard；`arrange_storyboard_to_timeline` 是唯一时间轴相关工具（`electron/harness/agentChatPolicy.ts:35-43`、`electron/harness/tools/canvasDescriptors.ts:364-369`）。 | PR #207 的 timeline-planner/editor 尚未进入基线。 |
| 导出底座 | FFmpeg filtergraph 已有 source window、取景、文字最后叠加和音频 `atrim -> adelay -> amix`（`electron/export/ffmpegFiltergraph.ts:167-253,256-368,371-415`）；导出任务在检测到音频时选择 AAC/mixdown（`electron/export/exportJobs.ts:142-170`）。 | FFmpeg 应继续作为交付底座，但需要真实 MP4/音频/转场 parity 验收。 |
| 转场 | 类型接受 cut/dissolve/fade/match_cut/whip_pan，但 filtergraph 没有 `xfade`/`acrossfade`（`src/workbench/timeline/timelineTypes.ts:7-21`；`electron/export/ffmpegFiltergraph.ts`）。 | 目前写入 dissolve 不等于画面真的 dissolve。 |
| 渲染 manifest | manifest 仍把 audio/text/overlay/effect/keyframe 视为未完整建模（`src/workbench/export/renderManifest.ts:23-27,150-195`）。 | 不能先换 renderer 掩盖领域模型缺口。 |
| 产品许可证 | Nomi 是 `AGPL-3.0-only`，Node >=22.19（`package.json:4-10`）。 | AGPL 依赖可在同许可证策略下评估，但所有第三方许可证和动态/静态链接方式仍要进入发行审计。 |

## 在飞 PR 评审

### PR #179：P5 E2 结构化粗剪

PR 分支 `claude/stage-p5-e2` 的文档 `docs/plan/2026-08-26-p5-e2-structured-rough-cut.md` 做了当前时间轴事实盘点，并定义 8 个 EditPlan 操作：`arrangeStoryboard`、`placeAsset`、`trimClip`、`splitClip`、`setClipFraming`、`materializeCaptions`、`placeMusicBed`、`declareTransition`。其关键判断是：ripple/roll 不存在；转场仅 metadata；音频导出要实测；所有计划必须复用 Adoption/Proposal key/一次 Undo。

这份 PR 是正确的领域边界，但它不是现成剪辑引擎，也没有解决任意轨道、变速、效果、混音、视觉转场等能力。它应作为 Nomi 的 canonical contract，而不是被外部库的类型替换。

### PR #207：E2 Agent 接线与外部对标

PR 分支 `feat/auto-edit-plan` 的 `docs/plan/2026-08-27-auto-edit-architecture.md` 补齐了 #179 没覆盖的接线：按 capability 而不是 skillKey 选工具；建议新增 `timeline-planner`（只读/产提案）与 `timeline-editor`（一次性 apply）；工具执行在 renderer，主进程只做解析/作用域；MCP 入口进顶层 catalog；目标需要冻结并用 revision 复验。

PR 还发现 `propose_storyboard_plan` 的 schema 没声明 `subtitle/dialogue/transition`，导致 Agent 路径不能触发下游字幕/转场派生。该 PR 是方案，尚未在基线中提供 timeline capability 或完整工具执行器。任何实现都必须沿用这两个 PR 的 EditPlan、Adoption、revision 和一层 Undo，不能把 OpenCut store 直接接到 Agent。

## 外部项目对比（GitHub CLI 核验）

核验日期 2026-08-28；星标只表示关注度，不表示可嵌入性。

| 项目（默认分支/许可证） | 实际提供的层 | Electron + TypeScript 适配 | 主要风险 | 决策 |
|---|---|---|---|---|
| **OpenChatCut**（AGPL-3.0，约 1.4k stars，`2a6e882`） | Agent-native 多轨编辑器；`assets/agent/openchatcut-tool-schemas.json` 有 120 个 edit 工具（读取时间轴、转录、移动/删/分割/变速、字幕、音频、效果、beat、场景检测、预览/导出等）；依赖 Remotion 4、FFmpeg、AI SDK 7、MCP。 | TypeScript/Electron 形态接近，工具描述和 `read -> propose -> apply` 最值得对齐。 | AGPL 与 Nomi 相容但仍需保留版权/源代码义务；其 store、项目 schema、导出服务器、Remotion 运行时与 Nomi 不同，整体复制会制造第二时间轴。 | **参考 Agent 工具目录和协议；不整体嵌入。** 可在同许可证审计后逐模块移植纯算法。 |
| **OpenCut rewrite**（MIT，约 87k stars，`400f097`） | README 明确“从零重写”；Rust workspace 只有 desktop timeline 占位组件，web editor 显示 Coming soon；MCP/headless/plugin 是路线图。 | 当前几乎没有可接的编辑内核。 | 高关注度掩盖未完成状态；接入会绑定未稳定 API。 | **拒绝作为当前内核。** |
| **OpenCut classic**（MIT，已归档，`cf5e79e`） | 完整 TS 时间轴：video/image/audio/text/graphic/effect 轨、多 overlay/audio、trim/source window、retime/pitch、effects/masks、keyframes、mute/visibility、command/batch、preview commit/discard；`apps/web/src/timeline/types.ts:29-80,82-125`，`update-pipeline.ts:35-187`，`core/managers/timeline-manager.ts`。 | TypeScript 可读性好，算法和命令设计可局部参考；`opencut-wasm` 可作为独立 compositor POC 候选。 | 项目已归档；scene/track/element/store/renderer 强耦合；MediaBunny/Web Audio 与 Nomi 资源/导出路径不同。 | **借能力矩阵、update pipeline、command/batch；不复制 store/UI。** WASM 仅在独立 POC 通过后使用。 |
| **MLT**（LGPL-2.1，约 1.8k stars，`a720333`） | 成熟原生多轨框架；`mlt_playlist.h:39-123` 支持顺序片段、blank、insert/remove/move/reorder/resize/split/mix；`mlt_multitrack.h:40-73` 支持并行轨；`mlt_transition.h:40-88` 支持双轨转场。支持 FFmpeg/多种模块。 | 通过独立 native worker/CLI 或 Node SWIG binding 接入；仓库有 `src/swig/nodejs/CMakeLists.txt:1-13`，但仍需自行构建/打包 ABI。 | C/C++、插件目录、平台编译和 LGPL/GPL 模块组合复杂；CMake 默认启用 GPL/GPL3 组件（`CMakeLists.txt:15-45`），错误构建会改变发行许可。 | **优先做 POC。** 只启用审计过的 LGPL 组件；worker 通过 JSON/OTIO-like manifest 通讯，Nomi 仍是事实源。 |
| **libopenshot**（LGPL-3.0-or-later，约 1.5k stars，`eac81cf`） | 完整 C++ Timeline/Clip/Frame：多层合成、音视频效果、Bezier 动画、变速/反向、音频混音/重采样、硬件加速、FFmpeg 格式；`src/Timeline.h:85-169,223-232`、`src/Clip.h:56-89,121-173`。 | 需要 C++ worker；官方提供 Python/Ruby/Java/Godot bindings，没有稳定 Node ABI。Electron IPC 可调用 worker，但不能直接 import C++ 对象。 | 依赖多、CMake/FFmpeg/OpenCV/音频驱动打包重；LGPL-3 动态链接和依赖许可证需审计；项目模型与 Nomi frame/asset ID 不同。 | **第二候选。** 若 MLT POC 无法满足效果/音频，再做 libopenshot POC；不直接迁移 Timeline。 |
| **FFmpeg**（主代码 LGPL-2.1+，可选 GPL，`0bffa4a`） | 编解码、`libavfilter` 滤镜图、音频混合/重采样、ffprobe；不是持久化时间轴或编辑器。README 与 `LICENSE.md` 明确可选 `--enable-gpl` 会改变二进制许可证。 | Nomi 已有 `@ffmpeg-installer`/`@ffprobe-installer` 与 filtergraph；Electron worker 适配成熟。 | GPL/nonfree 编译选项、硬件编解码、跨平台二进制和滤镜差异；filtergraph 复杂度会膨胀。 | **必选底座。** 继续扩展为可验证 render backend，不把它误称 NLE 内核。 |
| **GStreamer + GES**（LGPL，`fb38550`） | GStreamer 是媒体 pipeline；GES README 明确是“facilitating creation of audio/video non-linear editors”，`ges-timeline.h:15-114` 有 layer/track、commit、duration、auto transition、frame/time API。 | 可通过 native worker/CLI；GLib/GObject/插件生态使 Node 直连成本高。 | 运行时插件发现、平台依赖和 pipeline 调试复杂；不是现成 Agent/项目模型。 | **不做第一批。** 若未来需要实时采集/流式/复杂播放，再专门评估 GES。 |
| **Remotion**（source-available 商业许可，`e20b23d`） | React 代码即源真相；播放器、组合、字幕/转场、Node render API；OpenChatCut 用 `@remotion/*` 4.x。 | 与 React/Electron 亲和，适合模板/MG 和可编程 composition。 | 不是 OSI 开源；`LICENSE.md` 按公司规模要求 Company License，并禁止把 Remotion 衍生物作为产品转售/再许可。不能把 Nomi AGPL 当作自动取得商业权利。 | **仅用于隔离模板/MG 评估，先过法务和购买许可；不作为 Nomi 通用剪辑内核。** |
| **OpenTimelineIO**（Apache-2.0，`bc5fe2d`） | 成熟的交换格式/API；Timeline=Stack of Track，RationalTime、Clip、Transition、外部 media reference（`src/opentimelineio/timeline.h:15-91`、`track.h:13-80`、`transition.h:10-90`）。README 明确“不包含媒体容器/渲染”。 | Apache 许可证安全；可用 JSON/CLI/Python bridge 生成 OTIO/FCPXML，不必把 C++ core 放进 renderer。 | 不是播放器/渲染器；官方 Python binding 稳定，JS binding/Node 包不应假定存在。 | **采用语义和导出交换；不替代 TimelineState。** |
| **OpenMontage**（AGPL-3.0） | `edit_decisions.schema.json` 把 cuts、source in/out、speed、layer、transform、transition、audio、subtitles、renderer_family、render_runtime 作为 canonical artifact。 | 与 Nomi 许可证方向一致；schema 可作为 EditPlan/RenderManifest 评审样本。 | AGPL 代码和 Python pipeline 与 Nomi 不同；大 schema 直接塞进 Timeline 会污染领域边界。 | **借 artifact/checkpoint/验证思想，不复制 runtime。** |
| **video-use**（MIT） | 一个 Skill + FFmpeg/Python helpers；硬规则包括词边界、30–200ms padding、字幕最后叠加、逐段抽取/concat、切点自检最多 3 轮。 | 可把规则转成 Nomi E3 验收和 verify-render，不需引入 Python runtime。 | 主要是工作流，不是多轨编辑器；依赖外部转录与脚本目录。 | **借硬规则和自审环；不当内核。** |

## Build-vs-buy 分层决策

### 必须由 Nomi 自己拥有

- `TimelineState`、稳定 clip/track ID、source window、frame 语义和 `timelineRevision`。
- `EditPlan`、scope、proposal key、stale/idempotency、Adoption 原子 apply 与一层 Undo。
- Agent capability/权限/确认，以及内部 Agent 与 MCP 的 adapter；Agent 不直接调任何外部 store。
- 生成节点到时间轴的意图直通、字幕/转场 metadata 的来源绑定、项目资产路径与本地优先安全策略。

这些是 Nomi 的产品护城河，不是通用媒体库能替代的领域语义。

### 直接复用现成实现

- **FFmpeg**：probe、解码、滤镜、音频混合、编码、截图验证；先补 `xfade/acrossfade`、每 clip 音量/淡入淡出和 source window parity。
- **OTIO/FCPXML**：作为导入/导出交换，保留 Nomi 扩展 metadata；不要把 OTIO 当渲染器。
- **sherpa-onnx/同类本地 ASR（后续 E3）**：本地词级时间戳，独立于剪辑内核；先核对模型包体积和 Electron 原生 ABI。
- **video-use 的硬规则**：转成 Nomi verify-render 和 EditPlan validator，不复制 Python workflow。

### 先做 POC 再决定是否购买

- **MLT worker（首选）**：验证多轨/音频/转场/预览是否能以 Nomi manifest 驱动，并验证 LGPL-only 构建。
- **libopenshot worker（备选）**：当 MLT 无法覆盖关键帧/效果/音频要求时再做，预期打包成本更高。
- **OpenCut WASM compositor（可选）**：只测 GPU 视觉合成，不接管时间轴或导出事实。

### 明确不买

- KurrentDB/Temporal/LangGraph/Mastra 这类通用 runtime 不属于剪辑内核，会和现有本地 JSONL/ProductionRun 产生第二事实源。
- OpenCut rewrite 当前没有可用编辑器核心。
- Remotion 不作为默认渲染底座，除非公司许可证和分发方式已经书面确认。

## 推荐实施路线

### 阶段 P0：稳定 Nomi 领域合同（不引入新内核）

1. 将 #179 EditPlan 操作集落为纯函数 adapter，补 `remove/move/reorder/ripple` 的明确语义（没有实现的能力不出现在工具描述）。
2. 扩展 timeline schema：source in/out、retime、per-clip volume/fade、可选 overlay/text/effect 轨；保持旧项目 normalize 兼容。
3. 将 #207 的 `timeline-planner`/`timeline-editor` 接入 capability registry；执行统一走 Adoption，加入目标冻结、revision、reason 和一次 Undo。
4. 先修 FFmpeg parity：真实 MP4 含音频、字幕最后叠加、转场 `xfade/acrossfade`、预览/导出使用相同 source window。

### 阶段 P1：MLT worker POC（完全隔离）

新增独立的 `editing-backend-mlt` 实验包/worker（不进入 Pi/MCPSQ）：

```text
Nomi TimelineState -> RenderManifest/BackendPlan -> worker stdin(JSON)
worker -> MP4/preview frames + diagnostics(JSON)
```

worker 不写项目文件、不发 MCP、不持有 proposal/预算；每次调用带 backend version、manifest hash 和临时目录。先支持 video/image/audio、source window、overlay、mix、cut/dissolve；复杂效果在 manifest 中显式 `unsupported`，不可静默降级。

### 阶段 P2：决策闸

MLT POC 通过全部验收才允许将某些 export/preview 路由到它；否则继续 FFmpeg。无论结果如何，Nomi TimelineState 和 Agent 合同不变，因此可删除 worker 实验而不影响 Pi Agent/MCPSQ。

### 阶段 P3：能力跃升

按业务价值逐步启用：多 overlay/audio 轨、retime/pitch、ducking、关键帧、mask/effect、真实转场、词级字幕/静音编辑、beat/scene 辅助。每项能力先进入纯领域模型和 manifest，再进入 backend adapter，最后开放 Agent 工具。

## MLT POC 验收标准

### 正确性（硬门）

1. 固定 fixture：3 个 video、1 个 image、2 个 audio、1 个 caption，含 source trim、跨轨叠加、音量、fade 和一处 dissolve；FFmpeg 与 MLT 输出时长差不超过 1 帧，`ffprobe` 都检测到视频和 AAC 音频。
2. 在 0%、每个切点、最后 1 帧抽帧；关键像素/几何（contain/cover/offset）与 Nomi 预览参考一致。转场不能退化成硬切而不报告 `unsupported`。
3. Nomi -> backend -> diagnostics 的 clip/asset ID 全量可追踪；缺素材、越界 source window、未知 effect 必须拒绝且不产出“成功”文件。
4. `TimelineState` 不因 POC 发生写入；失败、取消、超时均留下可诊断错误，不改 Undo/redo 或 Proposal 状态。

### 集成与性能（硬门/目标）

1. Windows x64 与 macOS arm64 的打包 smoke 通过，worker 不依赖用户机器全局安装的 FFmpeg/MLT；许可证清单能定位每个动态库和插件。
2. 连续 100 次启动/渲染/取消无崩溃、临时目录和进程无泄漏；IPC 只传 JSON/文件引用，不传未受控本地路径。
3. 目标性能：参考机器上 1080p/30fps 简单三轨预览达到至少 24fps；导出不劣于现有 FFmpeg 后端 20%。性能未达标不阻断正确性，但不能以“更快”作为接入理由。

### Agent 与安全（硬门）

1. `read_timeline` 输出稳定 ID、source window、revision；`propose_edit_plan` 只读；`apply_edit_plan` 一次事务/一次 Undo。
2. 目标超出冻结 clip/range、revision 过期、缺 `reason` 或未知 operation 时，主进程/renderer 均拒绝；外部 backend 永远收不到预算、确认或 Agent session 权限。
3. 与真实任务走查：①15 镜短片从 storyboard 到成片；②上传素材+AI 镜头混剪；③删除一句转录并验证字幕/音频/时间轴同步；每次都能预览、导出、Undo。

## 许可证与分发清单

- MLT core 是 LGPL-2.1，但其 CMake 默认打开 GPL/GPL3 模块；必须显式关闭未审计模块、锁定构建参数并在发行包附许可证/源码获取方式。
- libopenshot 是 LGPL-3-or-later，且带 FFmpeg、OpenCV、音频驱动等依赖；按动态链接、插件和平台逐项生成 SBOM。
- FFmpeg 默认 LGPL，可选 GPL/nonfree；禁止把 `--enable-gpl`/`--enable-nonfree` 混进发布构建而未做法务确认。
- Remotion 是 source-available 商业许可，不因 Nomi AGPL 自动获得商业使用/再许可权；默认不打包 Remotion runtime。
- OpenChatCut/OpenMontage 的 AGPL 代码可以作为同许可证项目的参考或局部移植，但复制代码时保留版权、NOTICE、对应源代码和网络交互源代码义务；“只复制几行”不能作为合规依据。
- OpenCut classic MIT、OpenCut rewrite MIT、OTIO Apache-2.0 均允许更宽松集成，但仍需保留 NOTICE，并核对其依赖许可证。

## 不要碰的边界

本方案的实现分支只能改 `src/workbench/timeline/`、`src/workbench/adoption/`、`src/workbench/export/`、`electron/export/`、独立 backend worker 和测试/文档。以下在 P0/P1 明确冻结：

- Pi Agent runtime、`electron/harness/runtime/pi/`、Agent session/history owner。
- MCPSQ 页面迁移、`main.ts`、`preload.ts`、`bridge.ts`，以及 React Flow `GenerationCanvas` owner。
- `ProductionRun`、预算 ledger、审批收据、MCP capabilityCore 的事实源。
- 直接引入 OpenCut/OpenChatCut 的 Zustand/editor store，或在 Nomi 外再保存一份 TimelineState。
- 通过“fallback renderer”掩盖 backend 能力差异；不支持必须返回诊断并阻止错误成功。

## 回滚与交付拆分

提交按可回滚边界拆分：

1. Timeline schema/normalize 与 revision 测试；
2. Pure EditPlan operations + Adoption adapter；
3. FFmpeg parity（音频/转场/字幕/source window）；
4. Agent/MCP descriptors 与 capability/policy 测试；
5. MLT worker POC（独立包、许可证清单、fixture）；
6. 只有 POC 通过后才提交 backend routing 变更。

任何阶段失败都保留 FFmpeg 路径和当前 TimelineState；删除 MLT/OpenCut 实验包不会影响 Pi Agent、MCPSQ 或画布连线。最终合并以接口和测试为中心，而不是跨分支搬运 UI/运行时。

## 评审后的最终判断


“不重复造轮子”应理解为：把媒体处理、滤镜、音频、转场、交换格式和 ASR 交给成熟项目；把时间轴事实、编辑事务、Agent 意图和 Nomi 的本地/付费/撤销语义留在 Nomi。当前最值得立刻推进的是 P0 + MLT 隔离 POC，而不是重写整个剪辑模块或接入 OpenCut rewrite。这样可以在短周期内获得接近专业 NLE 的底层能力，同时确保另一条 Pi Agent/MCPSQ 分支最终只需要合并稳定 adapter，不会和剪辑实现互相打穿。
