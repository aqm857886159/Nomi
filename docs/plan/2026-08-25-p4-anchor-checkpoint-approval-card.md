# P4 — 锚定妆照检查点的渲染层审批卡（§3.2 拍板面，选项 B）

日期：2026-08-25 · 状态：📋 方案待拍板（样张已拍板但方案本身一直没提交进 git；2026-09-02 打捞入库，未开工）

> 来源：#155 plan §8.5 裁定的两条腿之二。headless 腿（选项 A：MCP 入口 + service post-decide 重踢）= PR #156（`docs/plan/2026-08-25-p4-anchor-checkpoint-approval.md`），本分支已合入其分支。本切片 = 渲染层卡：S4 建了门、S5 落了画布占位，审批 UI 从未接——带锚多镜批走到检查点，Nomi 用户无路可走（任务卡只显示笼统「需要批准」，点开进的是通用付费确认漏斗，无定妆照、无开拍/重出语义）。
> 样张：2026-08-25 可交互 widget 已用户拍板（任务中心卡新面：定妆照行 + 逐张重出 + 开拍 N 镜 + Codex 指路变体 + 否决死路面）。

## 1. 设计决定（已拍板，含依据）

1. **卡住任务中心 `ProductionRunTaskCard` 的一个新面，不做画布浮层。** 依据：2026-08-11 拍板「run 操作一功能一个家 = 任务中心」（ProductionRunTaskCard.tsx:12 头注，当时已删画布助手面板旧卡）。画布侧只用既有稳定 id 进度通知加一记「去过目」动作键（`nomi-open-task-center` CustomEvent 已存在，TaskCenterButton.tsx:71），不开第二决策入口。看大图 = 点缩略图跳画布节点（reveal 既有机制）。
2. **「重出形象」直接走 S6 返工（reworkProductionShot），不先发 rejected。** 依据：数据层 rejected 不可逆——reducer 对已决门抛错（productionRunReducer.ts:607）、deriveCheckpoint 见 rejected 永远 rejected（batchScheduleDerivation.ts:221）、稳定 gateId 不可重开（reducer:584 duplicate 抛错）。门留 waiting，重出完成后仍可开拍。rejected 死路已单独立任务（headless 侧，不混本切片）。
3. **「开拍」直接 `gate.decide approved`，不再弹确认弹窗。** 依据：检查点是免费质量门（anchorCheckpoint.ts:4-11），预算在合同门已授权；卡面即确认面。文案如实：「用已确认的预算，这一步不另花钱」。续跑由 #156 的 service post-decide 钩子自动重踢，渲染层不自造。

## 2. 数据契约（derive 不 hardcode）

- **锚集合**：`run.generationPlan.shots` 中 `role==='anchor'` 且 included（与 deriveCheckpoint 同源派生，batchScheduleDerivation.ts:209）。gate.jobIds 建门后不刷新（gate.add 一次性），重出后死盯原始 jobId 会显旧图——所以逐锚解析**最新 attempt 的 job → artifact**（镜像 `latestGenerationAttempt` 派生哲学）。
- **每锚状态**：latest job 无/未终态 → `generating`（重出中）；job ready/adopted + artifact → `ready`；job 失败 → `failed`。任一非 ready ⇒ 开拍禁用 + 说明（C1/C4）。
- **N 镜计数**：`plan.shots` 非 anchor 且 included 的数量。
- **decisionHome**：anchor 门加入 direction/sample 一档（保持 base.decisionHome）——#156 后 MCP 端可决，外部驱动时卡只指路 + 兜底（复用 routedGate 既有形态）。
- **复用锚**：v1 数据层复用不建锚 shot、不进检查点（s6p5 plan §2.6 明示 UI 不做）。卡列门内全部锚；「复用资产也停一拍亮出来」需数据层先支持——不动项。

## 3. 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/workbench/production/productionRunView.ts` | `ProductionGateKind` + `'anchor'`；`gateKindOf` 识别 anchor_checkpoint；`view.anchorReview` 派生（锚行 + pendingCount + shotCount）；anchor 门文案 key + decisionHome 归 direction/sample 档 |
| 2 | `src/i18n/locales/generationCommon.ts` | `production.status/description.anchorGate`、`production.anchorReview.*`（行标签/重出/开拍/重出中提示/否决面）zh + en |
| 3 | `src/workbench/production/ProductionRunTaskCard.tsx` | anchor 面：定妆照行（缩略图/标签/版本/逐张重出）替换通用 preview；开拍主键（nomi 主路径）/ 指路 + 兜底（origin）；否决停拍面 |
| 4 | `src/workbench/production/useProductionStatus.ts` | `onAnchorApprove`（直接 gate.decide approved + loadRun）、`onAnchorRework(shotId)`（走 productionShotActions.reworkProductionShot） |
| 5 | `src/workbench/taskCenter/TaskCenterPanel.tsx` | 把两个新回调 + 节点跳转穿给卡 |
| 6 | `src/workbench/production/ProductionCanvasLandingHost.tsx` | 检查点 waiting → 稳定 id toast「定妆照出齐了 · 过目后开拍」+「去过目」动作（派发 nomi-open-task-center）；进度 toast 与它互斥切换 |
| 7 | `src/workbench/production/productionRunView.test.ts`（或就近既有测试文件） | anchorReview 派生单测：waiting/重出中/failed/rejected、最新 attempt 解析、N 计数、decisionHome |
| 8 | `tests/ux/p4-anchor-checkpoint-approval.e2e.mjs` | 零额度真机走查：磁盘种真 durable Run（snapshot envelope + checksum，锚 artifact 带真缩略图文件）→ 通知桥 → 任务中心卡面截图（光/暗）→ 点开拍 → 真 IPC → 读回 gate approved（种子 plan 用不存在 provider，#156 kicker 吞异常，零派发零花费）→ 重出按钮真链探针 |

## 4. 不动项

- scheduler / derivation / reducer / gate schema 零触碰（重踢已由 #156 钩子统一）。
- rejected 死路的数据层修复（已单独立任务卡）。
- 复用锚进检查点（需数据层，§2 注）。
- ProductionShotPlaceholder 占位三态不动（分镜排队视觉照旧，检查点期间「排队中」是真话）。

## 5. 验收门

- 单测 #7 全绿；`pnpm run gates` 五门全过。
- 走查 #8 截图亲眼 Read + 与获批样张逐项对账（行布局/按钮语义/指路变体/否决面/通知桥）。
- R16：走查即真实任务链（批到检查点 → 被通知 → 过目 → 开拍 → 批准落库）；重出链主进程半程由既有 scheduler e2e + #156 覆盖，渲染层按钮到 IPC 由走查探针覆盖。

## 6. 回滚

纯渲染层 + 一处 toast 桥，无数据结构变更：revert 本切片即回到「检查点显示笼统需要批准」现状，存量 Run 不受影响。
