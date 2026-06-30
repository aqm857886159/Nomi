# 游戏式操控 3D 角色 → 录成参考视频 → 喂生成保一致性

> 状态:**方案待拍板(R8 样张未过)**。本文是 R4 执行前文档。
> 日期:2026-06-30。触发:用户「研究一下能不能像打游戏一样控制每一个人物……录制成参考视频喂生成模型保持强一致性」。
> 用户已拍方向:**薄皮 · 把精度押在相机+走位**(AskUserQuestion 2026-06-29)。

## 0. 一句话

把 Nomi 现有 3D 导演台的「实时 fly 操控 + 轨迹录制」从**相机**扩到**角色**,让用户像打游戏一样走位/触发动作 + 摆运镜,边操作边录成一段干净的驱动视频;角色身份靠**另一条腿**(参考图 + Wan2.2-Animate 类驱动引擎 / 现有 video_ref)闭合。**不做游戏引擎级精细操控**——精度只押相机和走位,角色动作用现成动作库。

## 1. 为什么这么做(底层逻辑 + 现状根据)

调研三件事查实(详见 `docs/research/2026-06-29-radar.md` 同期四路 agent 简报,关键来源已在对话留存):

1. **生成模型对 3D 参考的「吃法」是分层的**(命门):
   - 相机/运镜 → 吃得最准,值得做精(Uni3C / ReCamMaster 实证能强锁);
   - 角色动作/站位 → 大致就够,做精被下游高频阶段重写(扩散粗→细机制 + 多篇 robust-to-noisy 设计 + I2V3D 显式容忍粗几何 + PrevizWhiz 用户研究);
   - 角色身份(脸/衣服跨镜) → 3D 灰模没脸没衣服,帮不上,**必须另配参考图 / LoRA / 原生 identity**。
   - 结论:把工程预算砸在「精细 3D 角色操控」上,下游基本打水漂。精度只押**相机 + 大致骨架/空间占位**。

2. **学术 + 商业先例验证了这条路**:
   - `PrevizWhiz`(Autodesk Research,CHI 2026)= 几乎同款:**WASD+Q/E 实时录制角色走位 + 关键帧机位 → 合成引导视频 → 喂 Wan/VACE**,带「相似度旋钮」(Strict/Faithful/Flexible/Loose)。
   - `Reallusion AI Studio`(2026-05)= 「3D 作精确控制层,AI 负责视觉丰富度/表情/物理」。
   - 气质最贴 `PoseMy.Art`(3D 台导 OpenPose/Depth/Normal 给 ControlNet)。

3. **身份那条腿有可落地引擎**:`Wan2.2-Animate-14B`(阿里,2025-09 开源,ComfyUI/Diffusers 已接,4090 可跑)吃「角色图 + 驱动视频 → 锁身份的一致角色」,正是 Nomi 3D 台产的那段驱动视频该喂的下游。备选:Runway Act-Two / Kling Motion Control(闭源 API)。**别在 mocap 工具或 Animate Anyone 2(无可用代码)上建。**

4. **结构性空白**:「轻量 + 实时 + 3D 精确 + 直喂生成模型 + 强一致性」象限 2026 无人占住(重的 UE/Omniverse 太难;轻的 PoseMy.Art 只能静态;故事板 LTX/Katalist 放弃空间真值)。Nomi 站这个空缺中心。

## 2. 现状:Nomi 已经站到哪(地基)

3D 导演台子系统 `src/workbench/generationCanvas/nodes/scene3d/`(~70 文件,~16000 行)。两条「3D→参考→喂生成」链路**已端到端打通**:
- 站位参考(3D→图):`stagingBuilder.ts` + `StagingCaptureHost.tsx`,自动连边到镜头。
- **AI 运镜(3D→视频)**:`cameraMoveBuilder.ts` → `CameraMoveCaptureHost.tsx` → `Scene3DTrajectoryCapture.tsx` 逐帧采 → `cameraMoveVideo.ts` IPC → `electron/video/framesToVideo.ts` ffmpeg 拼 mp4 → `attachCameraMoveToTarget` 切目标节点到 `video_ref` 并填参考。**最难最值钱的「mp4→喂生成节点」接缝已做完。**

实时操控/轨迹已有(`Scene3DFullscreen.tsx`):
- `controlMode: 'fly'`(WASD + 鼠标自由视角,`scene3dViewControllers.tsx`)——**实时操控相机已存在**;
- 轨迹系统(Catmull-Rom + 绑定 + 时间轴 + 播放头)——**录制相机路径已存在**;
- 假人 + 12 姿势预设 + 逐骨骼滑块(`scene3dObjects.tsx` / `scene3dConstants.ts` `MANNEQUIN_POSE_PRESETS`);
- 相机一等对象 + 相机视野预览浮窗(`scene3dCameraPreview.tsx`)——**「摆相机/看相机视野」已存在**。

## 3. 真正要新增的(只有三块 + 一个约束)

| # | 新增 | 复用什么 | 备注 |
|---|---|---|---|
| N1 | **实时角色驱动**:选中假人→WASD 走位 + 触发动作 | 复用 fly 控制层的输入采集 + 假人对象 | 角色用现成动作库(见 N1a),不做精细骨骼实时操控 |
| N1a | **动作库**:idle/walk/run/crouch/wave… 一键应用/触发 | 复用现有姿势系统升级:静态 pose → 动画 clip | three 内建 `AnimationMixer` + crossfade;素材本地导出 Mixamo(冻结依赖,本地缓存别在线依赖) |
| N2 | **录制 take**:边操作边录 | **复用** `Scene3DTrajectoryCapture` 离屏确定性逐帧 + `framesToVideo` ffmpeg | 实时操作→记录成关键帧(角色位移轨迹 + 动作事件 + 相机轨迹)→**回放走现有离屏渲染**(帧准、无掉帧),不引 MediaRecorder |
| N3 | **身份那条腿**:驱动视频 + 定妆图 → 锁身份 | 复用 `attachCameraMoveToTarget` 的 video_ref 接缝;新增定妆图槽 | 优先走现有生成节点 video_ref;评估接 Wan2.2-Animate 路径(本地优先,4090) |
| 约束 | **不迁框架**:R3F v8 / React 18 不动 | — | 现成 `ecctrl`(2.0)需 R3F v9/React 19,**不迁**;角色控制器自己写最小版(假人是 previz 木偶,不需 rapier 全物理)。`foot-IK` 是多人活 → **跳过,明标缺口** |

设计模式抄:`PrevizWhiz`/Act-Two 的「**相似度旋钮**」(保真↔自由)——给用户显式拿生成自由度换结构/身份贴合;`Cascadeur` 的 AutoPosing(拨几个关节 AI 解算)留作后续姿势低摩擦化的想法,不进本期。

## 4. 范围

**做(本期)**:N1 实时走位 + N1a 动作库触发 + N2 录 take(复用离屏渲染)+ N3 身份槽接 video_ref + 相似度旋钮。交互形态:在现有 3D 导演台加一个「实时录制」模式(与现有「编排/轨迹」模式并列,**不是第二套编辑器**,守 P1)。

**不做(本期,明标)**:游戏引擎级物理(rapier)、foot-IK 脚踩地、动画状态机全家桶(止步 blend tree + 几个离散状态)、面部/口型(Mixamo 无,缺口标⚠️)、手柄支持、R3F v9 迁移、Wan2.2-Animate 本地部署(本期先走 video_ref,部署列为后续评估)。

## 5. 不动项(回归保护)

- 现有「轨迹/编排模式」与 AI 运镜链路**保持可用**,实时录制是叠加不是替换;`Scene3DTrajectoryCapture` 现有调用方(`CameraMoveCaptureHost`)零行为变化。
- `attachCameraMoveToTarget` / video_ref 口径不变,身份槽是新增字段不改老路径。
- 姿势预设静态能力保留(摆静态图仍走老路);动画 clip 是新增层。
- 设计 token-only,新 UI 只写组件 className(P1/R10);单文件 ≤800 行(R9,`Scene3DFullscreen.tsx` 已 777,新模式逻辑**必须**拆独立文件/hook,不撑爆它)。

## 6. 分期(每期独立可验、可回滚)

- **S1 实时角色驱动**:选中假人→WASD 走位(平地,无物理)+ 一键应用动作库 clip(AnimationMixer crossfade)。验收:能操控假人走一圈 + 切 idle/walk/crouch 不闪 T-pose。
- **S2 录 take(复用离屏)**:实时操作记录成 keyframe 序列(角色位移 + 动作事件 + 相机轨迹同一时间线)→ 回放走现有离屏逐帧渲染 → ffmpeg mp4。验收:录一段 5s take 出 mp4,帧准、无掉帧。
- **S3 身份那条腿 + 相似度旋钮**:定妆图槽 + driving video → video_ref 喂生成;相似度旋钮映射到生成参数。验收:**真生成对照**(评测额度已授权)——粗 3D vs 带身份锚定,看跨镜身份是否更稳;若现有 video_ref 锁不住身份,评估接 Wan2.2-Animate。

## 7. 回滚

每期独立 commit;实时录制模式以独立 hook/组件接入 `Scene3DFullscreen`,出问题摘掉该模式入口即回到现有编排态,不影响老链路。身份槽为新增可选字段,空槽=老行为。

## 8. 验收门(全绿≠完成 P3)

- 五门 `pnpm run gates` 全过(R11)。
- **真机走查 R13**:走 J6 运镜 eval 同款旅途扩展——录一段角色走位 take → 出 mp4 → 喂生成 → 人眼判断结构/运镜/身份(截图判断,不是 expect)。
- **生成质量对照**(S3):evals/ 加一组「粗 3D vs 精 3D」「带/不带身份锚定」对照,量化一致性。
- 与样张逐项对账(R8)。

## 9. 风险

- **闭源 API 稀释精度**:Seedance/Kling/Veo 吃的是「参考视频」高层语义,不是 ControlNet 张量;精确 3D 喂闭源只当运动参考,精度被其理解层稀释 → 强结构控制要靠开源 VACE/Wan2.2-Animate 路径,本地优先但吃显存(24-48GB),与 Nomi 本地优先是硬约束,S3 需实测。
- **view-dependent 伪影**:粗渲染若穿模/悬空会被下游继承(呼应假人姿势校准记忆)→ N1 走位要复用现有几何自检(落地/避让)。
- **Mixamo 冻结**:动作素材本地缓存,别在线依赖;备选 AccuRig。
- **巨壳**:`Scene3DFullscreen.tsx` 已 777 行,新模式严禁内联进去(R9)。
