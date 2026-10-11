# Cross-project native recovery stage

Authorized continuation of Draft PR1172, using the same checkout and branch. This bounded functional walk follows the existing runtime/UI flow; it changes no production implementation. Source: `tests/ux/nomi-cross-project-agent-recovery.walk.mjs`.

## 设计卡

- ★1 用户路径：真实新建A项目，完成一回合后再开始实际stream；回库新建B，完成独立回合；重开A确认中断内容，再退出进程，冷开B/A核对各自内容。
- ★2 权威：真实project/lane/SDK/IPC/JSONL owners；laneIpc每sender单一workspace，换项目先close。两条外部连接不等于原生并发。
- ★3 复用：现有createRuntimeWalk、生产按钮/菜单、loopback模型endpoint、laneDiskSnapshot和五层离线guard；不注入业务store或假结果。
- ★4 全状态：新场景implemented、执行后才记executed/functionalPassed；任何UI/原始全字节/隔离/guard/cleanup断言失败均exit1，原始失败目录保留。性能验收保持unverified。
- 5 可打断：A的真实stream因项目workspace replacement中断；记录实际aborted与B实际stop，不把现有互斥契约叫生产bug，不修改后台花钱/并发策略。
- 6 长跑与成本：3个loopback文本请求，0付费/图片；共享stationTimeout作为条件等待上限，没有固定sleep或放宽预算。进程由当前walk关闭。
- 7 数据：两个隔离新项目、不同真实session IDs；请求/响应不得串项目。关闭进程后拍完整原始JSONL快照，冷恢复后再次关闭，比较所有记录的完整原始UTF8字节，随后才脱敏归档供远端审查。
- 8 界面：复用现有创作/项目卡片/Agent Markdown，不新增布局。保留真实Linux/Xvfb截图；英文/窄窗/原生GPU仍未验证。
- ★9 验收与回滚：script语法、test-waits/walkthrough scanner、真实UI执行、内部只读复核、阶段commit/push及CI；不是外部验收或性能接受。回滚仅revert本阶段测试/收据，Draft不合并发布。

## 执行与收据

`DISPLAY=:97 NOMI_E2E_CHROMIUM_ARGS=--no-sandbox,--disable-gpu-sandbox node tests/ux/nomi-cross-project-agent-recovery.walk.mjs`

每次输出独立timestamp/UUID目录，含源码commit/dirty/hash、实际build stamp和workspace owner hash、完整before/after JSONL（原始字节比较后路径脱敏）、原始/归档hash、可读receipt、截图与guard日志。旧atomic性能raw和原同workspace失败收据不重跑、不改写。

此阶段只覆盖跨项目运行中切换及完整transcript冷恢复。剩余功能清单保持单独记录：其他控件、真实工具/批准/后台并发、各规模/缓存组合和完整P/D/B/C/A/R性能路径仍需逐阶段执行。
