# 分镜方案可靠性自迭代

> 📎 状态：两轮模型循环已退出，交付验证中 · 2026-09-10
> 分支：fix/storyboard-reliability-loop-20260910
> 基线：初始 807c475d68f023ff4e4670bc35507b6e04048a51；交付前整合 c6fe8c608c3f91adf6d01029b87ba174ffc9870d（origin/main，含 #646/#691/#692）
> 验收：每轮 UI loopback 10 句 + 官方 DeepSeek 10 句；零媒体生成。
> 上限：5 轮，每轮 ¥1.5，总 ¥8；每轮一个 commit。
> 退出：连续两轮真实保存 ≥95% 且回合 ≥90%；或轮数/费用到顶；或同簇连续两轮无法修复。
> 交付：完整 gates exit 0、任务分支 PR、LOOP-LAST.md 与指定 scratchpad 副本。

## 用户摩擦与边界

用户要求保存分镜却遇到 surface_port_unavailable。先从最新主线 UI 重现，保留原生 pi JSONL，不把历史截图当当前复现。最新 laneHost 已允许可逆跨面流程，须验证剩余生命周期与契约。

仅修改已由轨迹证实的最早共享边界及其回归覆盖。禁止提示词润色代替修复、降低断言、直接调用工具代替 UI、真实库读写、媒体生成、绕 hook。凭证只从 DEEPSEEK_API_KEY 获取，经隔离实例设置写入。

## 先查别人

1. Claude 官方 [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)：工具结果按 tool_use_id 关联；执行失败通过 is_error 回流，使模型能纠正。用途：区分模型可恢复参数失败与宿主不可用；不靠重复自然语言提示修端口。2026-09-10 实查官方正文。
2. pi 官方 [agent-loop.ts](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts)：executeToolCalls / createToolResultMessage 将执行结果及 isError 留在原生消息链。用途：按原生 toolResult 统计，不拿 UI 文案推测成功。安装版本 @earendil-works/pi-agent-core 0.85.1，改动前再对照本地实现。
3. DeepSeek 官方 [Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)：assistant tool_calls 后必须传 role=tool 与对应 tool_call_id；strict 为 beta 端点显式能力。用途：保持现有 pi 适配契约，不擅自开启 strict 或为供应商造并行入口。2026-09-10 实查。

## 测量口径

每轮保存原生转录副本与 trace.jsonl 每句汇总：surface、用户原话来源、工具序列、isError/错误码、token、费用、写对/保存/回合判定。工具写对率以实际写调用符合请求且成功的次数/全部写调用次数计；保存率以成功保存期望变更的句数/要求保存的句数计；回合率按用户期望整体实现句数/全部句数计。重试不抹掉首败；loopback 与真实分开统计。语义通过必须对照 UI 及实际持久化，工具未报错不等于回合通过。

## 执行与回滚

每轮先跑后聚簇，新增根因先补来源再写 schema-v3 合同和 red tests，再修共享边界。保持 10 句创作/生成各半，覆盖从文稿拆、局部改、锚点、模型档位。走查语句从既有 20 句中选并补 5 句变体，案例与判据在首跑前冻结。付费使用官方已配置低价文本模型；按原生 usage 累计并记录保守上界，预算不足不启动下一句。

回滚：按轮 revert scoped commit，经 PR 评审；不重写远端历史。完整验证用 python3 scripts/with-gates-lock.py -- pnpm run gates，锁等待不中途绕行。

## 轮次结果

已完成两轮、共 40 句 UI 走查；下列记录保留严格失败判定，按退出④结束，未达到稳定阈值。

## Round 1 根因决策与审阅

真实轨迹 #3 与 loopback #3/#4 证明缺的是分镜目标身份：`proposalTxn.ts` 没传已有 documentId/storyboardId 参数；`applyCanvasToolCall.ts` 在缺 storyboardId 时 force-new，后续 patch 取旧 active/first。端口在两面均可用。修在 canvas.write 的共享 capture/admission：将文档、方案身份和内容 hash 放入已有证据，沿 proposal 传目标；审批前与 receipt.prepare 后都校验，失配即 stale。未改变任何模型提示词、SDK 格式或走查断言。

六角色复核：CTO—复用现有 admission/hash，不建独立分镜端口；设计—无控件变更；PM—保留显式新建入口；前端—选中变化不得串写；后端—旧 approval hash 与新证据不匹配会拒绝；真实用户—同名重复不能用工具绿灯洗成成功。原生转录较大，用 gzip 无损封存供完整回放，trace.jsonl 只保留工具状态摘要。官方定价来源 https://api-docs.deepseek.com/quick_start/pricing ：峰值 Flash 输入 $0.44/M、缓存 $0.014/M、输出 $1.32/M；统一乘8计人民币上界，不把 pi 未配置价目产生的0当免费。

第一轮严格指标：loopback 写对2/10、保存2/10、回合2/10；DeepSeek 写对2/6、保存2/10、回合2/10。工具执行均未报错，但重复目标和后续错目标均判失败。真实 usage 费用上界 ¥0.430618，另认证探测预留 ¥0.03。详见 [REPORT](../fixes/storyboard-reliability/round-1/REPORT.md)。

## Round 2 与退出

参见 [Round 2 REPORT](../fixes/storyboard-reliability/round-2/REPORT.md)。真实写对6/6、保存6/10、回合8/10；loopback8/10、8/10、8/10。目标身份簇复扫消失，但媒体模型缺前提连续两轮未修下，按退出④结束模型循环。尚未达到稳定阈值。累计费用保守上界¥1.082421，零媒体；完整 gates/PR 交付继续。

## 新簇先查别人

4. [GPT Image 2 官方供应商文档](https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image)，2026-09-10实查 resolution/1K/2K；Nomi 的 `src/config/modelArchetypes/gptImage2.ts:19` 使用 canonical resolution。现有冻结 loopback误填size，因此档位两句保持失败，不伪造参数写对证据。
5. [DeepSeek 模型目录与定价](https://api-docs.deepseek.com/quick_start/pricing)：官方只提供DeepSeek文本/视觉理解模型，不提供GPT Image 2。真实 UI 获取官方目录为3个DeepSeek模型。Nomi `availableModels.ts` 保持可用模型过滤，没有可用GPT媒体配置时拒绝虚构身份是正确行为；本任务不以媒体认证越过零生成约束。
