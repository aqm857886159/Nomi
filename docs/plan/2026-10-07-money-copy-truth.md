# 2026-10-07 L-moneycopy 设计卡

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