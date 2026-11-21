# 设计卡：MCP 收口前的五个「说的和做的对不上」（D1–D4、D6）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

线/负责人：实现线 I-mcp-fix（nomi-worker）　　类别：[花钱]（D3 改外部 Agent 的默认行为）　[新界面]（D2 改失效框主按钮的文字和行为，无新元素）　[其他]
来源：`D:/Nomi-coord-state/reports/R-mcp-close.md` 第 6 节（Codex 读码）；任务书 `D:/Nomi-coord-state/briefs/20261021/I-mcp-fix.md`。

## 开工三问

1. 14 天修过几次：D1、D3、D6 涉及的文件未命中；**D2 `ConnectAssistantCard.tsx`（第 5 个 fix）、D4 `canvasWrite.ts`（第 3 个）命中**，已写方向检查 `docs/plan/2026-10-21-mcp-close-defects-direction-check.md` 交协调（D3 的修法特意落在未命中的契约文件，没碰命中的 `storyboardPlan.ts`）。
2. 是不是我们独有的：D1 用量账是展示数据，自己的内存结构；D2、D4 是「文案派生自判据」，领域事实是「原因 → 动作」「哪些节点能当参考」；D3 是外部输入默认值；D6 是文档门岗。没有适用的现成库（D1 去重集合是 20 行内存结构，不值得引库）。
3. 补 / 换 / 删：D1 补（在途号受保护，没法「换」：去重本来就要有限历史）；D2 补（共享投影，把两处各写一份合并成一份）；D3 补（默认值写进模型入参契约一处，旧读口不动）；D4 换（手写散文 → 从闸门生成，同提交删旧句）；D6 删（Pi 一键接入的承诺）+ 补一道门岗。

## ★ 格（1、2、3、4、9）

| 格 | 内容 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 外部 AI 助手的用户：连接卡显示的用量数不重复；端口被占时按钮写得出口真能做的事；助手省略 shotKind 不会无意建出更贵的视频节点；助手按说明连线不会放弃合法的文字上下文边；指南不再承诺一键接入已删除的宿主。真实任务：①助手发起一个长生成调用，期间其他调用超过 256 个，数字不多记；②本机端口被另一份 Nomi 占着，卡上点主按钮 = 再测一次连接，不写配置；③外部助手 propose_storyboard_plan 只写 prompt 和 index，落画布是 image 节点。不做：不改旧草稿的默认值；不加新按钮；不改准入规则；不动 D5。量具：各自的反例测试 + D2 设计实验室真点击 | 测试表见下；截图路径见 PR 正文 |
| ★1b 连带界面 | D2：失效框主按钮文案（zh/en）、正文（原样）；D3：Agent 回执里节点种类变化（image）；D4：tools/list 说明；D6：指南 | 截图 / 测试 |
| ★2 谁说了算 | 用量账 → `mcpUsageRegistry`（唯一）；失效动作 → `assistantActivationState.resolveAssistantBrokenAction`（唯一）；shotKind 外部默认 → `canvasModelShapes.storyboardShotSchema`，旧数据读口 `storyboardPlanSchema` 不动；连线说明事实 → `edgeAdmission.edgeAdmissionFactsForModels`；宿主与路径 → `mcpClientRegistry`（指南只读它）。碰 5 个概念，各 1 份事实 | `node scripts/door-map.mjs <符号>`：callStarted 1 写门、resolveAssistantBrokenAction 1 读门、storyboardShotSchema 1 读门 |
| ★3 一致与复用 | 复用 `McpVerifyReason`、`handleTest`（卡上已有的测试连接）、`validateReferenceEdge`、`MCP_CLIENT_REGISTRY`；无第二份定义；不新增词条（主按钮复用 `box.test`） | `git grep` |
| ★4 全状态 | D2：失效 × 原因 × 动作表（见下），zh/en 两轨；检测中 / 已连接 / 未接入原样；D1：在途 / 已结束 / 取消 / 重复关闭见测试；D3：省略 / image / video × 新 / 旧；D4：节点种类全集对账 | 测试 + 截图 |
| ★9 验收与回滚 | 独立验收：Codex V-mcpfix；回滚：各提交独立，`git revert <sha>`；D3 回滚 = 删 `.default("image")` 一行；D4 回滚需同步重算 `model-face-baseline.json` | PR 正文 `## 独立验收` |

## D2 原因 → 动作对照表

| 原因（verify 结论 / 配置形状） | 主按钮 | 动作 | 为什么这样 |
|---|---|---|---|
| 过时形状（legacy-launcher / stale-development / auth-stale / launcher-broken） | 升级接入 | 重写 nomi 条目（installMcp） | 读配置就判死，只有重写能修 |
| command-missing / argument-missing | 修复接入 | 重写 | 启动方式指向已删文件 |
| spawn-failed / timeout / handshake-failed | 修复接入 | 重写 | 旧启动命令跑不起来，换当前版本 |
| client-auth-missing | 修复接入 | 重写 | 缺身份凭据，重写会补签 |
| **http-not-listening（端口被占）** | **测试连接** | **再验一次（已有的 handleTest），不写配置** | 配置和身份都对，重写释放不了端口；用户处理完端口后能直接复验 |
| ok / not-installed（理论上进不了失效框） | 修复接入 | 重写（保持旧行为） | 兜底，不改旧行为 |
| 指向另一份 Nomi（launcher-elsewhere） | 切到这一份 | 重写 | 原样 |

## 5 中途表（D3 改变外部 Agent 的默认花钱形状；D1/D2 无花钱）

D3 只改外部助手**省略 shotKind** 时建出什么节点；建节点本身不花钱，生成要经确认卡 / 预算，路径不动。

| 状态 \ 打断 | 关窗 | 断网 | 重启 | 连点 | 取消 |
|---|---|---|---|---|---|
| 助手提交方案（主进程解析） | 不转发，无节点，不花钱 | 不适用（本机回环） | 同左 | 幂等：相同 plan 同一结果 | 不适用 |
| 方案落画布（渲染层） | 窗口关 = 渲染层不可用，返回 capability_unsupported，无节点 | 不适用 | 草稿可回放，旧草稿仍按 video（未变） | 同一 materializationOperationId 去重（未变） | 撤销栈可撤（未变） |
| 随后的生成 | 走原有确认卡，未变 | 原样 | 原样 | 原样 | 原样 |

净效果：省略 shotKind 的新输入，从「建 video 节点（生成时更贵）」变成「建 image 节点」；显式 video 不受影响。

## 6 外部数据

外部输入：MCP 客户端传来的 `propose_storyboard_plan`。规范：工具 schema 的 `default`（JSON Schema 关键字，已在 `SUPPORTED_SCHEMA_KEYWORDS`）。偏差：无。失败：不变。

## ★7 性能：不适用——无新增用户操作；`edgeAdmissionFactsForModels()` 在模块加载时算一次（17 个节点种类 × 常数）。

## 测试表（每条修前红、修后绿）

| 问题 | 反例测试 | 修前红证据 |
|---|---|---|
| D1 | `electron/capabilityCore/mcpUsageRegistry.test.ts`「in-flight call identity survives the dedupe history cap」5 条（4 条红） | `expected 302 to be 301`；257 边界 `expected 258 to be 257` |
| D2 | `src/ui/onboarding/assistantBrokenAction.test.ts` 12 条 | 12 条全红（投影不存在）；设计实验室真点击见 PR 正文 |
| D3 | `src/workbench/generationCanvas/agent/externalShotKindDefault.test.ts` 7 条（2 条红） | `expected undefined to be 'image'` |
| D4 | `electron/shared/agentCapabilities/canvasWriteEdgeDescription.test.ts` 4 条 | 4 条全红：说明未点名文字上下文、仍含「text/shot/output 不能当参考源」 |
| D6 | `scripts/check-guide-mcp-hosts.node-test.mjs` 6 条 + 门岗对修前指南 exit=1 | 「Pi」不在注册表等 6 条违规 |
