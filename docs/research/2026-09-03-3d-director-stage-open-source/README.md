# 3D 导演台与参考设计台：开源能力对齐研究

状态：✅ 已交付

## Scope

- 研究目标：找出能帮助 Nomi 快速拉齐核心体验的开源项目、框架和模型实现。
- 目标用户任务：用户用一句话描述镜头/动作，快速得到可调整的 3D 画面和动作参考，并把参考图/参考视频喂给后续生成；用户也能在画布中快速整理、裁剪、标注和局部修改参考图。
- 研究对象：3D 场景运行时与编辑器、动作捕捉/人体姿态、文字/图片转 3D、2D 设计画布。
- 不做什么：不把 Nomi 改造成 Blender、游戏引擎或 Canva；不在本报告中引入生产依赖；不把模型权重、人体模型和数据集未经核验地当作可商用。
- 观察日期：2026-09-03。

## Evidence

### 证据状态

- `documented`：来自官方仓库、官方文档或许可证。
- `observed`：来自当前 Nomi 代码和既有真实走查证据。
- `inferred`：由官方能力与 Nomi 现状对账后的推导。
- `proposed`：给 Nomi 的产品和工程建议。
- `blocked`：因许可证、权重、硬件、账号或当前环境无法确认的部分。

### 当前 Nomi 真相

Nomi 并不是从零开始：

- `observed` — `package.json:176-185,206,220`：已经有 Leafer、`@react-three/fiber`、`@react-three/drei` 和 Three.js，且没有必要再增加第二套 WebGL renderer。
- `observed` — `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:126-180`：3D 场景状态已经通过 `scene3dState` 归一化、比较并写回画布节点。
- `observed` — `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:202-249`：录制 take 会创建独立的 3D 参考节点，并把动作/机位轨迹交给现有的离屏捕获链。
- `observed` — `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:251-318`：截图会持久化为图片节点，并根据目标槽连接为下游参考。
- `observed` — `src/workbench/generationCanvas/nodes/scene3d/scene3dSceneView.tsx:127-180`：角色和场景对象已有选中、聚焦、TransformControls 和拖动回写。
- `observed` — `src/workbench/generationCanvas/nodes/scene3d/scene3dSerializer.ts:1-170`：场景有独立的序列化/归一化边界。
- `observed` — `src/workbench/generationCanvas/nodes/NodeImageEditToolbar.tsx:15-20,78-153`：图片节点已有 AI 编辑、裁剪、抠图、切图、变换、白板、下载和溯源入口。
- `observed` — `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardLeaferCanvas.tsx:1-170`：参考图白板已经使用 Leafer 渲染和交互。

因此当前最大问题不是“没有 3D 库”，而是用户首先看到的是低层控制和多个出口；缺的是把自然语言编译成一个明确的当前镜头、动作和参考包。

### 既有 Nomi 走查证据

此前的完整 3D 导演台、TapNow、LibTV 和 Lovart 走查已经保存在：

- [`2026-08-02 3D 导演台完整研究`](2026-08-02-3d-director-stage/README.md)
- [`Lovart 学习包`](../../competitive-learning/lovart/README.md)

本报告只补“开源项目/框架能否快速拉齐”的层，不重复复制已有截图树。

Walkthrough: not applicable — source-only study

## Capability matrix

| 能力/用户动作 | 开源项目/框架怎么做 | 许可证/成熟度证据 | Nomi 当前状态 | Nomi 决策 |
|---|---|---|---|---|
| 在 3D 场景中选择对象、改属性、查看层级 | Three.js 提供运行时；React Three Fiber 将 Three.js 声明式接入 React；Theatre.js 的 `@theatre/r3f` 将对象暴露给 Studio，并提供属性面板和 Sequence Editor | Three.js/R3F 为 MIT；Theatre core 为 Apache-2.0，Studio 为 AGPL-3.0，官方仓库明确说明两者边界 | 已有 Three.js/R3F、对象选中和 TransformControls，但默认体验仍偏底层 | 保留现有 renderer；借鉴 Theatre 的编辑语义，先做独立 spike，不直接嵌 Studio |
| 相机与角色属性的可视化关键帧 | Theatre.js 支持把对象属性加入 Sequence Editor，在时间点修改属性并播放 | 官方文档说明可对位置等属性打关键帧；但公开仓库提示 1.0 开发阶段有过暂时私有迭代 | Nomi 已有相机、轨迹、take 和时间线数据，但不是一个“当前镜头”优先的可视化编辑面 | 借鉴交互和数据模型；不让第三方 Studio 成为 Nomi 第二个状态源 |
| 3D 引擎和可视化编辑器整套替换 | PlayCanvas 同时提供 MIT 引擎和开源 Editor 前端，覆盖层级、资产、动画、WebGL/WebGPU | 官方仓库/文档确认 engine 与 editor 为 MIT；Editor 前端于 2025-07-30 开源 | Nomi 已经有 React/R3F/Three 状态和 Electron 画布 | 不采用为 renderer；只作为“层级树、属性检查器、资产面板”体验参考 |
| 从视频获得人体动作 | MMPose 覆盖 2D、多人体、手、脸、全身和 3D mesh recovery；GVHMR 从视频恢复 SMPL/SMPL-X 的相机帧和世界帧运动，并提供 overlay 输出 | MMPose 官方仓库为 Apache-2.0；GVHMR 的人体模型需要单独注册，官方现代化 fork 明确说明 SMPL/SMPL-X 不能随项目再分发 | Nomi 已有姿势、轨迹、角色驱动和 take，但还没有“视频 → 标准动作 → 角色重定向”的统一输入适配器 | 后端候选；先做本地/外部 adapter spike，不把权重和人体模型捆进安装包 |
| 消除脚滑、恢复世界坐标和脚接触 | WHAM 论文把运动上下文、视频上下文、全局轨迹和脚接触结合，目标是从移动相机视频恢复世界坐标动作 | 论文/官方项目页是 documented；具体商用授权和模型再分发仍需逐版本核验 | Nomi 的动作轨迹可以编排，但没有视频重建的世界坐标质量保证 | 借鉴“世界坐标 + 足部接触 + 质量检查”指标；不直接把研究代码当生产能力 |
| 从文字/图片生成 3D 资产 | TRELLIS.2 生成高分辨率 PBR 网格；Hunyuan3D 生成图像/文字到 3D 资产；TripoSR 提供单图到 3D 的快速 pipeline | TRELLIS.2 官方仓库声明模型与代码 MIT，但依赖有独立许可证；Hunyuan3D 每个版本需按仓库许可证核验；TripoSR 源码/模型卡显示 MIT，但权重与依赖仍需单独记录 | Nomi 目前用程序化角色/场景对象快速搭镜头，已有异步参考接缝 | 作为资产 adapter，不放在用户第一步；先用低成本代理角色把动作/镜头做通，再异步替换资产 |
| 2D 参考图对象、图层和导出 | Leafer 提供对象交互、编辑器插件、手势、自动布局和 SVG 导出；Fabric.js 提供对象模型、变换、文本、过滤器和 JSON/SVG I/O | Leafer 与 Fabric.js 官方仓库为 MIT；Leafer 官方文档强调 editor 插件 | Nomi 已有 Leafer 白板和图片编辑工具 | 继续使用 Leafer；借鉴 Fabric 的可序列化对象模型，不新增 Fabric |
| 完整图层/设计协作系统 | Penpot 提供图层、组件、原型、SVG/CSS/HTML/JSON、协作和自托管 | 官方仓库为 MPL-2.0，产品范围很大 | Nomi 需要的是参考图准备，不是完整产品设计平台 | 借鉴图层/锁定/隐藏/导出语义；不嵌入 Penpot |
| 完整 SVG 编辑器 | SVG-Edit 直接提供浏览器 SVG 编辑器 | 开源项目可用于研究，但具体依赖和当前维护状态须逐版本检查 | Nomi 的参考图需求包含位图、遮罩和生成交接，不只是 SVG | 不采用；只参考路径/选择/变换的基础交互 |
| 无限白板与协作 | tldraw 是成熟的 React 白板 SDK，但官方仓库说明生产使用需要 license key | 不是可直接按 MIT 处理的开源依赖 | Nomi 已有 Leafer 白板，且本轮不以协作为目标 | 不采用，避免许可证和 renderer 重叠 |

## Decision

### 直接采用

1. **继续采用现有 Three.js + React Three Fiber + Leafer**。这已经是 Nomi 的真实运行基础，换 PlayCanvas、Babylon 或 Godot 不会自动解决“一句话到镜头结果”的问题。
2. **把现有 3D 能力编排成一个 Shot Compiler**：自然语言先生成角色、动作、机位、构图和输出格式的结构化镜头意图，再让当前场景状态呈现和捕获链执行。
3. **把动作输入做成 adapter 边界**：视频动作输入可接 MMPose/GVHMR 或外部服务；统一输出 Nomi 自己的角色动作/轨迹结构，不让某一个模型的骨骼格式污染产品层。

### 借鉴交互

- 借 Theatre.js：对象树、可见属性、选中后直接编辑、属性进入时间序列、播放头驱动预览。
- 借 PlayCanvas：层级和属性面板的空间组织，但不借它的 engine 状态。
- 借 Penpot/Fabric.js：图层的隐藏、锁定、顺序、序列化和撤销，不把参考设计台做成全量设计软件。

### 适配为后端能力

- **动作**：MMPose → 关键点；GVHMR/WHAM 类方法 → 世界坐标/人体动作；再经过 retarget、脚接触检查、动作裁剪和 Nomi capture。
- **资产**：TRELLIS.2/Hunyuan3D/TripoSR → 可替换的角色/道具/场景资产；先异步生成，不能阻塞用户完成镜头构图。
- **产品层**：Nomi 自己掌握镜头语义、角色身份、场景状态、参考槽、版本和 ReferencePack，这才是不能外包的价值。

### 不采用

- 不嵌入 Theatre Studio、Penpot、PlayCanvas Editor 或 tldraw 作为生产 UI：它们各自有自己的状态、编辑器边界或许可证/维护约束。
- 不把 TRELLIS.2/Hunyuan3D 直接捆绑进 Electron 安装包：GPU、模型体积、权重许可和平台差异会把“快速出镜头”变成安装与运维问题。
- 不把完整动作捕捉研究仓库直接宣称为“完美动作控制”：真实效果还需要同一角色、同一骨骼、地面接触、遮挡和镜头输出的质量测试。

## User value and trade-offs

现在用户要在许多低层控制之间找结果；重做后，他只需说“一个人从画面左侧冲向镜头，镜头缓慢推进，最后停在半身近景”，Nomi 先给出可见的角色、动作、机位和构图，然后只让他修改不满意的部分。

收益是减少配置和返工，并让参考图/参考视频从同一个镜头状态产生。代价是需要建立一层稳定的 `ShotSpec`/动作 adapter/ReferencePack 数据合同，还要面对动作重定向、GPU、模型许可和异步失败状态；这些代价不能用换一个 3D 框架来规避。

## License, rights and risks

- Three.js、React Three Fiber、PlayCanvas Engine/Editor、Leafer、Fabric.js：官方项目页面显示 MIT，但发布时仍需保留依赖清单和许可证收据。
- Theatre.js：core 与 Studio 许可证不同；Studio 的 AGPL-3.0 边界必须在任何嵌入决定前重新核验。
- Penpot：MPL-2.0，适合研究图层/设计协作语义，不代表可以无成本嵌入整套产品。
- TRELLIS.2/Hunyuan3D/TripoSR：代码、模型权重、依赖和输入数据权利分开核验；本报告不把“仓库开源”推导成“所有输出和权重都可商用”。
- MMPose/GVHMR/WHAM：人体模型、数据集和预训练权重可能有单独限制；默认走外部/本地 adapter，不在安装包再分发。
- TikHub 官方账号宣传研究：当前运行环境没有可用密钥，账号级检索保持 `blocked`；本报告不把公开官网页面当成已完成的 TikHub 账号研究。

## Next acceptance tasks

1. 做一个不接真实模型的 Shot Compiler vertical slice：一句话输入 → `ShotSpec` → 当前 3D 导演台呈现 → composition still + reference manifest。
2. 做 Theatre.js 交互 spike，只验证对象选择、属性面板和关键帧体验；验证数据是否能落回 Nomi `Scene3DState`，不引入 Studio 作为生产 owner。
3. 做动作 adapter spike：用一段许可明确的短视频，验证关键点/世界轨迹 → Nomi 角色骨骼 → 脚接触检查 → MP4/reference video；记录模型、权重、人体模型和硬件限制。
4. 把现有 Leafer 白板扩成窄版 Reference Design Board：图层、隐藏/锁定、裁剪/变换、标注、局部 AI 编辑、撤销和冻结导出。
5. 为每个 vertical slice 建真实用户任务：一句话建镜头、改一个动作、改机位、输出参考包、把参考包接到视频生成节点；截图和最终媒体必须来自同一构建、同一入口。

## Source ledger

| 来源 | 类型 | 访问日期 | 支撑结论 | 状态 |
|---|---|---|---|---|
| [Three.js](https://github.com/mrdoob/three.js/) | 官方仓库 | 2026-09-03 | 3D 运行时基础 | documented |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | 官方仓库 | 2026-09-03 | React 渲染器与 Nomi 现有技术栈对账 | documented |
| [Theatre.js](https://github.com/theatre-js/theatre) | 官方仓库 | 2026-09-03 | 可视化 3D 编辑、属性和时间序列；许可证分层 | documented |
| [Theatre.js R3F 文档](https://github.com/theatre-js/website/blob/main/content/docs/0.5/500-api/300-r3f.mdx) | 官方文档源码 | 2026-09-03 | `@theatre/r3f` editable 对象 | documented |
| [PlayCanvas Engine](https://github.com/playcanvas/engine) | 官方仓库 | 2026-09-03 | 开源 3D engine、动画、WebGL/WebGPU | documented |
| [PlayCanvas 开源说明](https://developer.playcanvas.com/user-manual/getting-started/open-source/) | 官方文档 | 2026-09-03 | engine/editor/repositories/license 列表 | documented |
| [MMPose](https://github.com/open-mmlab/mmpose) | 官方仓库 | 2026-09-03 | 2D/3D/全身/人体 mesh 能力与 Apache-2.0 | documented |
| [GVHMR](https://github.com/zju3dv/GVHMR) | 官方仓库组织 | 2026-09-03 | 世界坐标人体动作恢复候选 | documented |
| [GVHMR modernized fork](https://github.com/ryanrudes/gvhmr) | 官方相关实现 | 2026-09-03 | SMPL/SMPL-X 注册与不可再分发限制 | documented |
| [WHAM project](https://wham.is.tue.mpg.de/index.html) | 官方项目页 | 2026-09-03 | 世界坐标动作、移动相机、脚接触方向 | documented |
| [TRELLIS](https://github.com/microsoft/TRELLIS) | 官方仓库 | 2026-09-03 | 文字/图片到多种 3D 表示，MIT 主体声明 | documented |
| [TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | 官方仓库 | 2026-09-03 | PBR 3D 资产、硬件前提和 MIT 声明 | documented |
| [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | 官方仓库 | 2026-09-03 | 图片到高保真 3D 资产候选 | documented |
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | 官方相关仓库 | 2026-09-03 | 单图快速 3D pipeline 候选 | documented |
| [LeaferJS](https://github.com/leaferjs/leafer) | 官方仓库 | 2026-09-03 | 编辑器、手势、布局、SVG 导出和 MIT | documented |
| [Fabric.js](https://fabricjs.com/) | 官方项目页 | 2026-09-03 | 对象模型、序列化、SVG I/O | documented |
| [Penpot](https://github.com/penpot/penpot) | 官方仓库 | 2026-09-03 | 图层、协作、自托管和 MPL-2.0 | documented |
| [SVG-Edit](https://github.com/SVG-Edit/svgedit) | 官方仓库 | 2026-09-03 | SVG 编辑器近邻 | documented |
| [tldraw](https://github.com/tldraw/tldraw) | 官方仓库 | 2026-09-03 | 生产 license key 边界 | documented |
