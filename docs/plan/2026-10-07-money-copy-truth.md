# 2026-10-07 L-moneycopy 设计卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：清掉没有事实依据的花钱文案
分类：[花钱][新界面/改交互]
负责人：实现线（协调会话另派独立验收）

| 格 | 结论 | 证据 |
|---|---|---|
| 1 用户怎么用 | 用户在模型接入、生成确认、任务状态和取回失败提示中看到价格/花费信息，并据此决定是否继续。 | 真实词典入口：`src/i18n/locales/*`、`electron/desktopStrings.ts`；任务脚本 brief |
| 2 谁说了算 | 实际价格只能来自已知报价；未知就明确写“暂时算不出价格”，本地能力只有在能力确实离线且无供应商账单时才说明本地处理。 | `src/i18n/locales/runtime.ts`、`generationCommon.ts` 的未知价格分支；`scripts/check-i18n-no-cost-claims.mjs` |
| 3 一致与复用 | 复用现有 i18n 词典与 `check:i18n`，不新增门岗脚本；主进程继续复用 `desktopStrings`。 | `src/i18n/resources.ts`、`electron/desktopStrings.ts` |
| 4 全状态 | 价格已知显示已知金额；未知显示暂时算不出价格；验证可能收费时先说明并确认；取回失败只说“重新拉取/重试”，不承诺免费。 | `runtime.ts`、`onboardingProviders.ts`、`desktopStrings.ts` |
| 5 中途表 | 对已发出/已结算任务显示真实回执；停止只说明已发出与未发出，不推断未发出的花费；断网重启后仍按回执与供应商状态。 | `src/i18n/locales/agentPanelV4.ts`、`generationCommon.ts` |
| 6 外部数据 | 供应商价目、额度和验证方式是外部事实；无可验证来源时不写免费/预算/零元。 | `electron/catalog/*` 价格契约；现有 no-cost checker |
| 7 性能预算 | 只改静态文案与离线扫描测试，不增加运行时路径。 | `check:i18n` |
| 8 真实条件 | 中文/英文词典、主进程桌面文案、设计实验室现役组件均需扫描；未跑真实 Electron 走查的截图记 `unverified`。 | `check:i18n`；任务要求的 zh/en 截图 |
| 9 验收与回滚 | 先跑文案禁用词测试与 `check:i18n`，再跑受影响单测；回滚只需回退本地提交。独立验收线另按本卡逐项核对。 | PR 草稿 `## 独立验收` 待协调会话填写 |

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
## 花钱文案盘点

| 词类 | 入口 | 事实判据 | 处理 |
|---|---|---|---|
| `免费` / `free` | `src/i18n/locales/onboardingProviders.ts`、`modelDisplayText.ts` | 外部供应商额度随账户和时间变化，不能从接入能力推出零费用 | 删除零费用承诺，保留能力事实 |
| `重新拉取` / `retry` | `electron/desktopStrings.ts`、`src/i18n/locales/generationCommon.ts` | 取回已生成结果不等于再次生成，但实际是否扣费仍由上游回执决定 | 只描述取回/重试动作，不写“免费” |
| `预算` / `已花费` | `src/i18n/locales/agentPanelV4.ts`、`generationCommon.ts`、`src/workbench/production/ProductionDetails.tsx` | 只有已知回执或批准金额才能显示数值；未知不能补 `0` | 复用“暂时算不出价格”或真实回执 |
| `¥0` / `$0` | 全部 renderer 词典与 `electron/desktopStrings.ts` | 零值必须有明确本地或供应商事实；字符串本身不能制造事实 | 纳入现有 no-cost 扫描器回归测试 |

盘点结论：本轮只改静态文案和共享扫描器，不改计费、预算或重试逻辑；发现没有真实预算能力的界面元素时，删除其零值承诺，不新增替代假功能。

## 截图证据

付费卡的 zh/en 与确认后截图见 [`docs/evidence/2026-10-08-money-copy/README.md`](../evidence/2026-10-08-money-copy/README.md)。任务中心和制作详情本轮没有在真实任务闭环中截到，按要求标为 `unverified`。
