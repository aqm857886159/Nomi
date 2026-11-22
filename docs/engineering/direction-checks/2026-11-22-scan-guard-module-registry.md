协调 11-22 代批：只因概念口径命中（测试与走查的临时目录归属，因 scripts/pre-push-structure.node-test.mjs 用 makeTempDir），要改的文件本身没命中；改法是换（按文件豁免 → 按模块登记，同提交删 NOT_SOURCE_SCANS 的 build-world.ok 条），不新增分支或特例。

# 方向检查：扫描型守卫按模块登记（2026-11-22）

补充说明：这一刀同时改到 `scripts/pre-push-contracts.mjs`（该概念登记的文件之一），但改的是批量守卫门岗的选择逻辑，不是它里面的临时目录回收部分；概念口径命中的其余文件本刀都没动。本文由实现线写，没有「没参与过的线」独立先写，这一点照实记下，交协调会话对照。

**这一处的全图在哪**：表外（推送前「扫描型守卫」登记表，`scripts/pre-push-scan-guards.mjs` 文件头注释写了来龙去脉：2026-10-10 一天漏 4 个，#1156 / #1142）。

### 0. 一句话根因

测试世界每多一个使用者，识别器就把它 import 闭包里旧数据名册（`tests/world/oldUserData.mjs`）的 `readdirSync` 当成这个测试自己的全仓扫描；登记粒度错在「测试文件」，应在 walk 所在的「模块」。

### 1. 归类表：命中计数里的 fix → 直接原因 → 类

命中计数是 `node scripts/fix-churn.mjs` 对这一刀改到的文件算出的「近 14 天 5 个 fix」，逐个列出（都只是因为改到了该概念登记的四个文件之一才被数进来）：

| 提交 | 碰到哪个文件 | 它修的是什么 | 和这一刀同一类吗 |
|---|---|---|---|
| a0149dee6（fix: 助手花钱时的批准只在主进程生成门一处判） | scripts/pre-push-contracts.mjs（删 1 行） | 付费批准判定归一，顺带去掉一行钩子里的引用 | 不是。付费批准的归属，和扫描型守卫的登记粒度无关 |
| e7acb6480（fix: 收口模型可用状态并补齐退役入口和执行反例） | tests/ux/_launchApp.mjs（14 行） | 模型可用状态收口、走查启动器里的相应清理 | 不是。模型可用状态，不是登记 |
| 559fa8fd8（fix(ux): validate owner inputs and align credential preload loading） | tests/ux/_launchApp.mjs（1 行） | 凭据预载入的输入校验 | 不是。凭据加载 |
| fe6cfdb5d（fix(ux): bind credential backend to isolated profile origin） | tests/ux/_launchApp.mjs（130 行） | 凭据后端绑定到隔离 profile 来源 | 不是。凭据与 profile 隔离（同一文件里，但不是临时目录归属，也不是扫描登记） |
| 3857e317b（fix(shell): 抽屉与 Agent 面板分隔条按下即认领手势，走查原始输入加站点上限） | tests/ux/_launchApp.mjs（15 行） | 走查原始输入加站点上限 | 不是。走查输入 |

结论：这 5 个 fix 都不是「临时目录归属」类，也都不是「扫描型守卫登记粒度」类；彼此和这一刀都不同类。命中只因概念登记的文件清单（`docs/engineering/concept-owners/delivery.test-temp-roots.json`）含这几个大文件，而这一刀要写的 `scripts/pre-push-structure.node-test.mjs` 又用了 makeTempDir 才被算进来。真正和这一刀同一类的是登记表自己的历史：#1156、#1142（同一天漏 4 个，当时的补法就是建这张表和识别器）；本刀是这张表第一次遇到「被登记对象之外的第三方模块带来证据」。

### 2. 为什么这一类会一直出现

识别器看的是「测试的 import 闭包里有没有对仓库的 walk」（`scripts/lib/scanGuardDetect.mjs:209` 的 `scanEvidence`）。闭包是传递的，所以任何共享的工具模块里有一个 walk，所有 import 它的测试都被当成扫描型守卫；登记只能写在「测试文件」这一层（`SCAN_GUARDS`、`NOT_SOURCE_SCANS` 都按文件），每个新使用者都得再写一条。名单随使用者数量线性长，和测试世界要推广到几百个测试的方向正面冲突。

不适用三条体验铁律（这是工程门岗，不是用户可见体验）；没有逃逸账本条目，结账不挂类检查。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 批 2 起每个迁到测试世界正门的测试，推送前快检都报「扫描型守卫测试没有去处」，要往 NOT_SOURCE_SCANS / SCAN_GUARDS 里逐个加 | 新建只 import `tests/world/index.ts` 的测试，跑 `node scripts/check-scan-guard-census.mjs`（本刀的必红用例即此） |
| 为省事有人把整个 tests/world 当「不扫描」整体豁免，真遍历 src 的测试也被放过 | 本刀反例用例：又 import 正门、又自己遍历 electron 的测试仍要自己登记 |
| 新增一份旧数据夹具，用到名册的测试在推送前不跑，到 CI 才红 | 改 `tests/fixtures/old-user-data/…` 后 `scanGuardsToRun([...])` 是否带上这些测试 |

### 4. 靶子独立性检查

- 识别器与登记表同一条线写的（2026-10-10 的 #1156 / #1142 修补线）；本刀的新用例直接断言识别器的输出（必红：没登记时报没有去处；反例：测试自己遍历仍报），不是只测登记表自己。
- 没有「修对了反而掉分」的先例。
- 靶子本身没有错：识别器认到名册的 readdirSync 是对的（确实有 walk），错的是登记层级。

### 5. 这一整块归谁（P0）

这一整块：推送前「扫描型守卫」的登记与选择（哪个测试遍历了哪些目录、改到就跑）
归谁：我们唯一的主人 scripts/pre-push-scan-guards.mjs 的 SCAN_GUARDS（scripts/pre-push-scan-guards.mjs:37）+ 识别器 scripts/lib/scanGuardDetect.mjs（scripts/lib/scanGuardDetect.mjs:209，scanEvidence）
我们哪里绕开了它：测试世界那条按测试文件写进 NOT_SOURCE_SCANS（原来在 scripts/pre-push-scan-guards.mjs:202，键 tests/world/fixtures/build-world.ok.node-test.ts），登记粒度放错了层

没有成熟的现成方案可接：这是我们自己仓库里「推送前选哪些测试」的登记，领域约束是仓库结构本身。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 把三个测试逐个写进 NOT_SOURCE_SCANS（或 SCAN_GUARDS） | 今天 3 行 | 会：每个新使用者再加一行，名单随测试世界推广线性长 | 名单越长越没人核对理由；被拦的是正门使用者 | 否 |
| 换一种做法 | 按 walk 所在的模块登记：`SCAN_MODULES`（scripts/pre-push-scan-guards.mjs:225）一条条目 + `moduleScanGuards`（:238）派生守卫；识别器证据全落在已登记模块里的测试自动算已登记，改到模块的 roots 才跑；同提交删 NOT_SOURCE_SCANS 里 build-world.ok 条 | 实现线一轮，5 条新用例 | 不会：新使用者零登记；模块条目必须真被识别器认到，陈旧项红；测试自己另有遍历仍要自己登记 | 派生要扫全部跟踪测试的闭包，所以只在改动碰到模块 roots 时才算 | 是 |
| 删掉 | 删 tests/world/oldUserData.mjs 里的 readdirSync（名册改成写死的清单） | 名册要手维护，新旧数据夹具多一份就要手改清单 | 清单漏改 = 新夹具不被名册看见，反而是新的第二个家 | 旧数据夹具由旧版真函数生成，手写清单会走样 | 否 |

### 7. 用户要权衡的核心

测试世界推广到几百个测试时，推送前要不要为「正门使用者」逐个登记：本刀的答案是不逐个登记，只在遍历发生的那个模块登记一次，代价是识别器多认一层模块级登记。

## 特征测试清单（动结构前先锁住）

- `scripts/pre-push-structure.node-test.mjs`：既有「扫描型守卫登记」几条用例（必红 / 陈旧项 / 去处表）在改动后照旧全绿。
- 同文件新增 5 条按模块登记的用例（没登记时报没有去处、登记后不报；改旧数据夹具选中、改 src 不选；测试自己又遍历仍要登记；陈旧 / 缺理由 / 被覆盖条目红；三个测试与 build-world 夹具不在任何按文件的名单里）。
- `scripts/pre-push-contracts.node-test.mjs` 的「必红：只新增一个扫 electron 的测试文件、没登记」整仓用例（CI 里跑）。
