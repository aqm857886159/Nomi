# 真人动作 → 3D 角色驱动：开源调研备忘（深度节点 v1 之后的立项输入）

> 日期：2026-09-06 · 状态：🧊 备忘存档（立项排在深度视频节点 v1 之后）
> 背景：深度视频节点 v1 会产出 `poses.json`（MediaPipe 2D 骨架，无身份）。本文回答：这套骨架数据将来怎么驱动 Nomi 的 3D 角色（scene3d/model3d 线），市面开源谁能拼、怎么拼、做到什么质量。

## 1. 先把"动作迁移"分成三类（避免拿错对标物）

| 类 | 做什么 | 代表 | 是否真 3D | 与 Nomi 的关系 |
|---|---|---|---|---|
| A. 像素级角色迁移 | 模型"画出"新角色做指定动作，输出**新视频** | Wan-Animate / SCAIL-2 / Seedance·Kling 视频参考 | ❌ 视频生成，无 3D 资产、不能转镜头 | **深度节点 v1 的 video_ref 闭环就属此类，不涉及 3D** |
| B. 3D 角色替换进原视频 | 保留原背景，主角换成 3D 角色并复刻动作 | **Motionshop**（阿里，官方开源，魔搭可在线） | ✅ 真 3D（SMPL 拟合 + 角色库 + 渲染合成）| 方向参考；重依赖（torch/CUDA/TIDE），且语义是"替换进原视频" |
| C. 3D 角色动画资产 | 把动作套到**自有 glb/3D 模型**上，自由镜头、可导出 | OpenMMD / Real-Time-Motion-Transfer-to-a-3D-Avatar / AViMO | ✅ 真 3D 资产级 | **与 Nomi 最契合**（角色=model3d/自有 glb），且天然无肖像/版权问题 |

> 用户问"缺的 3D 那一环"= C 类（顺带参考 B 的质量）。A 类不是 3D，Nomi 已由 video_ref 闭环覆盖。

## 2. C 类（含部分 B）开源盘点

| 项目 | 干什么 | 成熟度 / 代价 | 接入评估 |
|---|---|---|---|
| **Real-Time-Motion-Transfer-to-a-3D-Avatar**（BlazeWild，GitHub）| MediaPipe + DNN 校正 + Three.js，把 webcam/视频动作套到 ReadyPlayerMe glb 角色；17 关键点映射、Kalman 平滑、WebSocket | 轻量、真开源；hobby 级，无批量渲染/导出 | ⭐ 最小闭环参照：2D pose + 启发式 lifting + 骨骼映射 + Three.js 驱动 skinned glb，与 Nomi scene3d(R3F) 栈同源 |
| **OpenMMD**（AvatarWorld）| OpenPose → 3D pose baseline → 深度 → VMD → MMD 模型 | 老（2018）、Windows、整包 ~5GB、OpenPose 依赖重 | ❌ 技术债高、生态锁 MMD |
| **AViMO / SMPL 系**（4D-Humans、PyMAF-X、ExAvatar）| 单目舞蹈视频 → 可动画 3D avatar（SMPL/高斯）| 学术级：torch/CUDA/PyTorch3D、常需逐 subject 拟合 | ❌ 太重，违背 Nomi 本地轻量哲学；质量目标参照即可 |
| **Motionshop**（阿里 aigc-apps，B 类）| 原视频背景保留，主角替换为 3D 角色；SMPL 姿态 + 角色动画 + 光照 + TIDE 渲染 | 官方开源 + 魔搭 demo；链路长、模型体积大、分钟级/15s 片 | 方向与视觉目标参照；整链搬入不现实 |

**2D→3D lifting 基础件**（拼装 C 类时的中间件）：MotionBERT（有 ONNX，可本地跑）、VideoPose3D/SimpleBaseline（经典）、WHAM（3D 人体运动，2024）。**2D pose 源**：MediaPipe Pose（深度节点 v1 已选定，同源）。

## 3. Nomi 拼接路线（缺的其实只有一小截）

已有：
- `scene3d` 的 R3F/useGLTF 渲染栈 + `frames-to-video` IPC（3D 场景镜头 → 视频管线现成）
- `model3d`：文生/图生 glb 角色资产（RunningHub 混元/HiTem/Meshy）
- 深度节点 v1：MediaPipe pose（2D 33 点）+ `poses.json`（骨架数据输入）

缺口（v1 之后补）：
```
pose.json(2D) → 3D lifting(启发式深度/MotionBERT-ONNX) → 骨骼 retarget 到目标 glb → R3F 驱动 SkinnedMesh → 现有 frames-to-video 出片
```
前提校验：目标 glb 必须**带骨骼绑定**（skinned mesh + 与 MediaPipe/人类骨架可映射的命名约定；mixamo 系命名最顺），Nomi model3d 产出的 glb 是否绑骨需实测。

## 4. 两档目标

- **轻量版（先做，几个周末级）**：MediaPipe(已有) → 启发式 2D→3D + Kalman 平滑（参照 Real-Time-Motion-Transfer）→ 简易 retarget 到 mixamo 命名 glb → R3F 播放 + frames-to-video 出片。够用场景：让自有 3D 角色"跳参考视频的舞"，自由镜头。
- **质量版（后续按需）**：上 SMPL 拟合（4D-Humans/PyMAF-X 级）+ 正规 retarget（MotionBERT/WHAM lifting），逼近 Motionshop 观感；代价是 CUDA/大模型依赖，违背轻量哲学，需产品上另行论证。

## 5. 建议立项顺序

1. **深度视频节点 v1**（本 plan）先完成——产出 pose.json/骨架视频资产。
2. 验收 v1 后，本备忘转正式 `docs/plan/2026-09-xx-3d-avatar-motion-node.md`：目标 = scene3d 方向的"3D 角色动作驱动"节点（输入：glb 角色 + pose.json/骨架视频；输出：角色演绎 mp4 资产）。
3. 先做轻量版最小闭环（一条真实 glb + 一条真实舞蹈 pose 出片），再决定是否升级质量版。

## 附：来源
- Motionshop：官方主页 aigc3d.github.io/motionshop / 魔搭 studio Damo_XR_Lab/motionshop
- SCAIL-2（清华）：github.com/zai-org/SCAIL-2（端到端视频驱动角色动画，属 A 类扩展参考）
- Real-Time-Motion-Transfer-to-a-3D-Avatar：github.com/BlazeWild/Real-Time-Motion-Transfer-to-a-3D-Avatar
- OpenMMD：github.com/AvatarWorld/OpenMMD
- AViMO：github.com/AreinDaralnakhla/AViMO
- 2026-09-06 当天 WebSearch 综合（条目以链接为主，未逐项跑代码验证 license/依赖，立项时需 R5 逐项对官方仓库复核）
