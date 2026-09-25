# 分镜可靠性第 3–5 轮

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：执行中。接 PR #698（仍 OPEN），基线 447e48949d70936e4eb8616b37d85d366ba1dfcc。

## 范围与验收

原10句及严格三指标不变；每轮 loopback 后官方 DeepSeek，各10句。每轮≤¥1.5，本单≤¥5，零媒体生成。连续两轮真实保存≥95%且回合≥90%，或第5轮/预算到顶，或同簇两轮不能修复退出。真实库不可读写；按本单授权只由 prepareIsolation 复制设置目录里的 catalog，规划模型沿用上一轮官方 DeepSeek 隔离凭证。

根因分类 recurring：评测手写模型参数绕过真实档案，另一个档位/供应商也可漂移；隔离配置缺失是环境前提，不能归咎产品或用改断言掩盖。先在跑之前确认真实投影含可用 GPT Image 2，再支付文本费用。

## 先查别人与共享边界

1. DeepSeek官方工具调用：https://api-docs.deepseek.com/guides/tool_calls 。沿用上轮已实查来源，工具错误回流给模型修正，不取消共享验证。
2. DeepSeek官方定价：https://api-docs.deepseek.com/quick_start/pricing 。沿用峰值Flash输入/输出单价和缓存单价，USD/CNY=8记录费用上界。
3. GPT Image 2供应商官方契约：https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image 。官方resolution档位经 src/config/modelArchetypes/gptImage2.ts:19 映射为canonical参数，供应商线缆字段不能直接塞计划。
4. 已有真实投影：tests/ux/agent-runtime-fixture.mjs:283 调用toCatalogModelOptions和buildAgentModelEntries；复用既有共享边界，不重造目录。

现有 tests/ux/agent-runtime-fixture.mjs:283 projectAgentRuntimeModels 已调用真实 toCatalogModelOptions → buildAgentModelEntries。复用此边界投影目录，argsFor 从投影的 mode.params 找实际允许该档位的键；删除手填 size。同类入口扫描包括模型1K/2K两句、普通图片 fixture 与真实 Electron 目录。工具调用保持原 operation，不改用户提示词。

不改生产UI、模型提示词、验证断言或生成调度。不为本任务重造模型目录。回滚按轮 revert scoped commit。每轮保存原生轨迹、磁盘前后快照及截图；最终完整 gates 使用指定锁命令，提交/推送遵守 Ponytail。

## 第3轮准备证据

新增两条测试先红（`.tmp/storyboard-r3-red.log`），修复后2/2绿；根因合同检查通过。隔离应用实际 listModels 显示 APIMart GPT Image 2 published=true；官方 DeepSeek 复用上一轮 vendorKey=deepseek-official 加密凭证。真实用户 catalog 内已有同名 APIMart Flash，因此隔离设置只启用官方文本模型，避免 UI 合并后的默认供应商选择误跑代理。未改变生产筛选逻辑。

首个 loopback 准备尝试选完模型未关弹层，确认被遮挡；失败截图和未结束工具轨迹保留 round-3/setup-attempt。关闭真实模型弹层后重新跑完整10句，无付费重试。真实准备首次在模型选择处停止，未发模型请求。第3轮合成文稿为同一故事缩写，原10句逐字不变；后续轮次继续冻结该缩写，不能把与前两轮的数字差异全部归因于产品修复。

## 第4轮结论

真实10/11工具写对，10/10保存与回合。唯一首败为modelVendor遗漏，共享schema正确拒绝并由模型恢复；不改安全校验或提示词。保存及回合首次达标，进入第5轮。费用¥0.467599488，累计¥1.010317824。

## 第5轮与退出

真实写对7/10、保存7/10、回合7/10；#3澄清未写、#8只改prompt未挂锚、#9改2K时顺带补第3镜锚违反局部范围。到第5轮上限退出，未达连续两轮阈值。¥0.374534912，本单合计¥1.384852736。剩余结构化意图/字段范围约束未解决，不能以最终方案正确替代逐句成功。#698执行期间已合入，将从最新origin/main新分支移交3–5轮提交，完整gates后新PR。

## 整合后全量验证修正

完整contracts首轮只因来源没有列成条目失败，整理原有来源后通过。全量12004项另发现#698的selection-race测试实际调用addStoryboardDesign；#696让该操作投影画布表，于是准备收据时触碰写锁，未走到原本要测的选择变化。先红证据`.tmp/storyboard-r2-race-red.log`。测试改为准备前建两份方案，onPrepare只走真实setActiveStoryboardId；原三个断言全部不改，相关14项通过。这里修测试场景漂移，不声称验证了准备收据时创建新方案的完整事务行为。此后重跑完整gates。
