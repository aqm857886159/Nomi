# 设置页删冗余 1–8 条：方案（2026-09-14）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实施（PR #781 `fix/settings-remove-redundant-sections-20260914`）。
依据：设置页逐控件审计（scratchpad `settings-audit/report.md` §①/§②/§⑥，用户 09-14 拍板「1–8 全删，第 6 条另派」）；结构评审 `docs/audit/2026-09-14-settings-policy-owners-structural-review.md`；根因合同 `docs/fixes/2026-09-14-settings-allowlist-default-deny.root-cause.json`。

## 1. 要解决的真实摩擦

设置页「AI 策略」3.5 屏、「自动化与权限」2 屏，里面三份状态各自多长了一个「让用户手填」的副本：允许哪些供应商/模型（161 个复选框，默认空 = **全拒**，新装 Nomi 走 MCP 代跑必被拒）、用哪档（三段里两段行为相同、与 Agent 面板档位互不联动）、以及六个零读者的契约字段渲染成不可点的徽章和死开关；系统提示词是活功能却住错了 tab。

## 先查别人

> 四问：依赖框架 / 同类仓库 / 生态 / 自媒体。**本次没用 TikHub**：题目是「设置页里一份状态该不该有第二个 owner」，是工程结构问题，不是用户可见的创作体验，自媒体里没有可采的证据面。

| 来源 | 它已经说了什么 | 本轮怎么用它 |
|---|---|---|
| Claude Code 权限设置文档 <https://code.claude.com/docs/en/settings>（`permissions.allow` / `permissions.deny` / `permissions.ask`） | 允许清单**默认为空且空 = 逐次问**，不是空 = 全拒；拒绝是显式写进 `deny` 的例外清单 | 定性了我们那张白名单的病：空值语义和用户心智相反。修法不是把默认改成「全允许」再留那张表，而是删掉表——我们已有逐次确认（付费卡），没有第二个 owner 的位置 |
| OpenAI Codex CLI 配置 <https://github.com/openai/codex/blob/main/docs/config.md>（`approval_policy` = untrusted / on-failure / on-request / never，`sandbox_mode` 独立一轴） | 「问不问」只有**一个**档位设置，而且和「能做什么」（sandbox）刻意分成两根轴，不折在一起 | 我们给 Codex 写配置时已经照它的模型走（`electron/capabilityCore/mcpConfig.ts:334` 只写 `default_tools_approval_mode`）；自家却在设置页另存一份三档 `mode`。删 `mode`，档位唯一 owner = Agent 面板 `PermissionTier`（`src/workbench/ai/v4/agentPanelV4Types.ts:312`） |
| 本仓 `electron/shared/agentCapabilities/capabilityApprovalPolicy.ts:38`（“kept independent deliberately”：`mode` 与 `spend` 两根轴故意分开） | 花钱那根轴三档全是 confirm（09-10 拍板「钱的闸 = 每次提交看报价确认」） | 于是「未知估价按 policy-auto 拒」这一分支在产品上不存在，随 `mode` 一起删；未知估价的 fail-closed 由 `submissionOutbox` 的 `costCeiling` 兜 |
| 本仓 `docs/fixes/2026-09-12-spend-card-model-swap-blocked.root-cause.json` | 同一张白名单两天前刚拦过真人在付费卡上换的模型；那份合同把设置侧的表判成「用户自己在改、不存在拦住他」 | 事实是没人会去勾 161 个框——同一类形状（允许集另存一份让人填）第二次咬人，判 recurring；本轮删副本而不是改默认值 |
| 本仓允许集已有的两个真 owner：草稿按候选圈定 `electron/productionRun/productionGenerationOperationStore.ts:88`、收据按用户批准的计划推导 `electron/productionRun/productionRunRepository.ts:458`；目录接入状态 `electron/catalog/modelCatalogListing.ts:37` | 「这家能不能用」目录早就回答了，「这次批了哪些」收据早就回答了 | 非草稿 run 的默认允许集改从目录接入状态派生（`electron/productionRun/connectedModelScope.ts`），三份「允许集」各有唯一来源，没有一份是手填的 |
| 设计系统 `docs/design/nomi-design-system.md:108`（§1.5 一功能一个家）与 `docs/design/nomi-design-system.md:244`（§1.7 设置区信息架构） | 同一动作只保留 1 个规范入口；设置 tab 按「服务于哪个名词」归位 | 系统提示词跟 Agent 怎么说话是一件事 → 搬进 Agent 面板档位弹层底部；设置页不留链接式占位。§1.7.1 住户表同步改写 |

## 2. 范围 / 不动项

- 动：`AutomationPolicySettings` 契约（删 9 个字段）、run `AutomationPolicy.mode`、`approvalPolicy`、`productionPolicyReadiness` 文案、`productionRunService` 默认 policyResolver、设置页两个 section、系统提示词编辑器搬家、`productionPolicyRecovery` 深链、相关 i18n / 基线 / 走查。
- 不动：草稿 run 的候选圈定、收据推导、`trustedHosts`（第 6 条由 `fix/mcp-connection-truthfulness-20260914` 处理）、付费卡（卡上已有模型行，不新增）。

## 3. 回滚

整条是删除 + 派生替换，回滚即 revert PR；旧持久化设置里的已删键在归一化时丢弃，回滚后原样重新读到。

## 4. 验收门

typecheck / lint:ci / check:i18n / vocabularies / tokens / boundaries / controls / root-cause-contracts / symptom-cluster 绿；改前改后真机截图（`scratchpad/settings-cleanup/before|after`）；四份走查改走真人路径打开编辑器。
