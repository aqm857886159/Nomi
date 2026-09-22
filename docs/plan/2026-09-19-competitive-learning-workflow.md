# 竞品学习与三日雷达流程

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：进行中；本轮交付规则、技能、模板和本机调度配置，未开展首轮竞品实测。

## 目标与范围

用户 2026-09-19 明确要求先构建长期流程，全面学习页面、流程、用户引导、交互、功能、图标、社区、自媒体与视频营销。核心对标 LibTV 和 TapNow；扩展对标 Higgsfield、MiniMax Design、RunningHub。表情/姿势自定义编辑、插件/CLI/MCP 的产品呈现、Blender 和 Agent 是优先研究题。

交付：仓内 `agent-skills/nomi-competitive-radar/SKILL.md` 与执行参考；`docs/research/competitive/` 来源登记、周期报告模板及入口；CLAUDE/AGENTS 触发指针；唯一 TODO 的关联项；沿用本机 Codex automation 的每三天配置。既有模型/论文雷达各自保留职责，竞品雷达负责产品与传播学习。

## 先查别人

已检查现有 `scripts/research/tikhub-search.mjs`、`docs/research/tikhub-api-notes.md`、`scripts/feedback-radar.mjs`、本机两份 `automation.toml`、`docs/ARCHITECTURE-NOW.md`、TODO 与在飞 PR。复用检索和调度能力，不新增采集引擎。技能采用 [Agent Skills 规范](https://agentskills.io/specification) 的 SKILL.md + references 布局；沿用仓库 `agent-skills/` 与 `check:skills-format` 的既有落点，无自定义外部格式。官方规范本轮未联网重读，以现有仓库格式门岗和本机 skill-creator 为实施依据；没有变更技能解析协议。

- `scripts/research/tikhub-search.mjs:39` 已有查询/平台/时间窗/输出目录参数，`:135` 固定输出 JSON/Markdown；复用采集器，但每次查询与重试隔离目录，防止覆盖证据。
- `scripts/feedback-radar.mjs:4` 已把确定性采集和技能分诊分开，`:60` 隔离单渠道失败；采用同样职责划分，竞品分析由技能完成。
- `scripts/check-skills-format.mjs:17` 已区分创作者技能库与外部宿主技能，`:24` 扫两种技能根；本技能放 agent-skills，避免出现在 Nomi 创作者技能库。
- [TikHub API 既有对账笔记](../research/tikhub-api-notes.md) 已核对四平台与凭据回显风险；采用现有密钥边界和逐平台检查，不新增接口适配。

## 取舍与边界

- 采用“全对象变化扫描 + 轮换深挖”，避免每三天重复完整拆解五家，也避免只收藏链接。
- 研究必须走鼠标/键盘与录屏；DOM/API 用于定位和取资料，不替代交互验证。脚本只能辅助，结论由证据支撑。
- 原始录屏、登录态截图、TikHub 原始结果只存忽略目录；仓库留脱敏结论、来源与证据索引。研究产出不能被误读为对外发布素材许可。
- 不改 Nomi 功能/UI、不修改用户项目、不发布内容、不合并 PR。本轮不把“有 MCP”当成“已有可用插件/CLI”，也不把竞品 Blender 宣传页当成 Nomi 已实现。
- 既有表情/姿势 TODO 未搜到同名行，按本次用户要求登记研究入口；先核对已有能力再形成实施任务。

## 验收与回滚

1. 六角色检查流程是否覆盖产品与传播；独立反方审阅检验冷启动、失败、重复运行与证据约束。
2. 技能格式与引用校验，三种情境桌面演练：正常周期、登录/TikHub 部分失败、中断续跑。演练不假装真实竞品研究。
3. 按仓库交付规则完成 Ponytail、gates、任务分支与 PR；不合并。
4. 本机配置用现有 automation.toml 形状，RRULE 为三天间隔；读取核验只证明配置存在，不证明定时任务已执行。首轮报告是运行验收证据。

回滚：撤销本 PR 的流程文件及指针，将本机该自动化置为 PAUSED；保留已经产生的研究证据，不删其它雷达或调度。
