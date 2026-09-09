# Round 1 · 基线 UI 走查与目标绑定修复

基线 807c475d6。全新隔离项目；创作/生成各 5 句，零媒体。原生 pi 文件为无损 gzip；逐句按输入次序定位，trace.jsonl 关联文件及 SHA256。模型认证另预留 ¥0.03（单次文本连通探测，未返回 usage），10 句 DeepSeek 峰值/汇率8上界 ¥0.430618，总上界 ¥0.460618。

| 模式 | 工具写对率 | 分镜保存成功率 | 回合成功率 |
|---|---:|---:|---:|
| loopback | 2/10 = 20% | 2/10 = 20% | 2/10 = 20% |
| DeepSeek 官方 V4 Flash | 2/6 = 33.3% | 2/10 = 20% | 2/10 = 20% |

工具均 isError=false，指标严格要求目标正确；没有写工具的回合不能算保存成功。沿用来源 #16 的严格口径：未说明新旧关系的同名重复方案不算成功；#7 仍落旧方案，不能以 prompt 已含夜景判通过。

| 簇 | 证据 | 处置 |
|---|---|---|
| surface_port_unavailable | 两种模式零次 | 旧候选已由主线修复，不重复改 laneHost |
| storyboard target missing | loopback #3/#4/#8/#9 新增同名；真实 #3 新增同名，后续 patch 修改旧方案 | capture→admission 绑定文档/方案及内容 hash；proposal 传已有显式目标参数 |
| model unavailable | DeepSeek #4/#9 无 GPT Image 2 可用条目，未执行写入 | 隔离实例没有媒体凭证/认证；不得用媒体认证越过零生成约束，不伪造成功 |
| clarification/no-op | DeepSeek #6 询问保留旧偏好，#8 称已满足而不写 | 原样留存，不改提示词冲绿 |

修复位于 canvasWriteEvidence.ts 的 batch evidence/hash、canvasWriteTarget.ts 的 captureStoryboardTarget/executeCanvasWriteTarget、proposalTxn.ts 的显式 storyboardTarget 传递。新测试先红：重复方案、审批期间换选中/改内容；另一个 red 锁住 receipt.prepare 间切方案。原有“全新拆镜不覆盖已确认方案”测试保持不变。

81项相关回归通过，根因合同检查通过；构建通过。尚未用修复后 UI 复扫；进入 Round 2。媒体目录缺前提若第二轮仍无法满足，按同簇两轮无法修复退出，明确未达稳定阈值。

更正：认证探测使用 verifier.ts:32 的 2048 输出上限，保守预留改为 ¥0.03（实际 usage 未提供），非先前 ¥0.01。模型档位 fixture 的 params.size 不符合 GPT Image 2 canonical resolution（src/config/modelArchetypes/gptImage2.ts:19），#4/#9 保持失败，第二轮仍冻结相同输入，不改夹具换绿。

定位：electron/shared/agentCapabilities/canvasWriteEvidence.ts:101；src/workbench/generationCanvas/agent/canvasWriteTarget.ts:80、:283；src/workbench/generationCanvas/agent/proposalTxn.ts:254；src/workbench/generationCanvas/agent/canvasWriteTarget.integration.test.ts:289、:303、:316。
