# AI 运镜工具：把 3D 轨迹运镜拆给 AI 直接用（研究 + 方案）

> 状态：研究完成，待用户拍方向后再写实现 plan + 样张。日期 2026-06-22。
> 三路并行调研：①轨迹功能代码 ②create_staging_reference 蓝本 + 参考媒体喂入链路 ③text→运镜 SOTA。

## 0. 一句话（2026-06-22 更正：参考视频路是主路，不是死路）

把刚并入的「3D 轨迹运镜」拆成一个 **对话就能触发的 AI 工具**：用户说「让镜头绕着她转一圈推近」→ AI 在隐藏的 3D 场景里摆出这条相机轨迹 → 渲出**一段 3-8 秒的运镜小片**（灰模型、丑没关系）→ 喂进 **Seedance 2.0「全能参考」的参考视频槽**，模型只抽运镜、内容由角色参考图 + 文字管。

> **重要更正**：初稿把"喂参考视频"判成死路、改推首尾帧——**错了**。实证（2026 多来源 + 代码）：**Seedance 2.0 全能参考的参考视频专门迁运镜、且只迁运镜不迁内容**（5 秒推镜参考 + 三个不同 prompt → 三版运镜全相同、画面全不同）。所以参考视频是**控运镜最强的主路**；首尾帧只是"不吃视频参考的供应商"的降级。

## 1. 这东西是什么 + 核心价值

**是什么**（代码实证，Agent A）：轨迹 = 3D 场景里的一条 Catmull-Rom 曲线，可绑**相机**也可绑物体。绑相机时 `cameraWithPlaybackPosition(state, camera, t)` 能算出相机在任意时刻 t 沿轨迹的位姿——**纯函数、无 GUI、已经是 headless 的**。数据模型（`Scene3DTrajectory` / `Scene3DTrajectoryBinding`，含 startTime/endTime= 速度、direction、tension）干净且已持久化进 `node.meta.scene3dState`。单帧离屏截图 `captureScene` + `StagingCaptureHost` 已是生产级。

**核心价值**：AI 对镜头的意图是**语言**（"orbit 推近"），但供应商视频模型对语言的运镜理解很不稳（Agent C 实测：Runway/Kling/Veo 复合运镜都不可靠）。Nomi 手里有别人没有的资产——**一个本地 3D 相机**。它能把"绕着转推近"这句话**翻译成两张确定的画面（起幅怎么框、落幅怎么框）**，让视频模型没法误解。这就是杠杆：**3D 相机当 AI 意图 → 供应商能吃的东西 之间的翻译器。**

## 2. 目的地是通的，缺的是两段桥（不是三堵墙——更正）

实证后，"参考视频喂进生成"这条路**目的地完全成立**：

- **Seedance 2.0 全能参考(omni) 有 `video_ref` 槽**（`seedanceApimart.ts:41`：参考视频 ≤3，`video_urls`，经 apimart 已接入）。
- **它就是迁运镜的**：2026 实测，参考视频只控相机路径、不控内容（来源：[magichour](https://magichour.ai/blog/seedance-20-reference-guide)、[vicsee](https://vicsee.com/blog/seedance-2-0-omni-reference)、[seed.bytedance](https://seed.bytedance.com/en/seedance2_0)）。官方五维 prompt 架构第二层就是"镜头运动"，玩法 = `@视频1 参考运镜 + @图片1 锁角色`。
- 甜区：3-8 秒小片、一镜一个运镜（subject 动或 camera 动，别都动）。

要补的两段桥（都查实）：

| 桥 | 现状（实证） | 补法 |
|---|---|---|
| ① 轨迹→视频文件 | Agent A：scene3d 只有单帧截图，无 N 帧循环。但 `cameraWithPlaybackPosition(state,camera,t)` 纯函数已能取任意时刻相机位姿。 | 扩 `Scene3DAutoCapture` 成"沿 t∈[0,1] 采 N 帧"，走 Nomi 已有 ffmpeg 导出拼 mp4。丑无所谓，只要运动对。 |
| ② 视频→video_ref 槽 | Agent B：视频槽只能手动上传 `meta.referenceVideoUrls` 填，连线喂不了。 | 工具把 mp4 url 写进目标镜头 `meta.referenceVideoUrls` + 切 Seedance 2.0 omni 模式 + prompt 加 `@视频1 参考其运镜`。 |

（非 Seedance 等不吃视频参考的供应商 → 降级首尾帧/纯 prompt，见档 2/3。）

## 3. 推荐方案：克隆 staging 蓝本，做「AI 运镜」工具（三档，全 training-free）

完全复用 `create_staging_reference` 的成熟管线（Agent B 蓝本：4 处注册 = 后端/渲染层各 2；语义参数 → buildScene → 打 autoCapture 标 → 全局常驻 Host 离屏出图 → 连边到镜头**图像**节点）。

**档 1（地板，全供应商可用）：text → 结构化运镜 prompt。** AI 从规范运镜词表（pan/tilt/dolly/truck/crane/orbit/track/zoom + 速度 + 景别，Agent C 给了完整表）挑**一个主运镜**，模板成供应商话术塞进该镜视频 prompt。零新基建。

**档 2（推荐主菜，最贴 Nomi 架构）：3D 相机起幅/落幅 → 首尾帧。** AI 触发工具 → 在隐藏 3D 场景建一条相机轨迹 → 用已有的 `cameraWithPlaybackPosition` 取 t=0 和 t=1 两个相机位姿 → 各 `captureScene` 出一张图 → 作为 **first_frame / last_frame** 喂 i2v（Seedance 首尾帧、Kling、Runway 都支持帧间插值）。模型在两张确定框图之间补运镜，比纯 prompt 稳得多。**只需新增"两次单帧捕获"，连 N 帧视频循环都不用造。** 同时叠加档 1 的 prompt。

**档 3（仅 Kling，能力位后置）：关键帧轨迹路径。** 唯一吃自定义相机关键帧的供应商，把轨迹编辑器关键帧直接映射到 Kling API。挂 archetype 能力位，不另做 UI。

### 触发与喂入（对话即触发）
- **触发**：复用 staging 的"靠工具描述判断"——当用户/分镜里出现**具体运镜意图**（绕、推、拉、跟、升降摇移…）时 AI 自调；单镜头大头照不触发，一镜一次。
- **喂入**：产物是**图像节点**，连 `first_frame`（必要时 `last_frame`）到该镜的关键帧图/ i2v 节点——走已 100% 打通的 image-first / shot→shot 链，视频继承首帧。

## 4. 需要用户拍的那一刀

核心取舍 = **做多深**：
- 只做档 1（prompt）= 1 天级、零基建、但只是"说得更专业"，控制力弱。
- 做档 1+2（首尾帧，**推荐**）= 真正用上 Nomi 的 3D 资产、控住运镜、复用 staging 90% 基建；需新增运镜词表→相机轨迹的映射 + 两帧捕获 host 复用。
- 加档 3（Kling 路径）= 锦上添花、单供应商、可后置。

附：轨迹功能的 GUI 目前**还没挂进实时编辑器**（Agent A：自包含核心，Scene3DEditor 没 import 它）。AI 路是 headless 的不依赖 GUI，所以不阻塞本方案；但"人也能手搓轨迹"是另一条线，需单独决定要不要补挂载。

## 5. 下一步（待拍板后）
1. 选档（建议 1+2）。
2. 写实现 plan（R4）：运镜词表 `cameraMoveVocab.ts`（仿 stagingVocab）+ `buildCameraMoveScene`（仿 stagingBuilder）+ 工具注册 4 处 + 首尾帧捕获（扩 Scene3DAutoCapture 成取 t=0/t=1 两帧）+ 连边到 first/last_frame。
3. 出可交互样张（R8）：用户对话触发 → 看到起幅/落幅两张图落到镜头上。
4. 真 LLM E2E + 真机走查（额度已授权）。

---

## 6. 实现 plan（2026-06-22 追加，待用户拍 sequencing）

「整好这事」= 两块。轨迹核心(数据模型+playback+组件)已在 0.11.1，但**两处都没接通**：人看不见（UI 没挂进编辑器）、AI 用不了（无 headless 视频捕获 + 无喂入）。

### Part A — 把轨迹编辑器挂进 3D 编辑器（人能看见/手搓）
贡献者只落了自包含组件，从没 import 进 `Scene3DFullscreen.tsx`。要补：
- SA1：`TrajectoryRenderer` 挂进 `<Canvas>`（渲路径/控制点/Bezier 手柄）；`TrajectoryPanel` 进右侧栏（接 onAdd/onSelect/onPatch/onDeleteTrajectory + 绑定回调 → 改 `node.meta.scene3dState`）；`TrajectoryTimeline` 进底部；工具条加「+轨迹」入口 + 轨迹选中态。
- SA2：`useTrajectoryAnimation` 接 playback（播放头驱动 objectRefMap，相机/物体沿轨迹动）。
- 验收：R13 真机走查（画轨迹→绑相机→播放看相机沿路径动）。截图人眼判断（gates 照不出 3D 交互）。

### Part B — AI 运镜工具（对话触发 → 渲运镜小片 → 喂 Seedance 2.0 video_ref）
克隆 `create_staging_reference` 蓝本。
- S1：`cameraMoveVocab.ts`（仿 stagingVocab：运镜词表 orbit/push/pull/crane/track/pan/tilt + 速度 + 景别 + 时长）+ `buildCameraMoveScene(spec)`（仿 stagingBuilder：词表→含相机轨迹的 Scene3DState）。纯数据，单测锁。
- S2：N 帧捕获 host——扩 `Scene3DAutoCapture`/新建 host：沿 t∈[0,1] 用 `cameraWithPlaybackPosition` 采 N 帧 `captureScene` → 走 Nomi 已有 ffmpeg 导出拼 3-8s mp4 → `persistScene3DScreenshot` 同源持久化。全局常驻 host（同 StagingCaptureHost 根因：离屏节点被剔除）。
- S3：喂入——mp4 url 写目标镜头 `meta.referenceVideoUrls` + 切 Seedance 2.0 omni 模式 + prompt 追加 `@视频1 参考其运镜`。非视频参考供应商降级首尾帧（取 t=0/t=1 两帧 → first/last_frame）。
- S4：注册 AI 工具 4 处（后端 canvasTools.ts schema + agentChatV2 wiring；渲染层 applyCanvasToolCall executor + gate writes:true）+ 触发条件（出现具体运镜意图才调，一镜一次）。
- 验收：真 LLM E2E（AI 判意图→建轨迹→渲片→喂槽）+ 真机走查 + 真生成对比"有无运镜参考"出片差异（额度已授权）。

### Sequencing（建议）
B 是用户主诉求且 headless 不依赖 A。建议 **B 先（S1→S2→S3→S4）跑通 AI 运镜**，A（手搓 UI）随后补。但 A 让用户"看得见摸得着"，也可并行。待用户拍。
