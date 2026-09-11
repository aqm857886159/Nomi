# director/scene/character/
> L2 | 父级: ../CLAUDE.md
> 角色骨骼系统的 three 侧：每帧管线 复位 → 动作层 → 手调偏移 → IK → 视线 → 骨盆偏移，纯数学在 model/{poseBlend,lookAtSolve,actionLibrary}，这里只负责把结果写到骨上。
> 成员清单
> characterLabel.ts: 视口/成片共用角色头顶 localToWorld 锚点，通过 sceneRefs.isWorldVisible 检查真实父链可见性；portal 骨架另用同处的工程可见性判定
> mannequinAssets.ts: 内置假人 GLB 与 9 组 Mixamo FBX 的构建 URL 单一入口；poseClipAssetFor 按动作库 id 查资源；URL 仅供渲染、不入工程；仓库不持有任何第三方二进制资产（机位机身在 entities/CameraEntity 程序化生成、泼溅场景由用户自备上传）
> mannequinSkeleton.ts: 假人骨架数学：骨名冒号变体互认、bind rest 记 userData（rememberMannequinRestPose，克隆后必须记，否则复位不幂等）、复位 = 纯 rest（applyMannequinSkeletonPose；x-bot rest 与 Mixamo bind 逐骨一致 = T-Pose）、任意模型归一成 1 单位高居中组
> characterRig.pole.test.ts: 极向量几何单测（静止位落在肢体平面外侧 / 伸直退默认方向 / 拖到另一侧末端不动）
> characterRig.ts: three 侧骨骼工具（零 React）：骨名解析、偏移右乘、offsetFromBase、两骨解析 IK（距离夹持 / 余弦定理 / 极向量定平面）、胸腔朝向、极向量绕轴、CCD、视线偏移分配、蒙皮最低点
> characterAsset.ts: 零 React 角色资产工具：builtin:* → 内置 X Bot url、FBX 判定、Mixamo 骨骼检测（CharacterEntity / ModelEntity 共用）
> poseClipLibrary.ts: 姿态库加载与采样：每个 FBX 自带骨架 + 各自 mixer，采样 = 定到时刻 t（循环取模 / 静态恒 0）抄出每根骨的四元数 + 位置；模块级单例，整个编辑器只加载一次，未加载返回 null 退回静止
> poseSnapshot.ts: 姿态快照纯数学：基名归一（mixamorig: / 无冒号 / _N 都归一）、快照带相对根的累积朝向、快照混合（smoothstep + 逐骨 slerp）、套到角色按层级自上而下用**世界增量** Δ = 帧·源 bind⁻¹ 套到角色 bind 相对根朝向再换回父局部（bind 一致时等价照抄，bind 不同的上传模型也不拧）；骨盆位移按两边 rest 骨盆方向换坐标系、按长度换单位
> useCharacterRig.ts: 每帧骨骼管线：复位 bind → 静止姿态预设 → 动作层（片段头 0.25s 从静止 / 上一片段末帧 smoothstep 淡入，尾后 0.25s 淡回，间隙 ≤0.5s 交叉）→ 记 basePoseForOffsets → boneRotations 偏移（四元数右乘；**动作片段在播时不叠**，姿态片段按关键帧对 slerp）→ IK（两骨解析 / 极向量绕轴 / 胸腔朝向 / 头 CCD / 骨盆钉脚，解完立刻把 base⁻¹·当前 写回 boneRotations）→ 视线（目标先求完整场景位置，头与目标统一到角色坐标解算）→ 骨盆偏移（挂载组；来源同偏移：关键帧 / 在播为 0 / 静止）。对外 CharacterRigApi：boneIndex / baseQuaternionOf / beginIkDrag / updateIkDrag / endIkDrag / snapFeetToGround
> SkeletonVisual.tsx: 骨骼可视化（2026-09-04 用户参考图，不再是 参考产品的线 + 大球）：每段骨一枚细菱形（八面体，宽 = 长 × 0.14，脊柱紫 / 手臂蓝 / 腿青，跳过手指与 End 骨）+ 关节小黄点 r=0.012；17 颗 FK 关节另带透明拾取球 r=0.03（DIRECTOR_BONE_KEY 标记给拾取），选中骨 / 关节红；显示 = 骨骼页聚焦 ｜ 无人聚焦且图层开「显示骨骼」，IK 模式下拾取球只在聚焦时出现；整组传送到场景根，仍与 SkeletonHandles 共用对象/祖先/图层可见性
> SkeletonHandles.tsx: IK 把手层（手 / 脚 / 头球、骨盆 / 胸腔圆环、肘向 / 膝向八面体，琥珀色选中红放大 1.3，各带引导线）：点把手只是选中（拾取在 useViewportPicking），拖动只经 drei TransformControls——工具条没选工具（transformMode 空）时不挂 gizmo；把手一律平移 gizmo、FK 选中骨骼一律旋转 gizmo 直接挂骨（偏移 = base⁻¹·当前）；靶点交 useCharacterRig 每帧解算，骨盆拖动改 hipsOffset 且两脚钉住
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
