# Round 3 · 隔离前提与真实目录投影

基线 PR #698 / 1e2affc2de1e。原10句逐字不变，创作/生成各5句；本轮合成文稿为同一故事缩写（见原生 read_full_text），后续轮次冻结同一缩写。这个输入差异明确保留，不能把与前两轮所有变化归因于代码修复。

| 模式 | 工具写对率 | 分镜保存成功率 | 回合成功率 |
|---|---:|---:|---:|
| loopback | 10/10 = 100% | 10/10 = 100% | 10/10 = 100% |
| DeepSeek 官方 V4 Flash | 9/9 = 100% | 9/10 = 90% | 10/10 = 100% |

真实费用上界 ¥0.542718336（沿用官方峰值单价与USD/CNY=8；无额外认证请求）。零媒体工具调用、零媒体生成。真实第7句没有写工具：重拆后的第3镜已经是夜景，诚实no-op只计回合成功，不计保存。所有实际写调用均成功且符合对应目标；前后磁盘保持同一方案身份。

## 聚簇与根因

- GPT Image 2不可用：prepareIsolation复制真实catalog设置后，APIMart条目在真实Electron为published且有凭证；只复制设置，未访问真实项目。DeepSeek沿用上一轮官方加密凭证，隔离中只启用官方文本模型，避免同名APIMart文本模型被UI合并后误选。#4/#9均成功，分别落盘resolution=1K/2K。
- 夹具size错误：`argsFor`由真实`projectAgentRuntimeModels → toCatalogModelOptions → buildAgentModelEntries`的mode.params导出字段，不再手写size。两个供应商×两档以及缺前提测试先红后绿。schema-v3合同`2026-09-10-storyboard-fixture-projection`；没有修改生产提示词或放宽断言。
- 幂等no-op：#7是正确行为，不能为保存指标强制写同值。继续观察，不做无根据的生产修复。
- 准备期UI遮挡：首个loopback选模型后忘关弹层，确认按钮被挡。失败截图与轨迹保留`setup-attempt/`；关闭正常弹层后完整复跑，无付费。真实准备首次模型标签未找到，未发送模型请求，日志保留`.tmp/storyboard-r3-deepseek.log`。

## 先查别人、验证与下一轮

沿用前两轮实查的DeepSeek tool_calls/官方定价、GPT Image 2供应商文档；内部投影才是canonical字段真源，详见`docs/plan/2026-09-10-storyboard-reliability-rounds-3-5.md`。新增回归2/2通过、根因合同检查通过；本轮无生产运行时修改。原生转录与前后快照无损gzip，trace的nativeSha256可复核。截图经人眼核对第4句1K保存与最终方案；工具无错误不替代持久化判据。

未达到保存≥95%；进入Round 4。最终完整gates结果见LOOP-LAST.md。
