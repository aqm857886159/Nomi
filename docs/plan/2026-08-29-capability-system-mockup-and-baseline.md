# Nomi 能力系统样张与基线执行计划

> 日期：2026-08-29
> 状态：📎 样张与当前基线已交付；生产实现等待 Agent/Skill 接线稳定后再拍板
> 上游方案：`2026-08-29-creative-capability-catalog-and-prompt-system.md`

## 目标

用当前 Nomi 真实信息架构制作一份可点击样张，并建立能力系统上线前的用户任务基线。样张回答三个产品问题：用户如何发现能力、Agent 如何调用能力、外部素材如何带着来源与权利证据进入作品。

## 本轮交付

1. 一个独立 HTML 样张，包含三个可切换工作面：
   - 能力库：筛选、能力卡片、媒体预览、Skill 详情和“用于当前任务”。
   - Agent 调用：模式选择、能力激活、结构化补问、权限/依赖/费用预检。
   - 素材权利：用途/权利/状态筛选、来源证据、项目关系和导出异常处理。
2. J1-J10 的机器可读任务定义；P0 先执行 J1-J4/J9/J10 当前基线。
3. 基线报告：记录当前入口、成功状态、失败阶段、用时口径和实现后复跑方式。

## 不动项

- 不修改 `src/`、`electron/` 或现有生产 UI。
- 不修改既有 `2026-08-28-video-recreation-experience.html` 及其素材。
- 不安装或执行第三方 Pi Extension、Skill 或 MCP Client。
- 不把 P1 的开放导入、外部 Connector 和公有市场画成 P0 已经存在。
- 不把 Skill 变成权限 owner；样张中的工具权限仍由 capability 预检表达。

## 设计约束

- 复用 Nomi 暖中性色、冷蓝紫强调色、Fraunces/Inter 字体关系和 Tabler 图标语言。
- 高密度工作面，不做营销首页，不使用嵌套卡片或大面积装饰。
- 每个工作面常驻功能簇不超过五个；低频管理动作进入详情或溢出菜单。
- 能力详情先讲用户结果，再展示输入/输出、依赖、权限、来源、版本和评测。
- PromptRecipe、KnowledgeSkill、Workflow、Connector 在 UI 中可共用发现入口，但运行语义不伪装成同一种对象。
- 桌面是主目标；窄窗口保证文字、筛选和主要动作不重叠。

## 交互验收

- 顶部三个工作面可切换，URL hash 可直接定位。
- 能力卡片可筛选、搜索和选中；详情随选择更新，预览媒体可切换。
- Agent 结构化补问必须选择关键规格后才能继续；预检能显示缺失依赖及数据去向。
- 素材可按权利异常过滤；选择素材后显示来源、许可证、作者、用途和关联镜头。
- 署名异常可在同一面处理，处理后导出异常计数同步变化。
- 1440×900、1024×768 和 390×844 不出现主要控件遮挡或横向溢出。

## 基线口径

- `success`：用户无需理解 Prompt/Skill/MCP/Plugin，能在 Nomi 内得到任务要求的持久化结果。
- `partial`：可通过聊天或手工步骤得到部分文本，但没有结构化结果、证据或项目关系。
- `blocked`：当前不存在产品入口、运行合同或持久化字段。
- `timeToOutcomeMs` 从进入任务相关工作面开始，到结果进入项目为止；找不到入口时记录 `timeToBlockMs`。
- `interactionCount` 记录点击、输入和确认；`agentTurns` 只计算用户与 Agent 的有效轮次。

## 回滚

本轮文件均位于 `docs/design/mockups/capability-system/`、`evals/capability-system/` 和本计划文档。删除这些新增文件即可完整回滚，不影响产品数据和运行时。

## 本轮结果

- 交互样张：`docs/design/mockups/capability-system/index.html`
- 样张机器走查：`node docs/design/mockups/capability-system/verify.mjs`
- J1-J10 定义：`evals/capability-system/journeys.mjs`
- 当前基线：`evals/capability-system/baseline-2026-08-29.md`
- 基线结果：0 success / 10 partial / 0 blocked；P0 就绪度 25%。
- 环境限制：本机 0 个已启用文本模型，本轮没有伪造 Agent 轮次、token、真实完成时间或模型质量；这些指标在配置文本模型后复跑。
