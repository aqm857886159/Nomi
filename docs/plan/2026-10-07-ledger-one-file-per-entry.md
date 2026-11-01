# 两本账本改成「一条一个文件」（2026-10-07）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：逃逸账本 / 概念登记拆成一条一个文件　线/负责人：L-ledgersplit　类别：[其他]（门岗族存储形状，不碰花钱 / 长跑 / 可打断 / 新界面）

## 问题（类根因）

- 症状：两个在途 PR 同时往 `tests/ux/full-walk/escapeLedger.json` 或 `docs/engineering/concept-owners.json` 末尾追加一条，先合的那个让另一个在 GitHub 上变成 CONFLICTING；后者要合 main、重推、重跑约 40 分钟 CI。手工按文本解冲突还切坏过条目。
- 直接原因：两份账本都是「一个大 JSON 数组」，追加永远落在同一处（数组末尾的 `]` 前），git 的文本合并必然冲突。
- 类根因：**一条记录的身份（id / subject）没有落到存储的身份（文件）上**。只要多条独立记录共用一个文件，任何两条并行新增都会在同一位置相撞；换个账本、换个字段排序都还会回来。
- 修法：每条记录一个文件，文件名 = 记录的身份；顶层字段进 `_meta.json`。新增 = 新文件，git 不可能冲突；改同一条才冲突，那本来就是真冲突。

## 设计卡（★ 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 谁在什么时刻受益：**协调会话的合并队伍**（连着合几个 PR 时，后面的不再因为前一个往账本追加了一条而变 CONFLICTING、重跑 40 分钟 CI）和**并行实现线**（往账本加条目 = 新建一个文件，不用合 main 解文本冲突）。步骤：① 实现线新建 `escapeLedger/<id>.json` 或 `concept-owners/<subject>.json`；② 门岗照旧在目录上判；③ 协调会话合并，不冲突。不做什么：不改任何判据阈值、不改条目字段、不改哪些门岗读它们；已知坑：同一条被两个 PR 同时改仍会冲突（这是真冲突，该冲突）；Windows 文件名大小写不敏感，所以 id 大小写不同也算重复。真实任务：10-07 #1048 / #1055 / #1056 / #1060 / #1065 同时在途都往两本账里加条目。主指标：账本追加引起的 CONFLICTING 次数 → 0；护栏：所有读两本账本的门岗迁移前后结论一致（特征对照）。 | `scripts/ledger-one-file-per-entry.node-test.mjs`；协调会话合并队伍 |
| ★2 谁说了算 | 两个概念各一个唯一加载函数：逃逸账本 → `scripts/escape-ledger-lib.mjs#loadEscapeLedger`；概念登记 → `scripts/concept-registry-lib.mjs#loadConceptRegistry`。文件名规则（id / subject ↔ 文件名）只写在这两处。读的人：check:escape-ledger、check:pr-judgement、merge-preflight、走查 monitor（经 `tests/ux/full-walk/escapeLedger.mjs` 追加）、两条铁律测试；check:concept-owners（工作树 + 参照提交）、build-capability-index、fix-churn-units、validation-policy 测试。只碰这两个概念。 | `rg -n "escapeLedger\|concept-owners" scripts src electron tests .github .agents .claude` |
| ★3 一致与复用 | 两本账本共用一份「一条一个文件」读写（`scripts/lib/entryDirectory.mjs`：工作树读、某个提交读、写一条），不各写一份。git 取数复用仓库里已有的 `ls-tree` + `cat-file --batch` 做法（同 concept-owners-scan）。不引新依赖：这是 30 行 fs / git 读写，没有能直接接的库。 | 代码 |
| ★4 全状态 | 目录不存在 → 门岗红（同旧的「文件不存在」）；某个条目 JSON 坏了 → 红并点名文件；文件名和 id / subject 对不上 → 红；`_meta.json` 缺 → 红；参照提交上还没有目录（本 PR 自己的 base）→ 按「参照上没有账本」处理，与旧文件缺失时一致。不适用于界面：无用户可见文案。 | node 测试 |
| ★9 验收与回滚 | 验收：特征对照——迁移前后 `loadEscapeLedger()` / `loadConceptRegistry()` 的条目集合与旧大文件逐条深相等；check:escape-ledger、check:concept-owners（含 `--map`）、check:full-walk-catalog 迁移前后输出一致（concept-owners 在 main 上本来就红 2 条，迁移后同样 2 条）；相关 node 测试与铁律 vitest 全绿。回滚：revert 本 PR 即回到两个大文件（迁移是纯数据搬家，没有别的状态）。 | PR 正文 `## 测试` |

### 功能分类

推不出类别（脚本 / 测试数据 / 文档改动）。

## 做法

- 逃逸账本：`tests/ux/full-walk/escapeLedger/<id>.json` 一条一个；`_meta.json` 放 `$schemaVersion`、`_doc`、`statusValues`、`categories`。id 只许 `[A-Za-z0-9._-]`、字母数字开头，大小写不敏感唯一。加载后按 `since` + `id` 稳定排序。
- 概念登记：`docs/engineering/concept-owners/<subject>.json` 一个一条；`_meta.json` 放 `_schema`、`schema_version`。subject 本来就只许点分的小写标识（没有 `/`、没有大写），所以文件名直接用 subject，一一对应且能 grep 到；subject 从此必填。加载后按 subject 排序。
- 「条目被删」= 文件在 base 有、head 没有（check:pr-judgement 看 name-status 的 D；merge-preflight 看 PR 文件表的 removed）。
- merge-preflight 只取本 PR 改动的条目文件在 base / head 两版算 fixed 转换；判「已结账合同」只在本 PR 修订了用户发现的合同时才去取 base 目录（一次 GraphQL 请求拿全目录内容，不是几十次 REST）。
- 一次性迁移脚本不进 main：同一个 PR 里一个提交加脚本并跑完、下一个提交删脚本；在途 PR 合 main 时用那个提交里的脚本把自己新增 / 改动的条目搬成单文件（命令见 PR 正文）。
