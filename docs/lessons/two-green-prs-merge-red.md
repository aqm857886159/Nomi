# 两个各自绿的 PR 合到一起会红：连续合同一区域要先并线再等 CI

> 📎 教训 · 首次记录 2026-09-05 · 状态：现行
> **触发场景**：一天里连合两个以上 PR，且它们碰同一个文件 / 同一条走查 / 同一个门岗基线；或 main 在某次 merge 后突然红而两个 PR 各自的检查都是绿的。

**结论**：PR 的检查跑在「它自己的 head + 当时的 main」上，不是跑在「它和另一个还没合的 PR 合起来」上。同一区域连续合并时，第二个 PR 必须先 `gh pr update-branch`、等它在新 main 上重新跑绿，再合；别拿两个绿灯当一个绿灯。

**为什么会踩**：2026-09-05 两次同一族——
- #492 把 `storyboardPlan.ts` 留在 800 行整，#494 又加 18 行，各自的 `check:filesize` 都绿，合完 main 818 行红（热修 #497 拆出 `storyboardPromptCompiler.ts`）。
- #495 把审批改成按 effectClass 分级，#504 把「模式弹层里的审批模式」按设计删掉；旅程 `resident-composer-receipt-fix.e2e.mjs` 依赖那个被删的入口，两个 PR 各自绿，合完 main 的真实用户旅程门红（#507 修：旅程改走真实审批流 + 分类器给 `ProjectAgentResidentShell.tsx` 加显式「必跑旅程门」规则）。
- 顺带一个假象：#505 合入后 main 的 Quality Gate 绿了，是因为分类器把旅程门 **skip** 了，不是真绿；看到 `skipped` 别当 `success`。

**怎么用**：
1. 合第二个 PR 前先 `comm -12 <(git diff --name-only origin/main...A | sort) <(git diff --name-only origin/main...B | sort)`，有交集或都碰门岗基线 → 先 `gh pr update-branch B` 再等 CI。
2. 看 main 的 CI 结论时同时看 job/step 的 `skipped`，被分类器跳过的门等于没跑。
3. 收货三查里「套件失败 delta=0」要以 **合并后 main** 的 run 为准，不以 PR 的 run 为准。
