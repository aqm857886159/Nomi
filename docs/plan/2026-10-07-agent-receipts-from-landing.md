# 设计卡：Agent 回执从画布真实落地结果派生

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：draft_shots 回执只说画布上真实发生的事；分镜表不重复建      线/负责人：L-agentsay      类别：[其他]
```

来源：用户反馈「Agent 说的和画布上看到的对不上」。两条旧记录先在最新主干上复现：
1. 回执写死：画布 Agent 建草稿时节点当场落成，但每次成功的 `draft_shots` 都回同一句「Saving does not imply canvas placement」，模型照着对用户说「画布上还没有节点」。**仍复现**（`nextActionFor` 的静态句子还在）。
2. 同一次任务两个「分镜表」：**在渲染层边界复现**——同一 Run 的两次重叠落地各建一张（`multiShotCanvasLanding.test.ts` 新增用例原先红）。主进程那头同一 Run 的落地是排队的，所以单靠主进程路径不易触发；另一种可能是模型对同一任务起草了两份草稿（两个 Run、各一张表），那是设计行为，没改。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我让 Agent「加一个图片节点，先别生成」，我想它如实告诉我节点已经在画布上，以便我直接去改。步骤：发消息 → Agent 起草 → 节点当场出现 → Agent 回话说节点已在（点名几个）。三种情形各说真话：画布来源草稿项目开着（已落，点名节点）；文稿来源方案（没落，等我点「放入画布」）；项目没开着（没落，打开后才出现）；渲染层没接住（说没落成，让模型先看画布再下结论）。**不做**：不改落地时机、不加界面和提示文字。**真实任务**：① 画布里让 Agent 加一个图片节点不生成；② 文稿里让 Agent 起草分镜方案；③ 项目关着时外部发起草稿。主指标：回执与画布实际一致（落了说落了、没落说没落）；护栏：不花钱、不多建节点。 | `electron/agentLane/laneExtendedTools.test.ts`；`electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts` 真实路径用例 |
| ★2 谁说了算 | 「草稿此刻在画布上吗」唯一 owner = 落地宿主 `productionRun/canvasLandingHost.ts`（`draftLandingOutcome`，等落地落完后读 Run 账本里的节点绑定）；回执只在 `laneExtendedTools.ts` 的 `nextActionFor` 渲染，措辞唯一出处 `shared/agentLane/draftCanvasLanding.ts`。分镜表「每个 Run 一张」owner = 渲染层 `materializeShots`。碰两个概念（回执措辞、分镜表物化），同属「Agent 说的 = 画布实际发生的」。 | `node scripts/door-map.mjs landDraftOnCanvas`；`node scripts/door-map.mjs findProductionShotTable createProductionShotTable` |
| ★3 一致与复用 | 复用现有落地链与 Run 账本，不新增状态；沿用 `generateUserDecision` 的「宿主写一格、回执只渲染」形状；没有第二份「落没落」的判据。 | `git grep "draftCanvasLandingOf"` |
| ★4 全状态 | 已落（点名节点，部分落则说只有几个）、文稿来源未落、项目没开未落、落地失败未完成、宿主未报（外部宿主：不对画布下结论）。无界面变化，措辞都是对模型说、带下一步，英文（模型面）。zh/en 界面文案不变。取消中 / 能力不可用：不适用（不碰）。 | `laneExtendedTools.test.ts` 六条 |
| ★9 验收与回滚 | 验收（另一条线）：`pnpm vitest run electron/agentLane/laneExtendedTools.test.ts electron/productionRun/agentDraftSingleLedger.test.ts src/workbench/capability/multiShotCanvasLanding.test.ts electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts`；变异：回执改回静态句 → 落地用例红；落地后不等 settle → 真实路径用例红；建表前不再读一次 → 重叠落地用例红。真实模型换说法未验证（不花钱）。逃逸账本 `FB-20261007-agent-receipt-contradicts-canvas`。回滚：revert 本线提交。独立验收报告：待验收线出。 | `## 独立验收` |
