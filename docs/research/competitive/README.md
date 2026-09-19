# Nomi 全方位竞品学习

> 状态：长期流程；2026-09-19 建立。首轮产品研究尚未执行。

**核心对标 LibTV 与 TapNow。** Higgsfield、MiniMax Design、RunningHub 用于扩展学习。范围包括完整产品体验和传播体系：页面、图标、动效、引导、流程、功能交互、Agent、插件生态、社区、定价、自媒体与视频。选择适合 Nomi 的机制，不按竞品功能数量追赶。

## 执行入口

- [技能](../../../agent-skills/nomi-competitive-radar/SKILL.md)：可说“按 nomi-competitive-radar 跑本轮三日雷达”或直接让执行者读此文件。
- [执行规程](../../../agent-skills/nomi-competitive-radar/references/protocol.md)：扫描、TikHub、真实鼠标/录屏、轮换与验收。
- [来源登记](sources.md)：核心材料、身份核验与待补入口。
- [报告模板](TEMPLATE.md)：每轮复制为 `docs/research/competitive/<cycle-id>/report.md`，逐卡保存，不等全做完才落盘。
- [落地方案](../../plan/2026-09-19-competitive-learning-workflow.md)：本轮范围、验收与回滚。

技能正本在仓库 `agent-skills/`，供研发/研究宿主使用，不装进 Nomi 面向创作者的技能库。支持链接的本机宿主可把这个目录链接到自己的 skills 目录；其它环境由 AGENTS 指针显式读取。不要维护第二份正文。

## 节奏与初始优先题

每 3 天检查五家全部来源的变化；每轮深挖 LibTV/TapNow 各一条完整旅程、轮换一家扩展对象，并拆两条真实内容。四轮复盘一次维度覆盖和实验反馈。登录/录屏/接口失败记缺口，不能混成“无变化”。

第一轮优先：

1. 表情、姿势的自定义编辑：发现入口、预设到精调、预览、撤销、保存/复用/生成参考。先确认双方真实支持面。
2. 插件/CLI/MCP：LibTV 插件页面怎样传达价值、引导安装和验证成功；Nomi 已有 MCP 的真实能力如何对应软件内与官网入口。
3. Blender：用户给定的 LibTV Blender 页面及其安装/使用/结果回流。Nomi 是否已有对应集成待核实，不能预设已实现。
4. Agent：如何告诉用户能做什么、用了哪些素材、正在做什么、结果在哪里、如何修改与补救。
5. 自媒体：从功能更新到教程/作品案例/短视频、评论问题、官网落点和首次使用，追一条完整路径。

这些是研究题，不是本轮开发授权；任务归档到 [唯一 TODO](../../roadmap/TODO.md)。原桌面竞品方案包 T-ED-05 仍需单独盘点，建立本流程不等于已经收录该包。

## 调度与归档

本机沿用 Codex automations，配置目录 `~/.codex/automations/nomi-competitive-radar/automation.toml`，独立 cron 任务，时区 Asia/Shanghai，每 3 天 10:00。配置用带 TZID 的 DTSTART 固定首轮锚点，本机设为 `2026-09-22T10:00:00+08:00`。调度器可能附加少量抖动；机器休眠/未启动不保证准点，下一次 Nomi 会话按技能补跑。配置存在不等于首轮已执行，以报告与运行记录为准。

仓库规则触发和定时器读取同一份规程，用稳定主仓 `outputs/competitive-radar/` 做互斥、原始证据与中断检查点。报告在 PR 未合时也参与去重；原始数据不随 worktree 清理。可公开的摘要、证据索引进本目录，其余留本地，保留来源和 SHA-256。

本轮仅验证流程可读、技能可加载、模板可填写及本机配置可解析。首轮定时触发、TikHub 账号可用性、五家登录态、实际录屏与结果质量均待运行验证。
