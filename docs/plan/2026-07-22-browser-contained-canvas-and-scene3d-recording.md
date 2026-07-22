# 计划：浏览器 contained→画布 P0 + 3D 录制事务/姿势/运镜 + 语义诚实收尾

> 日期：2026-07-22 · 分支：`fix/browser-contained-and-scene3d-recording`（sibling worktree `/Users/aoqimin/Desktop/Nomi-fix-b3d-20260722`，钉 `origin/main@1e18a6fd`）
> 来源：`/Users/aoqimin/Desktop/Nomi-latest-retest-20260722/.retest-evidence/REPORT.md`（复测总报告，基线 1e18a6fd）
> 产品取舍已由用户拍板（见工单二节），本计划不再询问方向，只落实现。

## 一句话

复测确认两条真实用户闭环仍断：浏览器素材进 contained 素材盒后「放到画布」被代码硬置 false（P0 回归 `dfc47477`）；3D 人物动作录制首击不真开录、C 键下蹲不进最终 take、预选运镜被采样机位覆盖。全部有确定根因，本轮修完 + 五门 + 四条官方走查 + 真机眼见链，commit push main。

## 范围（改什么）

### A. 浏览器 P0：contained 素材盒 →画布（根因确定）
- 根因：`NomiBrowserAssetPopover.tsx:236-256` 在 `contained` 为真时无条件 `setCanvasImportAvailable(false)` 并 return，从不消费 overlay 已传入的跨窗探针 `probeCanvasImportAvailable`（props 已声明但组件从未解构）。跨窗导入链其余环节实测健全：dispatch→overlay 订阅→IPC `browser:asset-overlay:import-to-canvas`→主窗 `GenerationCanvas.handleBrowserAssetsImportToCanvas` 真加节点。
- 修：
  1. 组件解构 `probeCanvasImportAvailable`；availability effect 分三支：非 contained 走既有 DOM MutationObserver；contained + 有探针 → 开时即探 + 每 2s 轮询；contained + 无探针 → false。
  2. ready 素材加**可见底部主动作**「放到画布」（不再只藏右键菜单）。复用同一 `importSelectedAssetsToCanvas`。
  3. 导入成功后就地反馈「已放到画布 · 关闭浏览器查看」。
  4. 回归测试：contained + 探针 true + 选中 ready → 按钮可见 → 点击 → dispatch 被调用（携带该素材）；并测 `GenerationCanvas` 导入 handler 收到素材 → 节点 +1。

### B. 浏览器捕捞语义与失败终态
- **黑帧拒绝**（P1）：MSE 当前帧落库前查像素亮度/信息量，纯黑（B站阻断画面）不进 ready，提示「先播放到有效画面再保存」。落在主进程 `browserMediaVisualCapture` 当前帧产出处。
- **动态图标注**（P1）：动画 WebP/GIF 显示为「动态图」而非笼统「网页原图」。渲染层 sidecar/副标题。
- **候选冻结**（P1）：用户 pointerdown/click 确认瞬间冻结 URL/类型/标题/矩形/预览，锁在 hover 换源之前（复测「只修一半」= 保存不再漂，但可见 JPG 未在 hover 前锁住）。
- **登录/验证/流媒体/非媒体终态**（P1）：Nomi 自己的可行动错误行，不进 ready，不泛化成「请重试」。
- 边界：不重写下载内核（当前公开站 6/6 原件落库）；gallery-dl/yt-dlp 只作显式沙箱化可选适配器，本轮不做核心依赖。

### C. 3D：一次点击真正开始录制（根因确定）
- 根因：`useScene3DTakeRecorder.startRecording` 用**闭包快照** `possessId`（= `possessTarget?.id`）做守卫与 t=0 种子。倒计时里先 `enterPossess` 再排 3s 定时器；定时器闭包持有的 `startRecording` 是接管前那次渲染的版本，`possessId=null` → 早退 → `isRecording` 不翻 → CTA 退回「开始录制」。二次点击时接管已落定才成功。
- 修：`startRecording` 守卫/种子改读实时 `possessTargetRef.current`（每渲染更新），任何时机调用都用已落定的接管目标。倒计时结束即 `isRecording=true`，CTA 直达「完成这段动作」，恢复操作 0。
- 测：hook 先以 possessTarget=null 拿到 `startRecording` 引用，再 rerender 成有目标，调用**旧**引用 → 期望 isRecording=true（旧代码此处 no-op，新代码通过）。

### D. 3D：C 键姿势进入最终 take（根因确定）
- 根因：`scene3dCharacterDriveController` C keydown/keyup 只 patch 实时 `object.pose`，从不进录制事件流；`Scene3DTakeSampler` 每帧只采位置/相机不采 pose；唯一 pose 事件生产者是动作库点击。故最终 `poseTrack` 不生成、`locomotionClip` 恒 walk。
- 修（统一 semantic pose transition，不写 crouch 特例）：
  - 控制器新增通用 props `onPoseTransition(presetId)` / `onPoseResume()`；crouch keydown → `onPoseTransition('crouch')`，releaseCrouch（非点击静态动作冻结态时）→ `onPoseResume()`。控制器不再直接 patch crouch pose。
  - `Scene3DFullscreen` 实现这对入口：**同时**更新实时画面（patchObject 被操控角色 pose）+ 录制中复用 `recordPoseEvent`/`recordPoseResume`。动作库点击维持 `applyActionPreset`+`recordPoseEvent`（同一录制入口）。
  - 覆盖 held-until-stop、窗口 blur、重复 keydown、Ctrl 与 C。
- 结果：`W→C down→C up→W` 持久化 poseTrack = base→crouch→base；MP4 中段静态蹲（`frameMotionSource` 判 static-pose 打断 walk），松开恢复 walk。
- 测：控制器 keydown/keyup 触发回调；录制器 base 种子 + crouch + resume → `buildPoseTrack` = 3 帧。

### E. 3D：保留已有相机运镜（根因确定）
- 根因：`buildRecordedTakeScene` 结尾用新建 trajectories/bindings **整体覆盖**，丢弃 base 中已应用的相机运镜（如「右横移跟拍」= `applyCameraMovePreset` 写入的 camera trajectory+binding），并无条件重采样「机位路径」。
- 修：录角色 take 前检测 base 是否已有绑定到 cameras[0] 的相机运镜（含 aim 绑定）。有 → 继承并保留该轨迹与绑定（按录制时长重定时到 [0,duration]，跟人物动作同步），不再采样新机位、不覆盖 followTargetId；无 → 维持现采样行为。
- 测：base 含相机运镜 trajectory+binding + 角色样本 → `buildRecordedTakeScene` 结果 trajectories 仍含该运镜（按名/几何），且**不**含「机位路径」；base 无运镜 + 用户移动相机 → 仍生成「机位路径」。

### F. 3D 体验收尾
- 首尾帧导出统一走**持久结果卡**（同截图/视频），带「回画布查看」。
- 城市双人/室内双人模板默认输出相机主体安全画幅（调模板默认相机，不持续自动覆盖用户手动构图）。
- 保持既修能力：工作/输出视图身份、模板成组、PNG/MP4 零 helper、首尾一致 SSIM≥0.95。
- 边界：不为测试新造天气系统；有通用雨效则接入，否则诚实标为能力边界。

## 不动项（明确不碰）
- 不重写浏览器下载内核；不绕过登录/Cloudflare/EdgeOne/DRM；不做 15 站核心特判。
- 不改既有出片离屏管线公式（首尾一致已 PASS）。
- 不引入 gallery-dl/yt-dlp 为核心依赖。
- 不新造简化版/旧版 fallback；替代旧路径即同 commit 删。

## 回滚
- 单分支单 PR 语义，全部改动可 `git revert` 整条；各修均带独立单测，回滚不留悬空。
- worktree 独立于主树与并行会话；push 前 fetch 对账 origin/main。

## 验收门（缺一不算完成）
1. 五门全过：`check:filesize` → `check:tokens` → `lint:ci` → `typecheck` → `test` → `build`。
2. 新增回归测试**先红后绿**（A/C/D/E + 黑帧 + 动态图 + 冻结）。
3. 四条官方走查：`browser-live-capture-sweep`、`browser-mse-canvas-walkthrough`、`scene3d-export-journey-walkthrough`、`scene3d-keyframe-consistency-walkthrough`。
4. 真机眼见链（R13，自己 Read 截图/抽帧）：
   - 浏览器：本地确定性 MSE ready→画布节点 +1 可见；当前帧非黑；候选确认→保存不漂。
   - 3D：首击倒计时结束即录制；`W→C→W` MP4 中段肉眼半蹲、末段 walk；预选右横移跟拍在最终 take 与 MP4 保留；三真实任务重走；零 helper、首尾 SSIM≥0.95。
5. 明确区分外部阻断（CF/EdgeOne 波动）与产品失败，不伪造通过。

## 实际交付状态（2026-07-22 收尾）

### 已修 + 已验证（root-caused，全绿 + 真机眼见链）
- **A**（contained→画布 P0）：availability 改由 `useCanvasImportAvailability` 消费跨窗探针；ready 素材加底部可见「放到画布」主动作 + 「已放到画布 · 关闭浏览器查看」。单测 `canvasImportAvailabilitySource`（contained+探针→probe，锁死回归）；真机 `browser-contained-canvas-walkthrough`：跨窗探针=true + contained 派发导入→父窗画布节点 0→1。
- **C**（一次点击开录）：`useScene3DTakeRecorder.startRecording` 守卫/种子改读实时 `possessTargetRef.current`（不读接管前快照），倒计时结束直达录制。真机 `scene3d-recording-walkthrough`：一次点击 CTA→3.5s→CTA=「完成这段动作」（0 恢复点击）。
- **D**（C 键姿势进 take）：统一 semantic pose transition（`useScene3DSemanticPose`，C 键与动作库共用录制入口，无 crouch 特例）。单测 poseTrack base→crouch→base + frameMotionSource 中段 static-pose；真机 poseTrack=`["base","crouch","base"]` + 现场半蹲截图。
- **E**（保留预选运镜）：`buildRecordedTakeScene` 继承 base 已应用的相机运镜（重定时到 [0,duration]），不再重采样机位覆盖。单测 + 真机 trajectories=`["假人 走位","右横移跟拍"]`（无「机位路径」）。
- **黑帧拒绝**（B P1）：MSE 当前帧落库前 `bgraLumaStats`+`isBlankFrameLuma` 判纯黑/纯色空帧，拒绝 + `black-frame` 可行动终态（渲染层文案）。单测覆盖 B站 YAVG=16 场景 + 不误伤暗场景。
- **动态图标注**（B P1）：`detectAnimatedImage` 检测动画 WebP/GIF → sidecar `animated` → 素材卡显示「动态图」。单测覆盖。

### 明确的能力边界（本轮未做，附根据 —— 诚实交付，非「静默略过」）
- **F1 双人模板默认相机安全画幅**：几何核算显示默认 fov（垂直 45°/水平 ~73° @6.4m）本应框住两名站立主体，复测「截头」是特定站位下的场景相关问题，需真机可视迭代复现+调（nomi-pose-staging-calibration 方法论），非盲改数值——盲调有回归已过的 keyframe 走查风险。`.scene3d-keyframe-lab/export-first.png` 可见该截头，留给下一轮带可视迭代做。
- **F2 首尾帧导出持久结果卡**：文件+画布节点已真实生成（复测确认），仅缺像截图/视频那样的持久完成卡（现为 toast）；属 UX 缺口非功能失败。改动需跨 `useScene3DCaptureExport`/`useScene3DFullscreenActions` 接线 + Scene3DFullscreen（已在 800 行上限）再拆，权衡后留边界。
- **B1 一次性「收素材→点目标」交互**：当前 Ctrl/Cmd+C 悬停捕捞已达公开站 6/6 ready；改成点击式捕捞需改注入 browser view 的捕捞桥，风险波及现能用的下载链，本轮不动（验收的产物结果——ready→画布、保存不漂——已由现路径达成）。
- **B2 hover 前锁可见资源**：保存阶段冻结已在（复测确认「保存不再二次漂移」）；hover 前锁定同属 B1 捕捞桥范畴，一并留边界。
- **登录/CF 终态**：`forbidden` 码已映射「先登录再捕捞」可行动文案；CF/EdgeOne 验证页用户根本不产生候选（无可导入物），不误进 ready（复测确认安全 PASS）。

### 官方 walkthrough 结果
- `scene3d-export-journey-walkthrough`：PASS（出片旅程全过）。
- `scene3d-keyframe-consistency-walkthrough`：PASS（首尾 SSIM 0.9876/0.9657 ≥0.95，全产物零 helper）。
- `browser-mse-canvas-walkthrough`：环境受限——合成鼠标 hover 在本机不产候选（**基线 1e18a6fd 同样 candidate=null**，非本次回归；其 canvas 导入段被 A 修的 `browser-contained-canvas-walkthrough` 独立证过）。
- `browser-live-capture-sweep`：同依赖真实网络捕捞 + 合成 hover，外部阻断（CF）与本机 hover 限制并存，非产品失败。
