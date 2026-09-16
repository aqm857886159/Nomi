# 「先查别人」门岗升级：数出处 → 查覆盖面（分层表）

> 状态：📋 方案待拍板 —— 门岗代码与测试已在分支 `fix/prior-art-layer-gate-20260917` 备好；**CLAUDE.md / engineering-rules.md 的规则文字未改，等拍板**；不开 PR。
> 教训：`docs/lessons/architecture-plan-must-check-every-layer-for-prior-art.md`（在 `claude/nomi-oral-content-optimization-446a94` 分支，未合入）；violations.log v12 `prior-art-missing-layers`。
> 根因合同：[`../fixes/2026-09-17-prior-art-layer-coverage.root-cause.json`](../fixes/2026-09-17-prior-art-layer-coverage.root-cause.json)

## 0. 一句话

门岗现在只数「写了几条带出处的条目」，所以查得多就能过，漏掉整层也没人管。改成：每份新方案的「先查别人」节必须有一张**按层列**的表，六层每层一行。不涉及层取舍的方案写一行豁免；豁免是真是假，由 PR 的代码 diff 来核对。

## 1. 为什么（真实摩擦）

9 月 17 日的剪辑方案带 **8 条出处**通过了 `check:prior-art`，查的却只有两端：整个产品能不能搬、界面组件能不能用。中间层**一次都没查**：
- 时间轴标准模型 **OpenTimelineIO**（Apache-2.0），自带覆盖/插入/修剪/波纹等编辑算法；
- 剪辑引擎 **MLT**（LGPL，Shotcut 和 Kdenlive 的底层）。

结果方案写成「内核自己写」，还请用户拍板了顺序，最后是用户追问才补查出来。

**这类问题已经出现第二次了**：9 月 14 日的 pi 生态调研（`docs/roadmap/sources/2026-09-14-pi-ecosystem-gaps.md` §4）已经指出，三条仓库内部的出处也能过门岗、没人去看依赖里有没有，并给了「三个池子各至少一条」的改法。当时只给了形状，没有落地。两次漏的角度不同，一次按「去哪查」，一次按「查哪一层」，但机制相同：**判据量的是数量，不是覆盖面**。

## 2. 核心取舍：用什么信号判断「这份方案必须有分层表」

实测数据（9 月 17 日扫描 167 份受管方案，脚本见 §7 的复现命令）：

| 信号 | 实测 | 怎么绕过 | 结论 |
|---|---|---|---|
| A. 方案自报「架构」标记 | —— | 不写就行。而这次恰好是写的人自己没意识到这是架构取舍 | ✗ 正好就是这次的失败模式 |
| B. 正文里的层名词（内核/数据模型/引擎/渲染/协议…） | 163/167 份至少命中 1 个，99 份命中 ≥4 个 | 换个说法 | ✗ 几乎全中，等于没有区分度，误报又会逼人换说法 |
| C. 「自己写/自研/重写」挨着层名词 | 37/167，多数是「不引入框架」这种不动项套话 | 换个说法 | ✗ 精度不够 |
| **D. 默认都要表 + 封闭枚举豁免 + PR diff 反查（推荐）** | 豁免只能选「修复 / 界面调整 / 流程与文档 / 门岗与测试」四类，**没有「架构」和「其他」** | 要写下一句可以 grep 的具体谎话，而且一旦代码新增 >300 行模块或新增运行时依赖，豁免就失效 | ✓ 跳过要付出明确代价，还能被机器戳穿 |

**用户需要权衡的核心一点**：D 的成本是**每份新方案都要多写点东西**。架构方案写一张六行表（大概 10 分钟，本来就该查），其他方案写一行豁免。换来的是：不用再靠任何人「记得这是架构方案」。

## 3. 推荐方案 D 的规则形状（已在分支实现）

**方案侧**（日期 ≥ 2026-09-17 的 `docs/plan/<日期>-*.md`，更早的不追溯）：

```markdown
## 先查别人
| 层 | 现成候选（标准/引擎/算法）| 许可 | 抄/改/自己写 |
|---|---|---|---|
| 数据模型（时间轴） | OpenTimelineIO https://github.com/AcademySoftwareFoundation/OpenTimelineIO | Apache-2.0 | 抄 |
| 格式与协议 | 查过：无（https://github.com/search?q=…） | — | 自己写 |
| 对外接口 | 不涉及（本方案不改工具面） | — | 不涉及 |
```

- 必须覆盖的六层：**数据模型 / 操作与算法 / 引擎与运行时 / 格式与协议 / 对外接口 / 界面**。层名写在格子开头，后面可以加括号补充；允许加额外的行和列（比如「理由」列）。
- 每行三选一：① 候选**带出处**（URL / file:line / 仓库里真实存在的文件），且**写明许可**；② `查过：无（…）`，括号里**也要带出处**，结论只能是「自己写」；③ `不涉及（理由）`，结论写「不涉及」。
- 豁免：`分层查：不适用（类别：修复|界面调整|流程与文档|门岗与测试）—— 理由`。表和豁免只能二选一。每次门岗通过时都会**列出所有豁免的方案**，让漂移看得见。

**PR 侧反查**（`pull_request` 事件）：diff 里**新增文件的行数超过 300**（不算改名、不算测试），或 `package.json` 的 `dependencies` 里**新增了依赖**，就说明这个 PR 在长新的一层。这时正文引用的方案里，**至少一份必须带合格的分层表**。豁免在这里不算数，老方案也不算数，但老方案补上表就算。

## 4. 待拍板（一轮问清，每题带默认）

| # | 问题 | 默认 | 为什么 |
|---|---|---|---|
| Q1 | 信号选 D（默认都要表 + 枚举豁免 + diff 反查）？ | **D** | §2 实测，A/B/C 都能绕过或误报 |
| Q2 | 固定六层，还是每份方案自己列层（≥N 行）？ | **固定六层** | 自己列的话，写四行「整产品 / 组件库 / 开源 / 文档」也能过，正好就是这次的漏法 |
| Q3 | 「查过：无」的括号里是否也强制带链接？ | **强制** | 不带链接的「查过：无」就是门岗 ① 已经拒收的「查过了」那句话 |
| Q4 | 分层判据从哪天起生效？ | **2026-09-17（含）** | 这样能覆盖触发这条规则的剪辑方案本身 |
| Q5 | **连带面**：Q4 选 09-17 的话，`claude/nomi-oral-content-optimization-446a94` 分支上的剪辑方案合入时会变红，需要补一张表（那边的逐层调研 `layer-prior-art.md` 正在做）。接受吗？ | **接受** | 那份方案本来就要按教训重做分层调研，门岗红正好逼它补完 |
| Q6 | **连带面**：PR 侧反查对**在途 PR** 也立即生效（新增模块 >300 行或新增运行时依赖的，要给引用的方案补表）？ | **立即生效** | 按日期豁免 PR 可以通过引用老方案绕过；补表的成本只是给老方案加 6 行 |
| Q7 | PR 侧的新增依赖只看 `dependencies`，不看 `devDependencies`？ | **只看运行时** | 加 lint 插件、测试库不算层取舍，算的话误报多 |
| Q8 | 规则文字怎么落：R5.2 那一行的交付物加上「分层表」，L1 的 R5 一句话里加「**逐层**查」，教训挂到 INDEX？ | **是** | 见 §6 |

## 5. 不动项 / 回滚 / 验收门

- **不动**：判据 ①（≥3 条带出处）和 ②（>300 行必须引用方案）原样保留；老方案不追溯；不引入新依赖。
- **回滚**：`prior-art-lib.mjs` 的 `inspectPlan` 里去掉分层那几行，`check-prior-art.mjs` 里去掉 `layerSignals`，两处都可以单独 revert。
- **验收门**（已跑）：
  - 真实剪辑方案：**旧门岗 exit 0，新门岗 exit 1**（报告案例复现）；
  - `scripts/prior-art-layers.node-test.mjs` 共 13 条：缺表红、合格绿、老方案绿、缺层红、逐行九种红、豁免四态、代码块样例不算数、PR 反查六态、两个临时 git 假仓库端到端；
  - 变异验证：关掉方案侧判据、关掉依赖信号、把测试文件算进新增行数、让 PR 侧接受豁免、关掉缺层判据、去掉代码块过滤，六个变异体全部被测试打红；
  - **自测时顺带挖出旧判据的一个洞**：节抽取不跳过围栏代码块，本方案 §3 的样例 `## 先查别人` 反而被当成了正文。按旧判据，把合格样例放进代码块就能过，真节反而被遮住。已修（`blankFencedCode`），有测试覆盖；main 上 168 份受管方案修完仍然零红；

## 6. 规则文字提案（**未应用**，拍板后另起提交）

- `docs/engineering-rules.md` R5 表 R5.2 行的交付物改成：「同任务近邻开源给 `file:line`；**分层表（六层：数据模型 / 操作与算法 / 引擎与运行时 / 格式与协议 / 对外接口 / 界面，每层一行 候选·许可·抄改写，或查过：无（链接）/ 不涉及（理由））**；派工前反方 prior-art 报告」；门岗列不变。
- `CLAUDE.md` 规则索引 R5 ② 改成：「做方案 → 读近邻开源给 file:line + **逐层**列现成件（分层表，`check:prior-art`）+ 反方 prior-art 报告」；然后 `pnpm run gen:agents`。
- 把教训 `architecture-plan-must-check-every-layer-for-prior-art.md` 的「怎么用」一节指向本门岗。

## 7. 根因（P2 / R21 摘要）

- **症状**：方案带 8 条出处通过门岗，却漏掉了整层现成件。
- **直接原因**：`extractPriorArtSection` 只统计 `sourced.length ≥ 3`。
- **类根因**：门岗判的是**数量**不是**覆盖面**；「覆盖哪些层」全靠写的人记得。同类的第一次是 09-14 按池子漏查，这次是 09-17 按层漏查。
- **最早能拦住的那一层**：方案文档写出来的那一刻（方案侧判据）。第二层是代码进仓的那一刻（PR 侧从 diff 派生信号，不信自报）。
- **入口数**：方案侧的入口是 `evaluatePlans` 扫 `docs/plan/**` 这一扇门；PR 侧的入口是 `evaluatePullRequest` 加上新的 `evaluatePullRequestLayers`，两者由同一个 `check-prior-art.mjs` 调用。派工 brief 引用方案同样经过 PR 侧。门表用 `node scripts/door-map.mjs --read=evaluatePlans,evaluatePlan,inspectPlan,evaluatePullRequest,evaluatePullRequestLayers --roots=scripts` 生成，共 10 扇读门：9 扇在 `check-prior-art.mjs` 和 `prior-art-lib.mjs` 里，全部汇到 `inspectPlan`；剩下 1 扇 `check-door-map.mjs:92` 是另一个门岗里重名的 `evaluatePullRequest`，只是同名被匹配到，不是这份状态的门。

复现命令：`node scripts/check-prior-art.mjs`（在只放了那份方案的临时仓库里，旧版 lib 返回 exit 0，新版返回 exit 1）。

## 先查别人

- 同类门岗的上一版：`docs/fixes/2026-09-07-prior-art-not-enforced.root-cause.json`，判据 ① ② 与日期阈值豁免的写法本方案原样沿用；scripts/prior-art-lib.mjs:26 的节抽取逻辑复用。
- 09-14 三池子提案：docs/roadmap/sources/2026-09-14-pi-ecosystem-gaps.md:115，给了「按子节各数一次」的形状。本方案改为按层，理由是 09-17 的漏法在「层」这个维度；「池」可以作为后续的第二个维度。
- MADR 决策记录模板有「Considered Options」节，但官网明说没有校验工具：https://adr.github.io/madr/
- arc42 §5 按层级拆积木视图，第三方件「例外情况下才画进去」，也没有逐层查现成件的要求：https://docs.arc42.org/section-5/

| 层 | 现成候选（标准/引擎/算法）| 许可 | 抄/改/自己写 |
|---|---|---|---|
| 数据模型（方案文档的结构） | MADR「Considered Options」一节一选项 https://adr.github.io/madr/ | MIT OR CC0-1.0 | 改（一选项一行 → 一层一行） |
| 操作与算法（解析 Markdown 表格） | micromark GFM 表格解析 node_modules/.pnpm/micromark-extension-gfm-table@2.1.1/node_modules/micromark-extension-gfm-table/dev/lib/syntax.js:31 | MIT | 自己写 |
| 引擎与运行时（门岗测试） | node:test，同款门岗测试 scripts/check-prior-art.node-test.mjs:5 | Node 内置 | 抄 |
| 格式与协议（表格语法） | GFM 表格规范 https://github.github.com/gfm/#tables-extension- | CC BY-SA 4.0 | 抄 |
| 对外接口（CI 取 PR 正文） | 现有 env 注入 .github/workflows/quality-gate.yml:84 | 仓库内 | 抄 |
| 界面 | 不涉及（门岗只有终端输出） | — | 不涉及 |

「操作与算法」这一行写「自己写」的理由：micromark 只是 `streamdown` 带进来的间接依赖，`scripts/` 引用不到它；为了一个表格引入运行时依赖不值得。仓库里已有同样的正则按行解析写法（scripts/prior-art-lib.mjs:64），两边保持一致。
