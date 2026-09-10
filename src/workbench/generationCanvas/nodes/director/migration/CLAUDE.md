# director/migration/
> L2 | 父级: ../CLAUDE.md
> V1（scene3d）→ director 的单向迁移与 V1 数据化石：老工程只在画布快照加载时经这里走一次；AI 来导的旧词表 builder 也产 V1 形状再经迁移器落成 director 工程。本目录可用 three（曲线采样 / 层级世界变换），但不进 model/。
> 成员清单
> legacySceneBuilders.ts: AI入口所需旧数据形状的默认工程/对象/场景模板构造；只供单向迁移消费，不是另一套导演台
> legacyScene3dTypes.ts: V1 工程数据类型子集（对象 / 相机 / 轨迹 / 绑定 / 环境）+ 容错读取器 normalizeLegacyScene3D（逐字段兜底，非法条目整条丢弃）
> legacyPropSpecs.ts: V1 16 种语义道具的图元组合数据（原样入籍、只读）：car / building / tree / streetlamp / wall / suv / bus / bicycle / scooter / sofa / diningTable / fridge / washingMachine / trashBins / atm / backpack
> legacyTrajectorySampler.ts: V1 轨迹求值化石：Catmull-Rom（张力 / 闭合 / 二次贝塞尔控制点）+ 路标 timeRatio 重映射 + 绑定方向 / 相位；相机注视点 aim 轨迹 > 跟随目标 > 静态 target；fov 沿绑定线性渐变
> migrateScene3d.ts: 迁移器：假人 → 角色（中心原点 → 脚底、scale/2.5、姿态弧度→度、预设识别）、群众 → 组 + 角色（≤40）、道具 → 组 + 图元、mesh → 图元（plane 转平）、模型 / 组原样、组里的灯解成世界坐标顶层灯、相机 target → yaw/pitch + 跟随 → 看向对象、绑定按 30fps 烘成路标（含 fov）、姿态轨 → 骨骼姿态片段、locomotion → 循环动作片段、环境 / 全景 / 画幅；不迁项写进 MigrationReport.dropped
> migrateScene3dNode.ts: 画布节点级入口：kind scene3d → director、meta.scene3dState → meta.directorProject，自动出图标志原样保留；幂等
> migrateScene3d.test.ts: 手工老工程夹具逐项对账（对象 / 灯世界坐标 / 相机角度 / 路标数与 fov 端点 / 动作片段 / 环境 / 报告 / 非法输入）
> 法则: 成员完整·一行一文件·父级链接·技术词前置
> [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
