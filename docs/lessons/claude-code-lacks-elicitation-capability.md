# MCP elicitation 的支持面：CLI 已支持，桌面客户端仍普遍不支持（旧结论已反转）

> 📎 教训 · 首次记录 2026-08-18 · 状态：⛔ 已反转（2026-08-24 修正）
> **触发场景**：要设计任何依赖 MCP `elicitation/create` 的确认通道；或看到「Claude Code 不支持 elicitation」这句被当成前提引用。

**现结论（2026-08-24）**：

- **Claude Code CLI ≥ 2.1.76（2026-03-14）已支持** `elicitation/create`（含 Elicitation / ElicitationResult hooks）。
- **桌面客户端仍普遍不支持**：Claude 桌面 App 不支持（anthropics/claude-code#41110）、claude.ai 未落地、Codex 在途且不可靠（自报支持但有自动拒的已知 bug openai/codex#11816）、国产桌面客户端普遍不支持。
- 因此**桌面端的主流现实 = 无 elicitation**。2026-08-24 用户明确：主战场是桌面客户端，所以把 GUI 兜底卡升级为系统级置顶小浮窗，不要求用户回 Nomi 主窗。
- 用户 CLI 版本 < 2.1.76 时，旧结论对他仍成立。

**当初为什么会误判**（这才是教训）：2026-08-18 的实测结论是「Claude Code 不声明 elicitation 能力」。这条**当时是真的**，但它被当成了一条关于产品的**恒定事实**记了下来，而实际上它是一条**带版本的、会过期的观测**——客户端在 2026-03-14 就补上了这个能力，结论静默失效了一个多月，期间一直被当作设计前提引用。凡是「某客户端 / 某 SDK 支不支持 X」的结论，都必须**连版本号一起记**，并且在再次引用前重验（这正是 `CLAUDE.md` R5「不凭记忆判断能力 / 新旧」的实例）。叠加的第二个混淆源见 [MCP 侧改动必须重新打包 app 才看得到](mcp-fixes-need-repackaged-app.md)——探针没弹确认，也可能只是装机版还是旧的。

**探针方法**（不用读代码、不花额度，仍有效）：新建项目后调 `nomi_add_nodes` 加 2 个节点——满足 elicitation-first 方案的全部确认条件（App 开着、节点数 ≥2、项目信任干净）。**直接返回 ids、没弹确认** = `clientSupportsElicitation === false`。

**怎么用**：

1. 讨论确认通道时按矩阵走：CLI ≥2.1.76 支持 / 桌面 App 与多数桌面客户端不支持 / Codex 不可靠。
2. **待办**：Nomi 侧尚未用新版 CLI 真机验过 elicitation 路径，验完回写这里。
3. 验证 elicitation 改动仍用**自声明能力的假客户端走查**（`tests/ux/spend-elicit-app-open.walk.mjs` 范式），别靠手动在客户端里点。

**出处**：2026-08-18 首测（结论已失效）、2026-08-24 反转修正；anthropics/claude-code#41110、openai/codex#11816。相关：[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)、[走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)。
