# 方向检查：边界主人门把「定义搬走、旧文件还 import 着」误判成台账过期（2026-10-28）

协调代批（10-28，P1 例外），事后报用户：只因自写登记口径命中、改法是换。

触发（本线 10-28 实跑 `node scripts/fix-churn.mjs scripts/boundary-owners.mjs scripts/check-boundary-owners.mjs scripts/concept-owners-lib.mjs scripts/check-concept-owners.mjs scripts/pre-push-gate-table.mjs`）：只命中自写登记 `gate-family`（状态 under-review，近 30 天已有 94 个 fix，这一刀第 95 个）；`scripts/boundary-owners.mjs` 单独跑是「未命中热点」。改法是换判据：登记了改锚的边界，「主人还在原地」从「文件里有这个词」换成「文件里还定义着它」，同提交把旧判法从这条路上拿掉，不新增分支、不留开关。

## 0. 一句话根因

两道门岗对「合同声明的主人今天还在不在」各有一个答案：`check:boundary-owners` 数「文件里有没有这个词」（`resolveSymbol` → `hasWord`），`check:concept-owners` 要「写接口所在文件里有这个符号的**定义**」（`evaluateOwnership`，别名、重导出不算）；词在比定义在宽，原样搬家且旧文件还 import 着的共享边界正好落在两个答案之间，台账写不写都有一道门红。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 同步出图落地线（`fix/sync-landing-not-unknown-r2`，HEAD `3f7bc054a`）：`retrievalStageError` 原样搬进 `electron/tasks/retrievalStageError.ts`，`taskResultQuery.ts` 仍 import 并调用。记了改锚 → `check:boundary-owners` 退出 1，报 2 条「台账条目已经自己好了」；删掉这两条 → `check:concept-owners` 退出 1，报 2 处 `unregistered-boundary` | `evaluate()` 看到旧锚判 OK 且台账登记了改锚，就报过期；`hasWord` 看不出「只剩 import」 | 两道门对「主人在不在」两个答案 |
| 同一原因的另一种形状（本线读代码推出，测试 ⑤ 钉住）：旧符号已删，旧文件只在注释或字符串里还提到它，改锚条目同样被报过期，作者被逼着删掉一条真在用的改锚 | `hasWord` 不分代码、注释、字符串 | 同上 |
| 实测：main（`ace369c78`）上 52 条改锚没有一条旧锚还留着这个词（30 条符号已删、22 条文件已删），也就是现有改锚里这个口径分叉还没被踩中过，同步出图落地线是第一次 | 同上 | 同上 |
| 同一次验证里撞上的邻居：入口只认 `--repo-root <目录>`，`node scripts/check-boundary-owners.mjs <目录>`（位置参数）被静默忽略，检查的是脚本所在的这棵树并报绿（实测：位置参数 → 声明 1905 条、退出 0；`--repo-root` 指同一棵分支树 → 声明 1908 条、退出 1） | 参数没有白名单 | 静默忽略输入 = 假绿 |

## 2. 为什么这一类会一直出现

- 「主人在不在」被实现了两遍：`scripts/boundary-owners.mjs` 的词边界匹配，和 `scripts/concept-owners-lib.mjs` 经 `scripts/concept-owners-scan.mjs` 的 `collectDefinitions`（TypeScript 解析）找定义。10-27 的那次分叉只合了「读哪个锚」（`reanchorResolver`），没合「锚上有没有主人」。
- 搬家的顺序决定了它必然踩中：先把定义搬走，旧文件留下 import，词一直在、定义没了。以后每一次搬走共享边界而旧文件继续用，都是同一个红。
- 铁律 ⑩ ⑪ ⑫：不适用，这是门岗之间的口径分叉，不碰产品行为。这条不是逃逸账本来的修复（实现线推送时被快检挡住），没有要结的账。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 同步出图落地线推不出去，它并 main 之后 CI 的 `check:boundary-owners` 同样红 | 修前：`node scripts/check-boundary-owners.mjs --repo-root <那棵工作树>` 退出 1 |
| 下一个「原样搬走共享边界、旧文件继续 import」的 PR 同样卡在两道门之间 | 特征测试「现状（特征）」两条（修前绿、修后翻转） |
| 旧符号删了、注释里还留着旧名，改锚条目被报过期 | 测试 ⑤ |

## 4. 靶子独立性检查

- 尺子不是这条线写的：「谁定义了这个符号」是 TypeScript 编译器的解析（`collectDefinitions` 用 `ts.createSourceFile` 走 AST），`check:concept-owners` 一直用它；本刀不另写定义判断，也不写正则版。
- 没有「修对了反而掉分」的先例。换判据对 main 上现有 52 条改锚零影响（上面实测，修前修后统计行逐项相同）。
- 并行对照：测试 ⑩ 拿同一批 11 种代码形状，同时问边界门的新判据（`ownerDefinedAt`）和概念门的 `evaluateOwnership`，要求两边同向。
- 实跑对照：同步出图落地线那棵树，修前 `check:boundary-owners --repo-root` 退出 1（2 条过期），修后退出 0、改锚 54 条全部在位；同一棵树上 `check:concept-owners` 也是 0。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- **现成方案**：「一个符号在哪里被定义」本来就是编译器的活（TypeScript 编译器 / 语言服务，版本见 `package.json:395` 的 `typescript ^5.6.3`，出处 <https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API>）。**已经在用**：`collectDefinitions` 是 `ts.createSourceFile` 的 AST 遍历，本刀只复用它，不接第二个。
- 「合同里声明的边界主人」和「改锚台账」是本仓自定义的契约（`docs/fixes/*.root-cause.json` 的 `shared_boundaries`、`scripts/boundary-owners-ledger.json`），没有现成工具能核它，这是自写登记 `gate-family` 的 whyNotIntegrated：门岗检查的是 Nomi 自己的登记表与合同。
- 自写登记条目：`gate-family`（`docs/engineering/self-written.json`，under-review，reviewBy 2026-10-31）。**现在换不了**：台账和合同是本仓独有的契约，工具里没有对应物。**哪天换**：`gate-family` 到期评估（2026-10-31）时一并定边界门与概念门要不要并成一道；并了，「主人在不在」只剩一份实现，本刀加的这处共用随之并入。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | TypeScript 编译器 / 语言服务判定义（出处见 §5） | 无新依赖：`collectDefinitions` 就是它 | 无 | **是**：复用现成的那一份，不另接 |
| 换（已做） | 登记了改锚的边界，「主人还在原地」= 旧锚今天定义着它（复用 `collectDefinitions`）；不定义了 → 照原来的改锚路径核新锚，在就算改锚、不在就报「新主人也不在了」；仍定义着才报过期。退役 / 待查 / 机器读不了三个桶、没登记改锚的边界口径不动；入口同提交改成拒绝 `--repo-root` 以外的参数（退出 2） | 一处判据，`resolveSymbol` 与新判据共用同一个标识符拆分；`check:boundary-owners` 多 import 一个 TypeScript 模块，实测多约 0.2 秒 CPU（用户态 0.12 → 0.3 秒，墙钟 0.35 秒 → 0.28 到 0.47 秒，在噪声内）；只对旧锚词还在、又登记了改锚的那几条解析源码，不整仓扫描 | 旧锚是测试 / 夹具 / 类型声明 / 非代码文件、或 symbol 是字面量时没有「定义」可判：沿用文本命中，和概念门的 else 分支同一个口径 | **是** |
| 补：边界判 OK 且登记了改锚时，「新锚也在就跳过过期检查」 | `evaluate()` 里加一个特例分支 | 小 | 主人又搬回旧文件、两处都定义时，过期的条目永远留在台账里；又一个特例，下次再分叉 | 否 |
| 重写：两道门并成一道 | 边界门的判据整个并进概念门 | 大，且要动 concept-owners 系列（本刀范围外） | 概念门只管 09-27 起的受管合同，更早的合同会失去检查 | 留给 `gate-family` 到期评估 |
| 删：删掉边界门 | 只留概念门 | 小 | 边界门核的是全部合同（含 09-27 之前）声明的主人还在不在，概念门不覆盖 | 否 |

## 7. 用户要权衡的核心

没有要权衡的：两道门对「主人在不在」要么一个答案、要么台账永远有一道红，修法唯一；这刀让边界门改用概念门那个答案（看定义），而不是再给它加一个特例。事后报用户。

## 特征测试清单（动结构前先锁住）

`scripts/check-boundary-owners.node-test.mjs`（先钉现状：动判据前 18 条全绿，其中两条「现状（特征）」断言的就是 bug 本身；修后 26 条全绿）：

- 「现状（特征）：定义搬走、旧文件还 import 着、台账登记了改锚 → 判『台账条目已经自己好了』」：本次 bug 本身，修后翻转成测试 ①。
- 「现状（特征）：…新锚也不在 → 同样只说『已经自己好了』」：修后翻转成测试 ③「新主人也不在了」。
- 「不变量：旧文件又把它定义回来 + 台账还登记着改锚 → 报过期」（②）、「不变量：没登记改锚的边界，词还在（只剩 import）就是在位——口径不变」（④）：修前修后原样要绿。
- 既有 14 条（含「改锚登记会接着核新锚」「退役与待查放行，但台账条目自己好了必须删掉」）原样要绿。
- 修后新增：⑤ 注释里的旧名、⑥ 多段 symbol、⑦ 字面量 symbol、⑧ 目录锚、⑨ 无可扫描源码、⑩ 两道门同向表、⑪ 入口端到端，以及入口拒绝 `--repo-root` 以外的参数。`check:concept-owners` 自己的 28 条测试（含「两道门对同一份台账认同一个锚」）原样绿。
