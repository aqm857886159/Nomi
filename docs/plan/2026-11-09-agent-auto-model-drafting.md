# 自动选时由 Agent 点名模型起草

## 设计卡

### ★0 调研先于实现（2026-11-09）

- [MCP pagination](https://modelcontextprotocol.io/specification/latest/server/utilities/pagination)：原文 “Treat a missing `nextCursor` as the end of results”。目录发现继续复用现有 list_models；确认不按宿主目录排序挑模型，不新增目录协议。
- [Anthropic tools](https://www.anthropic.com/engineering/writing-tools-for-agents)：原文 “Returning meaningful context from tools back to agents”。确认在实时模型索引里交付默认缺席这一事实，错误 Next 给具体参数与重试路径；脚本夹具不能证明真实模型会遵从。
- [pi 逐层对照](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md)：工具定义、执行、结果和上下文分层；pi 仅有驱动 LLM 的默认，生成任务默认是 Nomi 领域语义。确认保留 resolver 为唯一解释者，formatDeclaredDefaults 为唯一提示投影，不另开工具或生命周期。
- 清单六条教训已读：不改工具名或 schema；清除旧的去设置祈使句；模型索引、失败 Next、面板分别面向各自受众；走查仍通过真实起草工具与真实面板，真模型评测留未验证。
- 出口：不涉及新增或扩大拒收；同样的未点名请求仍拒，Agent 从目录点名后重试。批准方式与花钱门不改。

### ★1 用户怎么用

当模型菜单是自动选，我让 Agent 起草雪夜木屋或灯塔视频，希望它替我点名适用模型、在卡上显示并用界面名字说清，免得再去菜单选。流程：自动选 → 提出只起草请求 → Agent 读实时索引 → 从目录点名 modelId → 起草卡保留型号 → 聊天汇报显示名。量具：laneModelContext.test.ts 的无默认/部分默认/未读取矩阵、generationProblem.test.ts 的可执行 Next、agent-generation-problem.walk.mjs 的真实起草和 zh/en 面板截图。真实模型遵从率 unverified，本轮禁止真模型。

连带：失败面板仅说无可用图片/视频默认，本轮删菜单指路；成功复用原卡，不新增预览。老用户设置、项目、候选与历史信封格式不改，已保存默认仍优先；旧 next 值仍可读（如保留兼容值），不迁移磁盘数据。

### ★2 谁说了算

createGenerationDefaultModelResolver 仍是默认值唯一 owner；readLaneDeclaredDefaults 一处供给，formatLaneModelIndex 的 formatDeclaredDefaults 一处表达。door-map：索引 3 门（实时 laneHost、历史压缩 laneContextBudget、目录增量自身），默认读取 1 门 laneDesktopRuntime；no_default_model 的词面不是函数，脚本计 0，沿 refuseGeneration 的 4 文件/8 次调用核得该码 3 个直接抛出点（semanticGenerationCandidate 1，mcpGenerationMultiShot 2）。实时 defaults={} 才可断言无默认；defaults=undefined 表示未读取，目录增量和历史压缩不得伪造缺省。list_models 只有目录事实，不读用户默认。declaredDefaultDeviations 只报告已保存默认和实际候选的差异，缺省时不造默认。

### ★3 既定方向与选择

沿已批生成请求链方向检查与用户本次决定：保住创作者无需二次菜单选型、花钱仍按批准方式。原来的“宿主不按目录猜花钱模型”注释保留。沿原实现修改共享提示与 Next；不换成宿主自动挑（违反决定）；删面板菜单指路，不能删安全拒收。复用现有候选、卡片和显示名，不加依赖。

### ★4 状态

有默认：省略 modelId 仍按保存默认；实时无默认：明确 Agent 必须点名并回话报显示名；未读取：不宣称无默认；仍漏填：no_default_model 且模型 Next 指点名重试，面板只留原因；成功：原卡型号；无可用目录：安全拒收，不能猜；取消/加载/过期/部分成功：原流程不变。

### ★9 动手前验收合同

- 新增测试先红一次：图片/视频四任务缺省、部分默认、defaults 未读取不误报；默认优先和用户点名不变。
- 未点名+无默认依旧 no_default_model，charged=false、生成请求为 0；Agent 点名的现有模型能起草成功并保留该身份。
- 模型正文与 Next 都指向 list_models、modelId、界面显示名，不再让用户去设置。
- zh/en no_default 面板只留原原因，旧菜单指路键和调用删除；更新 after-03 两图，再拍脚本 Agent 点名成功原卡图并逐张看图。
- typecheck、check:i18n、相关单测、模型工具三门岗及预推送快检。真模型不跑，报告给协调只起草的最小调用；单一检查连续红三次、钥匙串新进程、磁盘低于阈值或两小时则停并报告。
- 回滚：仅还原本地范围提交；不改花钱门、批准方式、S2–S4、不推送。
