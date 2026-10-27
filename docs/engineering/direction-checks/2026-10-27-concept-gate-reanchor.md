# 方向检查：概念门不读改锚台账——两道门对「合同边界挪走了」各读各的（2026-10-27）

协调代批（10-27）：只因自写登记口径命中、改法是换。

触发（本线 10-27 实跑 `node scripts/fix-churn.mjs scripts/boundary-owners.mjs scripts/check-boundary-owners.mjs scripts/concept-owners-lib.mjs scripts/check-concept-owners.mjs scripts/pre-push-gate-table.mjs`）：只命中自写登记 `gate-family`（状态 under-review，近 30 天已有 91 个 fix，这一刀第 92 个）；要改的文件本身都没命中。改法是换：两道门各自读台账 → 共用一个改锚解析，`evaluate` 里内联的那段查找同提交删掉，不新增分支、不留开关。按 P1 的例外由协调代批，事后报用户。

## 0. 一句话根因

「合同声明的共享边界挪走了」只记在边界主人台账（`scripts/boundary-owners-ledger.json` 的 `reanchored`）一处，读法却写死在 `check:boundary-owners` 的 `evaluate` 函数体里；`check:concept-owners` 没有入口可接，直接拿合同里的旧锚去对写接口，两道门对同一条边界核的是两个锚。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 视频拆解取消那条线：补预览的请求登记按用户拍板挪进中立模块并记了改锚，`check:boundary-owners` 认（改锚 52），`check:concept-owners` 报 10-16 合同的旧锚 `electron/assets/previewRequests.ts#createPreviewRequestRegistry` 未登记 | `evaluateContracts` 不读台账 | 一份记录、两个读者、两种读法 |
| 潜伏（main 上就有）：10-03 合同的 `electron/tasks/nodeSubmitInFlight.ts#withNodeSubmitExclusive` 已改锚到 `electron/capabilityCore/appIntegrationCanvasShot.ts#assertNodeIdle`，概念门的冻结账还对着旧锚，新锚哪天登记了这笔债也消不掉 | 同上 | 同上 |
| 绕路：拆解取消线实测把 10-16 合同的边界改指新模块，概念门变绿，但旧合同一动就按那次 diff 全量复核，冒出 3 条无关阻断 | 合同是立约当天的快照，挪走只能记台账 | 同上 |

## 2. 为什么这一类会一直出现

- 合同不可改，改锚只能记台账；台账的读法没有共用入口，概念门 09-29 上线时只能绕开它。台账现有 51 条改锚，以后每多一条落在受管合同（09-27 起）上，概念门就红一次，作者要么改不可变的合同，要么去抬冻结账（棘轮不许）。
- 铁律 ⑩ ⑪ ⑫：不适用——这是两道门岗之间的口径分叉，不碰产品行为。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 拆解取消线合进来，CI 的 `check:concept-owners` 红在 10-16 合同 | 那条分支上 `node scripts/check-concept-owners.mjs` 退出 1，只有这一条 |
| 下一次改锚的 PR 同样红，作者去改旧合同，根因合同门冒出无关阻断 | `node scripts/check-root-cause-contracts.mjs` |
| 10-03 合同那笔冻结债永远对着已删的旧锚 | 把 `assertNodeIdle` 登记进写接口后跑概念门，冻结账不变陈旧 |

## 4. 靶子独立性检查

- 尺子就是两道门本身：测试拿同一组夹具（同一份台账、合同、代码）把两道门的入口都跑一遍，比它们核的是不是同一个锚，不信任何一道门的自述。
- 没有「修对了反而掉分」的先例。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- **接入现成方案**：「一个符号挪到了哪儿」有现成的认法——git 改名检测（`git diff --find-renames`、`git log --follow`，<https://git-scm.com/docs/git-diff>）和 TypeScript 语言服务的查找引用 / 重命名（<https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API>）。**现在换不了**：这次是改名加重写（拆解取消线实测 git 相似度不到 50%，认不出是挪文件），旧符号已经删掉，语言服务也找不到继任者；「谁继任了这条不变量」只能由人写进台账。**哪天换**：`gate-family` 评估到期（reviewBy 2026-10-31，按门岗账本逐项拍板保留 / 合并 / 降级 / 删）时一并定两道门要不要并成一道；并了，台账就只剩一个读者，这层共用解析随之并入。
- 台账、根因合同、概念登记都是 Nomi 自己的登记表（`gate-family` 的 whyNotIntegrated：没有现成工具）；共用解析只是把已有的那段查找挪到两道门都能接的地方，不新增判据。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | git 改名检测或 TypeScript 语言服务自动找新锚（出处见 §5） | 中 | 改名加重写认不出，会把「挪走了」当「没了」，或猜错继任者 | 否：认不出这一类 |
| 换（已做） | `scripts/boundary-owners.mjs` 抽改锚解析，两道门都经它读台账；`evaluate` 里内联的查找同提交删掉；新锚照样要是某个概念的写接口，报错写明「合同里的旧锚 → 台账里的新锚」 | 两个判据文件各改一处 | 无 | **是** |
| 补：只给概念门加特例 | 概念门里另写一段读台账 | 小 | 第三份读法，下次再分叉 | 否 |
| 改旧合同 | 把 10-16 合同的边界改指新模块 | 小 | 合同是历史；实测引出 3 条无关阻断 | 否 |

## 7. 用户要权衡的核心

没有要权衡的：两道门岗读同一份台账却读法不同，修法唯一，事后报用户。

## 特征测试清单（动结构前先锁住）

- `scripts/check-boundary-owners.node-test.mjs`「改锚登记会接着核新锚——新锚也坏了照样红」：边界主人门的改锚行为，换前已钉住，换后原样要绿。
- `scripts/check-concept-owners.node-test.mjs` 的「合同：受管合同的共享边界没登记 → 红…」「未登记的合同边界冻结成存量债棘轮…」：没改锚的边界照旧报，冻结账照旧。
- 新增、先红后绿：改锚到写接口概念门不报；改锚到非写接口照报、报错带新旧两个锚；台账没有这条照旧报；同一组夹具两道门认同一个锚。
