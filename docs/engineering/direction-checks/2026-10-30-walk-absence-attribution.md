# 方向检查：走查门岗「不存在断言没有基线」按附近有没有观测词判，不按被比较的东西判（RW）· 2026-10-30

> 触发：`node scripts/fix-churn.mjs scripts/check-walkthroughs.mjs scripts/check-walkthroughs.node-test.mjs scripts/lib/walkthroughBaselineGuard.mjs scripts/walkthrough-baseline.json` 只命中**自写登记 `gate-family`**（status under-review，reviewBy 2026-10-31；近 30 天已有 95 个 fix，这一刀是第 96 个）。**命中的是登记这一级**——文件、目录、概念三级都没有输出：这条规则的判据（归零正则 + 5 行窗口）自 `eec02cd65`（2026-08-18）起一个字没改过（`git log -S` 查 `countsToZero`、`Math.max(0, i - 5)` 都只有这一个提交），该文件近期的改动都落在文件里别的规则上（composer-input-read、dead-data-attr、no-undef 搬家），不是这一条。
> **协调代批：改法是「换」**——5 行滑动窗口换成语法树追被比较的表达式，同提交删掉窗口，不新增分支或特例。按 CLAUDE.md P1 例外由协调会话代批（10-30）、事后报用户。设计卡：`docs/plan/2026-10-30-walk-absence-attribution.md`。

## 0. 一句话根因

规则问的是「这个归零比较附近有没有界面观测词」，该问的是「被比较的那个东西是不是界面观测」：窗口是「观测常和比较隔几行」的廉价近似，两头都不准——近的无辜计数被冤枉（HTTP、进程、几何、控制台），远的真断言被放过。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `eec02cd65`（2026-08-18）立规则 | 「观测常和归零比较跨行（先 `const n = await x.count()`，再 `if (n === 0)`），只看同一行会漏」，于是往回看 5 行 | 用邻近代替归属——立规则那天它就是近似 |
| #1101（v0.24.0，`docs/release-notes/v0.24.0-rule-health.md:294`） | `index === 0 ? 1500 : 900`、`n % 4 !== 0` 近 5 行有观测词，计数 63→64 越线；当时只把两处写法改成等价形式，判据没改 | 同类（绕开写法） |
| 本次：中转视频线 `_relayVideoPaidSteps.mjs:49` | `expect(readCreates(), '…').toBe(0)` 数的是 HTTP POST，往上 5 行有 `locator(` | 同类，第三次 |
| 窗口漏掉的 12 条（§3） | 观测离比较远于 5 行：隔着 evaluate 回调、本地函数、几十行前的 `const n = …` | 同一个近似的另一头 |

## 2. 为什么这一类会一直出现

- **表示层**：规则的输入是行文本，不是表达式。「被比较的是谁」在正则里没处放，只能拿「附近有什么」凑。
- **方向层**：棘轮把近似固化成了债的单位。61 这个数里混着 11 条冤案和 50 条真债，遇到冤案的人只有两条路——改写成别的形状躲开正则（#1101 的修法），或删掉安全断言（任务书明令不许）；门岗的信号被稀释，真债离观测远于 5 行就不被计入。
- **输入层**：规则吃的是 `stripComments` 的输出，而它先剥块注释：`// 产出: tests/ux/shots/*.png …` 这种行注释里的 `/*` 会连后面几十行代码一起吃掉（`tests/ux/walkthrough.mjs` 剥后少 23 行，TS 解析报 2 个错；`tests/ux/dangling-tailwind-tokens.walk.mjs` 报 9 个错；原文 682 份零错）。别的规则（`whole-page-text` 等）仍吃这份被剥坏的文本，本刀不动。
- 铁律 ⑩ ⑪ ⑫：不适用（开发者门岗，不涉及意图参数、可选项、可点目标）。逃逸账本：内部发现的门岗误报，不进逃逸账本（任务书明示）。

## 3. 不改结构的话，接下来会冒出什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 下一个往走查里写「数 HTTP / 进程 / 文件」断言的线，只要上面 5 行有 `locator(` / `.count()` 就被挡，出路只剩改写形状或删断言 | `scripts/check-walkthroughs.node-test.mjs` 的 A1 / A2：把 `expect(readCreates(), 'm').toBe(0)` 放在 `locator(` 之后 5 行内，旧窗口命中 |
| 真的界面不存在断言只要离观测远于 5 行，就不进棘轮，账面债被低估 | 语法树版在 main 上多出 12 条旧窗口都漏的命中：`agent-spend-real-image.paid.mjs:123`、`agent-thinking-rows.walk.mjs:60`、`canvas-drag-pan-gestures.walk.mjs:522 / 564 / 642`、`canvas-s5-walkthrough.walk.mjs:229`、`design-lab-primitives-forms.walk.mjs:106 / 125`、`marketing-home.visual.mjs:316`、`node-composer-placement.walk.mjs:347 / 476`、`storyboard-popover-keyboard.test.mjs:92` |
| 其它吃 `stripComments` 的规则会在更多文件上读到被剥坏的代码 | 把 `stripComments(raw)` 交给 `ts.createSourceFile(…, ScriptKind.JS)` 看 `parseDiagnostics`：现在 2 份有错，原文 0 份 |

## 4. 靶子独立性检查

- 尺子：特征测试（钉住旧规则覆盖的全部形状）+ main 全量对账。对账用的旧窗口复刻与线上基线逐字一致（复刻 61 条 = `walkthrough-baseline.json` 的 61），被去掉的 11 条逐条读过源码。尺子和修复是同一条线写的，所以全量对账表整张交协调复核，而不是只给结论。
- 没有「修对了反而掉分」的先例：不碰评测。
- 靶子本身有错：旧窗口这个靶子就是近似，先换靶子，不再往正则上补第三条绕法。

## 5. P0：这些是我们独有的吗？现成方案有哪些

归属判据是通用能力；「哪些调用算界面观测」（Playwright 的 locator 工厂、`querySelectorAll`、`count()`）是 Playwright API 加走查约定。现成方案查过（出处与结论见设计卡 ★0）：

- ESLint `no-restricted-syntax` 选择器：只表达结构关系，没有变量引用 / 作用域语法，写不出「`n` 是 `await loc.count()` 的结果」。
- eslint-plugin-playwright（67 条规则，没有「不存在断言先证明探针有效」；包也不在 `package.json`）。
- espree / @babel/parser / acorn：仅是传递依赖，仓库脚本里解析不到（`MODULE_NOT_FOUND` 实测）；`typescript` 是直接依赖、40 多个脚本在用，直接用它。

**自写登记 `gate-family`：为什么现在换不了、哪天换。** 登记的结论是「门岗检查的大多是 Nomi 自己的登记表与合同，没有现成工具；『只加不减』本身是问题，等门岗账本由用户拍板」。本刀属于「减」：删窗口、不增门岗、不增依赖；判据落在 `scripts/lib/`（不在 `gate-family` 的 paths 里），不是又一个 `check-*.mjs`。现成的替代（自写 ESLint 规则用 scope manager）要新开一套本仓没有的本地规则插件并把棘轮换成 `eslint-suppressions.json`——等门岗账本拍板后再看；那时本刀的判据可以整体搬走，测试清单跟着走。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案：选择器 + eslint-plugin-playwright | 把归零比较写成 `no-restricted-syntax` 选择器，装插件 | 选择器看不到变量来源，退回「同一语句内」，漏掉跨行变量——当年窗口要治的就是它；插件没有对应规则，还要新依赖 | 漏报面比窗口更大 | ❌ |
| 接入：自写 ESLint 规则（scope manager） | 新开本地规则插件，用 ESLint 的作用域分析追来源，棘轮换成 `eslint-suppressions.json` | 新机制 + 换棘轮 + 改 CI 行为 | 超出这一刀；换棘轮要全仓核对 | ❌（候选，等门岗账本） |
| 补 | 排除 `readCreates` 这类名字，或把窗口收成「同一语句」 | 小 | 就是 #1101 的修法，第三次；也是第三个特例分支 | ❌ |
| **换（协调已定）** | 窗口换成 `typescript` 语法树：被比较的表达式沿同文件来源追到界面观测，追不到的不算 | `scripts/lib/absenceWithoutBaseline.mjs` + 单测；规则接线删掉窗口（`scan` 多收一个原文参数） | 追踪面一扩大，窗口漏掉的 12 条显形，棘轮不能吸收，要协调定；追不到来源的是新漏口（§7） | ✅ |
| 删 | 删掉规则 | — | 真缺基线的界面断言没人拦 | ❌ |

推荐：换。理由——它不新增依赖、不新增特例分支，判据从「附近」换成「被比较的东西」，一次覆盖 #1101 的三元 / 取模、本次的 HTTP 计数、控制台与几何计数；同一个提交删掉窗口，没有并行版。后续候选（另一刀）：`check-test-waits.mjs` 两处、`systemTempScan.mjs` 与本判据各写了一份「名字 → 初始值」追踪，可抽一个共用的作用域层，但会同时改那几道门岗的判据与基线，本刀不做。

## 7. 用户要权衡的核心

要不要把门岗的账算准：冤案 11 条移出、真债 12 条显形，账面债净 +1（61 → 62），需要有人还（给那几份走查补 `expectAbsent`）或明批；不算准，则继续让无辜的线被卡、让真债被窗口藏着。另一个要认的口子：**追不到来源的（形参、import、全局）一律不命中**——任务书写的是「宁可报命中」，但实测 `expectAbsent(` 整份豁免之外的 348 个归零比较里，有 94 个追溯在形参 / import / 全局处断头（进程退出码与 spawn 状态、循环下标、传进判据函数的 facts、页内回调里读元素几何 / 样式、fixture 的期望值）。名字全部过了一遍并按类抽读了源码，没有发现「界面匹配数当形参传进来」的写法（完整清单在对账报告里，不入库）；若按「宁可报命中」把它们全算上，会把这一大片全判成界面断言，棘轮立刻 +94。代价是：界面计数经函数形参 / import 的辅助函数传进来的写法，门岗看不见。

## 特征测试清单（动结构前先锁住）

`scripts/check-walkthroughs.node-test.mjs` 的 `absence-without-baseline` 一组，按设计卡 ★9 的 A / B / C / D 编号：

- A（误归属，不许命中）：中转线原件形状（解构形参 / 本地函数的 `readCreates()`）、回调形参、元素几何与读元素值、同一 evaluate 返回对象里的别的字段、控制台 / fixture 计数、违规清单（`filter(函数)`）、`.not.toHaveCount(0)`、下标与取模、注释和字符串、块级作用域。
- B（命中不许丢）：`toHaveCount(0)`（含形参 locator）、隔 8 行的 `const n = …count()`、重新赋值 / 解构 / for-of / 默认值 / 字段写入、`.catch(() => 0)`、本地函数返回、evaluate 返回表达式与对象字段、`querySelectorAll(…).length` 各写法、`expect.poll`、`Locator.filter({…})`、形状清单全部写法、一行只记一次。
- C（形状清单边界，现状不改）：`toBe(false)`、`> 0`、`0 === x`、`!= 0`、`toHaveCount(0, { timeout })` 不认。任务书写的「`expect(await page.getByText('x').isVisible()).toBe(false)` 现在规则覆盖」与旧代码不符（旧正则只认归零比较，没有 `toBe(false)`），照旧不认，缺口交协调另议。
- D（反例真跑）：把归属改回「附近 5 行有观测词就算」，A1 / A2 / A3 / A5 必红；改完按字节还原（sha256 对比）。

## 裁定

协调按 P1 例外代批（10-30），事后报用户。
