# 计划卡与技能 chip 修复后的真机截图（2026-09-25，Windows 11，开发构建）

对应方案 [2026-09-24-stale-tool-name-lists](../../plan/2026-09-24-stale-tool-name-lists.md)。

| 图 | 看什么 |
|---|---|
| `walk-plan-card-with-preview-band-zh-CN.png` | 走查 `agent-real-user-conversation` 第 12 张：剪辑面上 Agent 的字幕计划是一张**计划卡**（「这些要做吗？不勾就是不做」），逐条人话，只有「确认」，时间轴 0–2 秒画出待定虚线色带 |
| `zoom-timeline-plan-card-zh-CN.png` / `-en.png` | 同一张计划卡的中 / 英文特写：`data-kind=plan`，「不再问」按钮 0 个 |
| `zoom-skill-chip-zh-CN.png` / `-en.png` | 挂「分镜规划 / Storyboard planning」发送后，气泡 chip 与「已载入技能 / Skill loaded」都印技能库里的名字，不是 `workbench-storyboard-planner` |

特写由一次性截图脚本生成：与两条登记走查同一套 loopback 夹具和 `data-*` 选择器，只在开项目前把界面语言切成 zh-CN / en。
