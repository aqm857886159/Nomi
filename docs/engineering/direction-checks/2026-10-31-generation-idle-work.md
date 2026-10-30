# 生成等待时的重复工作：方向检查

症状：生成多张卡时持续绘制、整工程保存及轮询全快照叠加。直接原因：等待 shader 常驻、每次 progress bump dirty、pending 每轮更新时间和 raw 后写盘。类根因：没有区分展示观察与可恢复业务事实。

结构选择：删除等待 shader，沿用 reduced 静态灰格；setNodeProgress 只为运行身份/接管等恢复事实标脏；poll 和 envelope 的同状态 pending 不写整快照。恢复与终态始终保留。不加配置、供应商分支或回退。

验证：设计卡 ★9 的入口×事件矩阵、三处逐一还原的反例、真实隔离 App 重启接单、N=60/100 的生成中性能场景。不能用渲染帧绿灯替代保存/落盘/恢复硬断言。

## 裁定

协调询问：「生成时卡顿按三处删减来修吗？等待动画会变成静止灰格。」用户原话：「按推荐」。批准范围：等待卡不再跑 WebGL 动画、纯进度不使整个工程变脏保存、状态没变的 pending 不写完整快照。

追加协调裁定：BaseGenerationNode 只删 preset import、prop、解构、透传四处；本线同提交删 img-fx 依赖、patch、锁条目及全部 preset 类型，不留本地类型替身或空参数。该文件热点和 productionGenerationSubmission 等任务书列出的热点在本次裁定范围内。其他禁碰文件不修改。

NodeImportingOverlay 为文件级第 3 个 fix，协调按用户同一次拍板放行：仅删 preset import、解构、参数类型与透传。静态路径不增转圈或文字；后续样张另议。
