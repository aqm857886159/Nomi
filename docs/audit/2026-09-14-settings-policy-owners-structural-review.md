# 结构评审：「允许什么 / 用哪档 / 怎么说话」三份状态在设置页各多长了一个 owner（2026-09-14）

> 触发：`check:symptom-cluster` 在 `electron/productionRun`、`electron/settings`、`src/workbench` 三层 7 天内又各收到一份根因合同（`docs/fixes/2026-09-14-settings-allowlist-default-deny.root-cause.json`）。按 R21 的规矩，第三份合同是「这一层结构不对」的证据，先把结构说清再修。本评审对应设置页逐控件审计（scratchpad `settings-audit/report.md` §①/§②/§⑥，用户已拍板删除清单 1–8 条）。

## 一句话

设置页在三个已有唯一 owner 的状态旁边，各自又存了一份「让用户手填」的副本；副本的空值语义与用户心智相反（没勾 = 全拒），且互不联动。修法不是改默认值，是**删副本、只留派生**。

## 三份状态、各自的 owner、设置页多出来的那份

| 状态 | 真 owner（现役） | 设置页多出的副本 | 副本造成的事实 |
|---|---|---|---|
| 允许哪些供应商/模型 | 目录接入状态（`electron/catalog/modelCatalogListing.ts` `keyStatus`）+ 用户在付费卡上批准的那份计划（`electron/productionRun/productionRunRepository.ts` 按 jobs 推导 `approval.allowedProviders`）| `AutomationPolicySettings.allowedProviders/allowedModels`（默认 `[]`）经 `productionRunService.ts` 默认 `policyResolver` 进 run policy，`approvalPolicy.ts` / `productionPolicyReadiness.ts` 用 `includes` 判 | **空 = 全拒**：新装 Nomi 的 MCP 代跑必被 `provider-not-approved` / 「未加入白名单」拒；补救入口是 161 个复选框 |
| 用哪档（要不要每步问）| Agent 面板 `PermissionTier`（`src/workbench/ai/v4/agentPanelV4Types.ts` `PERMISSION_POLICIES`，spend 轴三档全 confirm）| `AutomationPolicySettings.mode`（引导/平衡/策略自动）| `guided` 全仓无分支读；唯一行为读者 `approvalPolicy.ts` 只判 `policy-auto`——三档两种行为，且与面板档位互不联动 |
| Agent 怎么说话 | `src/workbench/creation/systemPromptOverrides.ts` + `electron/settings/systemPromptsContract.ts`（活功能，唯一 owner）| 没有副本，但**家放错了**：编辑器住在「AI 策略」tab，与「允许哪家」并排，而它和 Agent 面板才是一件事 | 长尾功能占了 AI 策略 tab 近一屏；v4 面板里没有任何入口能到它 |

另有六个契约字段（`confirmFirstSpend` / `autoContinueWithinBudget` / `confirmIrreversible` / `notifyOnGate` / `notifyOnFailure` / `notifyOnCompletion`）门表全 0 生产读者：两个渲染成不可点的「🔒 始终确认」徽章、一个死开关、三个从未渲染。

## 为什么会长成这样（结构成因，不是谁的手滑）

1. **「策略」tab 的判据把「在已接入的东西上设限」当成了一个必须有 UI 的类别**（设计系统 §1.7.2）。于是每来一条新的运行时不变量（白名单、档位、花钱规矩），都倾向于在设置页给它一个可调的家——哪怕运行时早就有 owner。
2. **run policy 的形状（`AutomationPolicy`）与设置契约（`AutomationPolicySettings`）字段同名**，`policyResolver` 一行展开就把设置原样灌进 run。同名让「设置就是 run policy 的来源」显得天经地义，没人问「这个字段的空值在 run 里是什么意思」。
3. **深链把两层焊死**：`productionPolicyRecovery.ts` 带着 `requiredProviderModels` 跳到设置页去聚焦复选框（`SettingsInitialSection` 多了一个 `'production-policy'`）。运行时的判据一旦要靠设置页的 UI 来「补齐」，两层就再也拆不开。

## 结构裁决（本轮已落地）

- **允许集**：删设置副本；非草稿 run 的允许集由 `electron/productionRun/connectedModelScope.ts` 从目录接入状态派生（唯一派生点，纯函数 + 测试）；草稿 run 仍按候选圈定；提交侧 `approval.*` 仍按用户批准的计划推导。`AutomationPolicySettings` 不再有这两个字段——TypeScript 拦住任何想读回来的人；旧持久化键在 `normalizeAutomationPolicySettings` 里丢弃。
- **档位**：删 `AutomationMode` 及 run/settings/effective 三处 `mode`。`approvalPolicy.ts` 的「未知估价按 policy-auto 拒」分支随之消失（PermissionTier 三档 spend 全 confirm，收据必是真人按的；未知估价 fail-closed 由 `submissionOutbox` 的 `costCeiling` 兜）。
- **系统提示词**：整套编辑器从 `src/workbench/settings/` 搬到 `src/workbench/ai/systemPrompt/`，入口只有一个：Agent 面板档位弹层底部「编辑系统提示词」（`V4PermissionPopover`）→ `DesignModal`。设置页不留链接式占位（§1.5.2 一功能一个家）。
- **深链**：`productionPolicyRecovery.ts` 只剩 `{ tab: 'models' }`——「缺」现在只有一种含义：那家没接入，修法就是去接。`'production-policy'` section 与 `productionPolicyRequirement` 整条管线删除。
- **六个死字段**：连契约、归一化、UI、i18n、动态前缀登记一起删。

## 这三层还留着什么结构风险（给下一份合同的人）

- `policyResolver` 仍然是「设置 → run policy」的一行展开（`trustedHosts` / `maxAttemptsPerJob` / `minimizeUploads`）。这三个字段的空值语义都正常（trustedHosts 永远含 `nomi`），但**下次再往 `AutomationPolicySettings` 加字段，先答：run 里空值是什么意思、运行时有没有已有 owner**（§1.7.3 三问加一问）。
- `trustedHosts` 与 MCP 连接页仍是同一批客户端的两半（审计 §2.3，删除清单第 6 条），由 `fix/mcp-connection-truthfulness-20260914` 分支处理；处理原则同上：连接成功即信任，不留第二份要人勾的表。
- `src/workbench` 这一层 7 天 90+ 份合同，聚簇本身说明该层没有稳定的「状态 → 唯一 owner」登记；`check:vocabularies` 只管词表 owner，不管「同一份状态几个 owner」。建议 R14.1 七维横扫里把「设置页每个字段的运行时 owner」做成固定一维。
