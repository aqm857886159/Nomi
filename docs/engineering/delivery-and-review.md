# 交付与评审（L2）：push 前分层 · 交付身份 · 合并前检查

> 从 CLAUDE.md 搬来（规则体系瘦身）。**用到时怎么保证看到**：`self-check.sh` 在用户消息含「合并 / merge / 收据 / verify-merged / preflight / 开 PR / 交工 / 推送」时注入【交付】块（带合并规矩要点与本文件指针）；CLAUDE.md 的「常用命令」一节也直接指向本文件；push 时 pre-push 闸门自己拦没过的。
> 详解在 `docs/engineering-rules.md` 的 R11 / R22；编排侧见 `docs/engineering/agent-orchestration-playbook.md` §19。

## Push 前按风险面分层（R22）

contracts 始终跑（一次跑完全部门岗再汇总，不再第一个红就停；`check:concept-owners` 只出 warning 不阻断；`check:docs-index` / `check:doc-status` / `check:ledger` 已移出 PR 的 Contracts——合入 main 后由 `docs-autosync` workflow 自动补齐回写；档案默认值生成物由 `archetype-autosync` 工作流自动重生成；`check:root-cause-contracts` 只对 schema 不合法阻断）；unit 独立选 focused/full（**本机 `pnpm run gates` 也按同一份 `scripts/validation-policy.mjs` 分档**，全量一万两千多个测试交给 CI 并行机器，不再占着全机那把 gates 锁；想本机兜底跑全量用 `pnpm run gates:full`）；Electron、真实旅程、React Flow 画布、性能和 macOS package 各按受影响路径独立触发，`main` push 也按真实 `before..after` 分类，不因事件名自动全量。删除/重命名、空 diff、测试/CI 分类器自身和手动发布边界 fail-closed 到全维度。连续小修先在本地收敛，再一次性验证和 push，不让每个微提交反复触发全套 CI。

## 交付身份只走统一命令（R11）

任务开始先跑 `delivery:preflight`；PR 合并后**立即**在 Git fetch 得到的真实 merge SHA 上跑 `delivery:verify-merged`：非纯文档的 merge 必须看到该 SHA 上 `Core Flow Smoke (empty)` / `(used)` 都是 success 才发收据（skipped / 缺席一律拒绝）。**合并规矩（2026-10-01 用户拍板；只由协调会话做，其他会话开 PR 后把号发给它、不自己合）**：CI 绿 + 扫描干净就合；**最多 3 个合并在等收据**（`quality-gate.yml` 按 SHA 分组，每个合并提交各跑一套），任何一个收据红了**立刻停止再合**，交人定修还是回滚（冒烟红了不自动回滚）。任务 commit、PR head、merge commit 与 tree 分开报告；禁止用 REST compare 文件列表重建 Git tree/commit，禁止把 `same-tree-different-commit` 叫成代码不匹配。

## 合并前检查：设计卡 + 独立验收（取代旧的交工前评审，R24 由 PR #223 保留）

2026-10-02 起，原来的交工前评审（适配器、收据、延后账本、`review:branch`、PR 正文评审小节）整套删除，用两个暂停点代替：

- **暂停点①设计卡**：碰花钱 / 长跑 / 可打断 / 新界面，动手前写一页卡（`docs/engineering/design-card.md`），PR 正文 `## 设计卡` 放链接或全文；其余改动只填 ★ 格。
- **暂停点②独立验收**：四类改动合并前由另一条线验收，PR 正文 `## 独立验收` 带报告链接和验收线编号，编号不得与实现线相同。
- **协调会话合并前跑** `node scripts/merge-preflight.mjs <PR 号>`：按路径判是否四类、查卡格是否填全、查独立验收、修逃逸 bug 时查带 `detected_by` 的根因合同；碰到规则 / 门岗文件（CLAUDE.md、rules.json、`scripts/check-*`、门岗基线、workflow 等）时正文「碰到的规则与门岗」一节必须逐个点名、整文件删除写「删除：理由」，逃逸账本条目不许消失（#1032 用旧分支回退 #1031 后加）。脚本只打印结论，不合并。
