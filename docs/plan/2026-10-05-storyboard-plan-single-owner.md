# 分镜方案身份与镜号的单一 owner（L-sbplan · 审计批 B6「Agent 起草协议」）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 用户 10-05 原话：「分镜方案经常做错：建了好几个方案、数量不对，最后才合到一个」。
> 审计：`docs/research/2026-10-05-storyboard-plan-user-audit.md` U1 / A5 / 批 B6（PR #1030）。协调会话已拍 D5：一次请求只出一份方案，由宿主保证；用户明确说「另起一份 / 再做一版」才新建。

```
改动名：分镜方案身份与镜号单一 owner     线/负责人：L-sbplan            类别：[其他]
```

类别说明：只碰「起草 / 改草稿」，草稿不出报价卡、不花钱（`draft_shots` 一律 `cardHidden`）；不改界面（不新增 `.tsx`、不动 token）；没有长跑、没有可打断的异步链。所以按规则只填 ★ 5 格，其余 4 格写不适用的理由。

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在创作页让 Agent「把这段拆成 N 镜」，我想左栏只多**一份**方案、行号从 01 数到 N、之后说「改第 1 镜」改的就是第一个镜头，以便我不用自己去合并几份方案、对号、找回被改错的参考卡。步骤：①写文稿 ②对 Agent 说「做 2 镜的分镜方案，先立角色」③Agent 先建参考卡、再补镜头（可能分两次调用）④左栏只看到一份方案，参考卡 2 张、镜头 01、02 ⑤说「把第 1 镜改成……」⑥第 1 个镜头变了、参考卡没动 ⑦下一轮说「再加两镜」，加在同一份上，行号 03、04。**不做**：不改界面样式；不碰左栏「对勾 = 跳过」；不改 SKILL 的拆镜数量方法论（审计 B6 的「用户点名镜数就按它」只在 SKILL 里加一句）；不迁移旧方案里已占号的锚 id（会断开已生成参考卡节点的绑定，见★9 残留）。**已知坑**：模型仍可能把一镜说成两镜——那是模型概率，宿主只保证「不因宿主的提示多建一份、不因编号把锚当镜」。真实任务：T1 中文「帮我做 2 镜的分镜方案，先立角色再排镜头，别生成」；T2 英文 "make a 2-shot storyboard plan, set up the character first, do not generate"；T3 同一份方案上「把第 1 镜改成她站在天台边缘」/ "change shot 1 so she stands at the rooftop edge"。主指标：一次请求产生的方案数（基线：审计 P10 一次请求 2 份 → 目标 1 份）；质量指标：镜头行号 = 1..N（基线 03、04 → 01、02）；护栏：「改第 N 镜」落到锚的次数（基线 1/1 → 0）。样本：审计零额度回环夹具 P10 的三段脚本化大脑轨迹（中英各一）。 | 逃逸账本 AUD-20261005-01（PR #1030 编号）；`electron/capabilityCore/storyboardPlanSingleOwner.e2e.test.ts` |
| ★2 谁说了算 | 「镜头身份与镜号」→ 唯一 owner `electron/shared/storyboard/storyboardSubjectIdentity.ts`（`nextStoryboardSubjectIds` 发号、`appendStoryboardSubjects` 落行号、`storyboardSubjectAt` 寻址），主进程（首建）与渲染层（补镜头 / 改一镜）都只调它。「一次请求一份方案」→ 唯一 owner 是生成规划 handler（`mcpGenerationTools.ts` 的文稿方案落地处，它是唯一铸方案 id 的地方），按 `storyboardTarget.requestId` 记这一请求已建的方案。方案正本仍归渲染层项目记录（`storyboardDesign`），主进程只发作者载荷。碰 2 个概念：分镜方案（storyboardDesign）、Agent 草稿（generation operation）。 | `node scripts/door-map.mjs storyboardPlanFromDraftSubjects upsertStoryboardDesign patchStoryboardSubject shotEnvelope storyboardSubjectFromCandidate addStoryboardDesign`（门表贴在根因合同 `doors`） |
| ★3 一致与复用 | 手建方案早就是这套规矩：锚 id `anchor-N`（`storyboardPlanEdits.makeAnchorId`）、镜号只数镜头且重排成 1..N（`renumber`）。Agent 这条路是唯一的例外（锚和镜混在一个序号里）。本次让 Agent 路复用同一规矩，号由共享层发；不新增第二份编号定义——删掉 `shotEnvelope` 的 `shot-${index+1}` 兜底与 `storyboardPlanFromDraftSubjects` 的 `index+1`。补镜头复用首建的同一套准入（候选合成、身份核对、参考解析），不另写一台。自写理由：镜号 / 锚是分镜领域本身（`self-written.json` 领域目录）。 | `git grep -n "shot-\${index"`（改后只剩手建方案的 `stableShotId` 兼容派生） |
| ★4 全状态 | 首建成功：回执 `storyboardSaved` 带方案名、镜头 id 与行号、参考卡 id；只有参考卡：回执改为「在方案 X 上补镜头：draft_shots 带 operationId=X、新镜头不带 shotId」，删掉「下一次 draft_shots 再补」；同一请求第二次不带 operationId 的起草：落到同一份方案，回执写「已加到这一请求起草的方案 X；用户明确要另起一份才传 newPlan」；补镜头成功：回执 `storyboardExtended` 列出新镜头 id 与行号；补到不存在 / 已删的方案：拒绝并说「方案不在了」（渲染层 `storyboard_design_missing`），不新建；改第 N 镜 id 落到旧方案里占号的参考卡：拒绝并列出真实镜头 id 与行号，不改；改不存在的镜：照旧拒绝。全部是写给模型的英文回执（模型面），不新增界面文案，`check:i18n` 不受影响。取消中 / 过期：不适用——起草是同步落盘，无可取消阶段。 | `electron/capabilityCore/storyboardPlanSingleOwner.e2e.test.ts`、`src/workbench/creation/storyboard/agentStoryboardDesign.test.ts` |
| 5 中途表 | 不适用：起草不花钱、无长跑；关窗 / 重启发生在两次调用之间时，「本请求已建方案」的记忆随进程丢失，下一请求本来就是新请求（requestId 变了），不会误合并。 | 人工 |
| 6 外部数据与失败 | 不适用：不接外部数据；模型入参仍由宿主 schema 准入。 | — |
| 7 性能预算 | 不适用：每次起草多一次 O(镜数) 的编号，镜数上限 40。 | — |
| 8 真实条件 | 不适用（非四类）；零额度回环夹具验证见★9。 | — |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run electron/capabilityCore/storyboardPlanSingleOwner.e2e.test.ts src/workbench/creation/storyboard/agentStoryboardDesign.test.ts electron/shared/storyboard/storyboardSubjectIdentity.test.ts`，再按审计复现命令 `pnpm run build && NOMI_AUDIT_LOCALE=zh-CN node tests/ux/audit-storyboard.walk.mjs`（en 同理，屏幕外窗口、零额度）看 P10：`plansAfter` 只多一份、`rowNumbers` 为 1、2、`afterPatchShot1` 改的是镜头。硬门 ⑩（说的=摆的）：模型说「2 镜」→ 表上 2 行、行号 01、02；⑫（点了=以为的）：「改第 1 镜」→ 改到第 1 个镜头。本线已按此在屏幕外窗口、零额度回环跑过 P1 + P10（中英两轨，截图亲眼看过）：行号 1、2，「改第 1 镜」改第一个镜头，「先立角色再排镜头」一次请求只多一份方案；P2–P9、P11 未重跑。逃逸项 AUD-20261005-01 在 #1030 合入、人工复核、有 PR 号后改 fixed。回滚：`git revert` 本分支提交（无数据迁移、无开关）；已按新规则建的方案锚 id 是 `anchor-N`，回滚后旧代码照常读写（手建方案本来就是这个形状）。**独立验收**：非四类不强制，交协调会话决定。 | 逃逸账本；`docs/fixes/2026-10-05-storyboard-plan-single-owner.root-cause.json` |
