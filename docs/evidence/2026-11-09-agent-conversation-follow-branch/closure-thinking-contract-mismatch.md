# 收尾走查：C77与旧计数冲突

origin/main f88b7f042已无冲突合入，merge HEAD eb5f50800；构建通过。中文thinking-overlap实际失败：旧走查第105行要求2个`[data-v4-block="thinking"] details`，实际1个。原计数没有改，英文和后续步骤未继续。

这与已接受的两条70px已知限制无关。中文本次的early/streaming/complete重叠数组均为空，注入重叠的阳性探针也检出碰撞；不能把这些局部结果当整条通过。冷恢复与展开折叠检查在计数断言之后，未执行。

既有`agentPanelV4Collapse.ts`明确注释“Thinking is one process-level disclosure”，将N段思考合并为一个过程级明细。配套`agentPanelV4Collapse.test.ts`的C77用例明确expect思考明细长度为1。两文件相对固定修前main22df46ad6无diff，因此不是本PR或本次merge新引入的2→1行为。旧walk另有冷恢复后的第二个期望2，亦未修改。

本轮授权禁止改产品、判据、预算和门岗。把旧断言2改成1需要触及走查判据；把产品改回两颗又违背既有C77合同且不在本轮范围。故停止、不重跑碰绿、不改断言。建议协调明确授权按C77对齐旧走查后再补中英与冷恢复；本线没有实施。

[实际结果](closure-thinking-zh-result.json)、[亲眼查看的完成阶段截图](closure-thinking-zh-complete.png)。英文、修前B图、完整typecheck、完整快检和本轮正文预检均未执行；临时main搭建/依赖成功，未启动补图，不能写成搭建失败。
