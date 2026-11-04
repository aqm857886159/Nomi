# 走查门岗「不存在断言没有基线」：按被比较的表达式归属，不按附近有没有界面观测词

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：absence-without-baseline 的归属判据换成语法树　线：I-walk-absence-attribution　类别：其他（只动门岗与测试工具；不花钱、不长跑、不可打断、无界面）

触发：0.24.1 必带的中转视频线被 `node scripts/check-walkthroughs.mjs`（退出 1）挡住——`tests/ux/_relayVideoPaidSteps.mjs:49` 的 `expect(readCreates(), 'free preparation has not submitted a generation').toBe(0)` 比较的是 HTTP POST 次数，被判成「界面上的不存在断言」，只因往上 5 行内有 `locator(`。协调已定方向（P1 例外代批）：用语法树追到被比较的表达式，同提交删掉 5 行窗口，不新增分支或特例。方向说明：`docs/engineering/direction-checks/2026-10-30-walk-absence-attribution.md`。

## ★0 先查别人

- `scripts/lib/systemTempScan.mjs:1-120`（本仓）· 用 `typescript` 语法树建「名字 → 声明 + 初始值」表，按词法作用域链追变量来源、递归到根，限制写在头注释里 · **确认了**解析器用仓库已有的 `typescript`、不加包，追变量就用「作用域链 + 初始值」这个形状；**改了**作用域粒度：它按函数级合并同名变量，走查文件里同一函数内 `n`、`count`、`ok` 到处重名，这里 let / const 按块、var 按函数分开，否则别的块里的 `const n = 0` 会被另一个块的 `n = await loc.count()` 污染。
- `scripts/walkthrough-tool-args-lib.mjs:134`、`scripts/check-test-waits.mjs:46`、`tests/ux/_launchApp.test.mjs:59`（本仓）· 都用 `ts.createSourceFile(…, ScriptKind.JS)` 直接解析 tests/ux 的 `.mjs`，不预处理 · **确认了**走查源码能整份交给 TS 的 JS 模式（实测 682 份原文零语法错误）；**改了**喂原文、不喂 `stripComments` 之后的文本：它先剥块注释，`// 产出: tests/ux/shots/*.png …` 这种行注释里的 `/*` 会连后面几十行代码一起吃掉（`tests/ux/walkthrough.mjs` 剥后少 23 行、解析报 2 个错；`tests/ux/dangling-tailwind-tokens.walk.mjs` 报 9 个错），所以 `scan` 多收一个原文参数。
- ESLint 选择器文档 <https://eslint.org/docs/latest/extend/selectors> 与 `eslint.config.mjs:221`（走查目录已进 ESLint）· 页面列出的关系全是结构性的（节点类型、属性、父子 / 祖先 / 兄弟、字段），没有变量引用、绑定、作用域的语法 · **确认了**「`const n = await loc.count()` 隔几行 `if (n === 0)`」写不成 `no-restricted-syntax` 选择器，这条规则搬不进 ESLint（`scripts/check-walkthroughs.mjs` 头注释：能写成选择器的写法规则已搬走，本门岗只留判语义的）；自写 ESLint 规则要新开本仓没有的机制（`eslint.config.mjs` 只复用内置规则，没有本地规则插件）并换掉棘轮，不是这一刀的范围。
- eslint-plugin-playwright 规则表 <https://github.com/playwright-community/eslint-plugin-playwright>（67 条，10-30 取）· 有 `prefer-web-first-assertions`、`prefer-to-have-count`、`no-unnecessary-assertions`（管「永远不会失败的断言」，是反方向），没有「不存在断言要先证明探针有效」的规则；这个包也不在 `package.json`（`eslint.config.mjs:141` 只在注释里提到它） · **确认了**没有现成规则可接，也不加 npm 包；门岗继续自写，登记在 `gate-family`（`docs/engineering/self-written.json`，status under-review）。
- espree / @babel/parser / acorn / esquery / eslint-scope · 只是 eslint 与 typescript-eslint 的传递依赖，躺在 `node_modules/.pnpm` 里；在仓库根 `require.resolve` 全部 `MODULE_NOT_FOUND`（实测），而 `typescript@5.9.3` 是直接 devDependency、已有 40 多个脚本在用 · **确认了**解析器选择，不依赖传递依赖的路径。
- Playwright 1.60 自带类型 `node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/types/test.d.ts:8661,9207`（`LocatorAssertions.toHaveCount`，"Ensures the Locator resolves to an exact number of DOM nodes"）与 `:7935-8660` 的 `GenericAssertions`（`toBe` 在 `:7995`） · `toHaveCount` 只接 locator，`toBe` 什么都能比 · **改了**：`.toHaveCount(0)` 被比较的东西按 API 定义就是 locator，不再追来源（形参传进来的 locator 也命中）；`.toBe(0)` 才要追被比较的表达式——这正是 `readCreates()` 该被放过的那一类。
- 本仓事故史：`docs/release-notes/v0.24.0-rule-health.md:294`（#1101：`index === 0 ? 1500 : 900` 和 `n % 4 !== 0` 被误中，计数 63→64 越线，PR 正文说收口交给「换语法树」）、窗口的出处 `eec02cd65`（2026-08-18，「UI 观测常和归零比较跨行，所以往回看几行」）· 窗口只是「跨行变量」的廉价近似，从那天起没人改过它，只被绕开 · **确认了**方向是换成真的追来源，不是再补一条正则；这是同一类误报的第三次，上两次都只改了写法。

## ★1 任务与指标

当某条线往走查里写 `expect(readCreates(), …).toBe(0)` 这类 HTTP / 进程 / 几何 / 控制台的计数断言时，我想让走查门岗只在被比较的东西真是一次界面观测时才报「不存在断言没有基线」，以便真缺基线的界面断言照旧被拦，不相干的断言不再把一条无辜的线卡在门岗上。

步骤：① 规则收到原文（不是剥注释后的文本）→ ② 解析成语法树 → ③ 找出旧规则同一份形状清单的归零比较（`x === 0` / `x == 0` / `x !== 0`、`.toBe(0)`、`.toHaveCount(0)`，不增不减）→ ④ 取被比较的表达式 → ⑤ 沿变量初始值、每一次赋值、解构、for-of 来源、对字段的写入、本地函数的返回、evaluate 回调的返回追来源 → ⑥ 追到「数一数界面上有几个 / 看在不在」才记命中（词表见 `scripts/lib/absenceWithoutBaseline.mjs` 头注释）→ ⑦ 一行只记一次 → ⑧ 与棘轮基线比较，命中变化逐条对账。

不做什么：不新增归零形状（`toBe(false)`、`> 0`、`0 === x`、`!= 0`、`toHaveCount(0, { timeout })`、`expectCount(l, 0)` 照旧不认，缺口原样列在方向说明里）；不动 `expectAbsent(` 整份豁免；不改基线数字；不改任何走查。已知坑：`stripComments` 会被 `//…/*…` 吃代码；`.catch(() => 0)` 尾巴不能让观测断掉；evaluate 返回的对象里「别的字段」不能被带进来。

真实任务：① 中转线两份原件（`git show fa98d15dd:tests/ux/_relayVideoPaidSteps.mjs` 与 `…/_relayVideoCapabilityUi.mjs`）：第 49 行 `readCreates()` 不命中，同一份报告里 `_relayVideoCapabilityUi.mjs` 的 `await expect(page).toHaveCount(0)`（真缺 proveProbe，归中转线）照旧命中；② main 上 tests/ux 全部 682 份走查：旧规则 61 条逐条对账；③ 冷启动走查 `cold-start.e2e.mjs`：同一个 evaluate 返回对象里 `initial.projectCards === 0`（数界面卡片，命中）与 `initial.textModels === 0`（数模型目录，不命中）要分开。

| 指标 | 目标 | 量具 |
|---|---|---|
| 主：已知误报（HTTP / 进程 / 几何 / 控制台 / 模型目录计数）被判界面断言的条数 | 0（探索原型实测旧规则 11 条） | `scripts/check-walkthroughs.node-test.mjs` 新增用例 + `node scripts/check-walkthroughs.mjs` 全量对账（对账脚本放 `/Users/aoqimin/Nomi-coord/tmp/I-walk-absence-attribution/`，不入库） |
| 质量：旧命中里真界面断言的保留率 | 100%（61 条里 50 条保留，逐条人工判） | 同上，逐条列进报告 |
| 护栏：窗口以前漏掉的新命中 | 不吸收进基线；逐条列报告，停下交协调定（探索原型实测 12 条） | 同上；`scripts/walkthrough-baseline.json` 不动，棘轮守卫 `judgeBaselineGrowth` 照旧 |

界面与连带界面：不适用（开发者工具；输出是门岗红绿与前 8 处命中，沿用原格式）。

## ★2 谁说了算

概念「走查门岗的不存在断言判据」→ 唯一 owner `scripts/lib/absenceWithoutBaseline.mjs`（新），唯一消费者 `scripts/check-walkthroughs.mjs` 的 `absence-without-baseline` 规则；旧的 5 行窗口（`OBSERVES` 正则 + `slice(i - 5, i + 1)`）同提交删除，没有并行版、没有 fallback。基线数字归 `scripts/walkthrough-baseline.json`，只减不增由 `scripts/lib/walkthroughBaselineGuard.mjs` 守，本刀不碰。同一份事实只有一份。没有靠「东西不见了」猜意图。碰 1 个概念。门表：`node scripts/door-map.mjs findAbsenceWithoutBaseline --roots=scripts,tests,evals --include-tests`（输出贴进根因合同的 `doors`）。

## ★3 一致与复用

复用：`typescript`（直接 devDependency）；追变量的形状取自 `scripts/lib/systemTempScan.mjs`；判据住 `scripts/lib/` 并带单测，与同族 `positionalProjectOpen.mjs` / `composerInputReads.mjs` / `rawShellAnchors.mjs` 一致（`check-walkthroughs.mjs` 一 import 就跑整道门岗，规则就地没法单测）。不复用的理由：`systemTempScan.mjs` 没有导出可复用的作用域层，判据（来源是系统临时目录）与粒度（函数级）都不同。如实记一笔：仓库里手写「名字 → 初始值」追踪的门岗已有两个文件各写一份（`check-test-waits.mjs` 两处整文件一张表、`systemTempScan.mjs` 函数级作用域链），本刀是第三个；抽一个共用的作用域层是候选，但会同时改那两道门岗的判据与基线，不在这一刀里做，记在方向说明 §6。`git grep -n -E "scopeChain|declarations\.get|definitions\.set" -- scripts` 可复核。

## ★4 状态

无命中且不超基线：`✅ 走查质量门岗通过`；命中超基线：红，沿用原格式列前 8 处并指向 `expectAbsent(locator, { provenBy })`；命中少于基线：绿并提示「记得跑 --update-baseline 把棘轮拧紧」；源码有语法错误：TS 解析容错照样出树，`check:mjs-parse` 另管；追不到来源（形参 / import / 全局）：不命中，范围逐条列在方向说明与报告里；页内代码写成字符串：看不到（已知限制，同 `eslint.config.mjs` 里 tests/ux 当年整体豁免的原因）。取消中 / 过期 / 能力不可用：不适用（同步脚本，无外部资源）。门岗输出是中文开发者文案，不走 i18n。

## ★9 验收与反例（动手前写全）

验收：自验——`node --test scripts/check-walkthroughs.node-test.mjs`、`node scripts/check-walkthroughs.mjs`、`node scripts/fix-churn.mjs --staged`、`pnpm run check:root-cause-contracts`、`pnpm run gates`、推送前快检 `NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs`。不属于花钱 / 长跑 / 可打断 / 新界面四类，独立验收不适用；协调推送前复核本卡与对账表即可。

「这一类会从哪些入口、形状、边界回来」——特征测试与反例清单（`scripts/check-walkthroughs.node-test.mjs`，每条都要真跑出红 / 绿）：

| 组 | 反例 / 用例 | 期望 |
|---|---|---|
| 误归属，不许命中 | A1 `expect(readCreates(), '…').toBe(0)`，`readCreates` 是解构形参（中转线原样），往上 5 行有 `locator(` | 不命中 |
| | A2 同上，`readCreates` 是本地函数、函数体里数 `requests.filter(…)` | 不命中 |
| | A3 回调形参：`[...document.querySelectorAll('*')].filter((e) => e.children.length === 0)`、`.map((e) => (e.children.length === 0 ? … : …))` | 不命中 |
| | A4 元素几何 `br.width === 0`（`br = el.getBoundingClientRect()`）；读元素值 `Number(await loc.getAttribute('x')) === 0` | 不命中 |
| | A5 同一个 evaluate 返回对象里别的字段：`initial.textModels === 0`（`initial.projectCards` 并存） | 不命中 |
| | A6 控制台 / fixture 计数：`consoleErrors.length === 0`、`fixture.images.length !== 0` | 不命中 |
| | A7 违规清单：`[...document.querySelectorAll('img')].filter((img) => img.naturalWidth < 10).length === 0` | 不命中；`Locator.filter({ hasText })` 的 `.count()` 照旧命中 |
| | A8 `.not.toHaveCount(0)` / `.not.toBe(0)`（至少一个 = proveProbe 的形状） | 不命中 |
| | A9 下标与取模：`index === 0`、`n % 4 !== 0`（`n` 来自 count） | 不命中 |
| | A10 注释和字符串里的 `count() === 0` | 不命中 |
| | A11 作用域：别的块里同名 `n` 是 count，当前块的 `n` 不是 | 不命中 |
| 命中不许丢 | B1 `await expect(page.locator('x')).toHaveCount(0)`；形参传进来的 locator 的 `toHaveCount(0)` | 命中 |
| | B2 跨行：`const n = await page.locator('x').count()`，隔 8 行 `if (n === 0)`（窗口够不到） | 命中 |
| | B3 重新赋值、解构（含默认值）、for-of 来源、对字段的写入、`+=` | 命中 |
| | B4 `.count().catch(() => 0)` 尾巴 | 命中 |
| | B5 本地函数返回：`const cards = () => win.locator('x').count()` 后 `(await cards()) === 0` | 命中 |
| | B6 evaluate 回调返回表达式、返回对象字段：`initial.projectCards`（`projectCards` 来自 `document.querySelectorAll(…).length`） | 命中 |
| | B7 `querySelectorAll(…).length`、`[...document.querySelectorAll(…)]`、`Array.from`、`(await loc.all()).length` | 命中 |
| | B8 `expect.poll(() => loc.count()).toBe(0)` | 命中 |
| | B9 形状：`==` / `===` / `!==`、`toBe(0)`、`toHaveCount(0)`；一行多个比较只记一行 | 命中，一行一条 |
| 形状边界（现状，不改） | C1 `toBe(false)`、`> 0`、`0 === x`、`!= 0`、`toHaveCount(0, { timeout })` | 不认（缺口，原样钉住并列在方向说明里） |
| 反例真跑 | D1 把 `observes` 的归属改回「附近 5 行有观测词就算」 | A1 / A2 / A3 / A5 必红；改完按字节还原（sha256 对比） |
| 全量对账 | E1 `node scripts/check-walkthroughs.mjs` 在 main 全量跑 | 被去掉的命中逐条人工判；窗口漏掉的新命中逐条列报告并停下交协调，不动基线 |

回滚：撤回本次修复提交（判据模块、规则接线、测试在同一提交里）；基线文件本刀不改，回滚后与现状逐字节一致。未推送。
