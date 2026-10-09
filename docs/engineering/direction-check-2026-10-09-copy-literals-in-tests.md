# 方向检查：改文案就有一串测试红（测试把文案当字面写死）

> 触发：#1099（界面不谈钱）同线第 9 轮修补（模板第 4 条）。2026-10-09 RC-copyliterals 线写，结构性结论待协调会话拍板。
> 裁决（协调会话，2026-10-09）：做 B + C，A 是门岗报红时唯一允许的改法；第 5、6 条按合同 contract-moneycopy 只删金额断言、改成「卡上不出金额」。
> 普查口径已落成门岗 `scripts/check-test-copy-literals.mjs`（挂在 `check:i18n`），首次基线 429 文件 / 1,490 处（比 §1 多出的是合入最新 main 与主进程文案表一起计入）。

### 0. 一句话根因

测试断言的是「字」不是「键 / 意思」：界面文案是产品决策，会改；测试却把它手抄成字面量（断言值、定位器名字、豁免表的身份、词表的「真实例句」），于是文案和测试各有一份真相，每改一次文案，所有手抄的地方就得一个个撞红再改。仓库里已有「从词典取值」的工具（`tests/ux/full-walk/invariants.mjs` 的 `uiText`），但没有任何东西拦着新测试继续手抄。

### 1. 归类表：bug → 直接原因 → 类

#1099 共 16 个非合并提交，其中 6 个是在改「别处写死的旧文案」，加上本轮共 7 次：

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `43d65c243` task-center-states 走查 | 断言 `'只查结果，不重新生成，不花钱'` 字面 | 字面断言（已改成 `uiText`） |
| `184ea8997` 5 个测试 / 走查 | `'… · 会消耗模型额度'`、`noCost: '不新增花费'`、`'保存验证'` 等字面 | 字面断言 + 字面定位器 |
| `92f6995dd` agentIdentity 测试 | 断言系统提示词里一句原话 | 字面断言（非词典常量） |
| `5d654bd2d` / `f03576995` feel 豁免 | 豁免表拿文案当元素身份 | 文案当身份（`f03576995` 已结构修） |
| `4f0872e23` core-smoke spend-confirm | 断言卡上有 `0.30` | 旧产品决策（不是字面问题） |
| 本轮① `vendorOutboundGuard.test.ts:57` | `/没有扣费\|nothing was charged/` | 字面断言 |
| 本轮② `outcomeText.test.mjs` estCostUnknown | 按键名清单断言「这几条是价格说法」，键的意思已变（值是「处理量待确认」） | 词表测试手挑对象，键名不再说真话 |
| 本轮③ `outcomeText.test.mjs` 不误报 | #1099 把 `免费 / free` 改成一刀切，「不误报」例句是手抄的旧真实文案 | 词表测试手抄例句；**连带真 bug**：走查监视器 `findLeaks` 没有按键豁免，英文界面真实文案 `Free`（画幅）、`Free orientation`、`Free up space…` 会被判成谈钱 |
| 本轮④ core-smoke spend-confirm | `toHaveText('生成这张')` 精确比整颗按钮，按钮里有 `aria-hidden` 的 `⏎` 键帽 | 断言整段可见文字而不是这个控件的名字 |
| 本轮⑤ E2E agent-spend-card / agent-spend-full-auto | 断言卡上有 `0.30` | 旧产品决策（不是字面问题） |

注：任务书写的是 3 处，CI 实际红 6 条（Unit 3、Core Smoke 1、E2E 走查 2），上表全列。

**普查（2026-10-09，`fix/money-copy-truth` @ `71b733b4f`）**：词典 12,694 条（渲染层 `src/i18n/resources.ts` + 桌面 `electron/desktopStrings.ts`，中英），扫 2,722 个测试 / 走查 / 冒烟文件。口径：字符串或正则字面量**完全等于**某条词典值（或其 `{{占位}}` 切出的片段），且够长（中文 ≥4 字、英文 ≥14 字符含空格）。

| 目录 | 文件 | 处 | 代表例子 |
|---|---|---|---|
| `tests/ux/*.walk / *.e2e`（真 App 走查） | 263 | 867 | `getByText('新建空白项目')`（149 个文件都写了这句） |
| `src/**/*.test` | 71 | 325 | `classifyGenerationError.test.ts` 一个文件 70 处 |
| `tests/` 其他（agent-runtime 等） | 48 | 124 | `lane-approval-gate.test.mts`「这条片子是给谁看的？」 |
| `electron/**/*.test` | 37 | 58 | `'Place on canvas'` |
| `tests/ux/full-walk`（监视器 / 目录 / 词表） | 4 | 33 | `catalog.mjs`「Generate an image」 |
| `scripts/*test` | 5 | 10 | `'撤销时间轴编辑'` |
| **合计** | **428** | **1,417** | 另有 524 处「是词典某条的子串」，夹杂用户输入，不计入 |

抽样 40 处：约 33 处是真的拿文案做断言或定位，约 7 处是误命中（`describe / it` 标题、恰好和词典示例同句的夹具输入）。已经在用 `uiText` / 读词典的测试只有约 30 个文件。

### 2. 为什么这一类会一直出现

- 写测试最顺手的就是把屏幕上看到的那句话抄进来；`uiText` 存在，但没人被要求用，新测试照抄，存量越积越多（1,417 处）。
- 文案是产品决策，改得比行为勤；每次「界面不谈钱」这类全站改词，都要全仓撞一遍红才知道谁抄了。CI 一轮 30 分钟，于是一个 PR 拖到第 9 轮。
- 词表测试（outcomeText）同样手抄：「会红」的对象按键名挑、「不误报」的例句手抄真实文案；键改了意思、文案删了，测试守的就是一份已经不存在的世界。
- 豁免机制两套：`check:i18n` 按**键**豁免，走查监视器只看得到**文字**，没法按键豁免——同一个词表两个消费者，规则不一致。

铁律对齐：**⑩ 说的 = 摆的**。测试真正要守的是「界面显示的 = 词典里那条键的值」和「某类说法不许出现（词表扫词典本身）」，不是某句话的字面。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 「新建空白项目」改一个字，149 个走查文件全红 | `grep -rl 新建空白项目 tests src electron \| wc -l` |
| 改任一条生成失败人话，`classifyGenerationError.test.ts` 跟着红（70 处字面） | 改 `generationCommon` 里任一条 reason 后跑这个文件 |
| 英文走查里监视器把画幅按钮 `Free`、`Free orientation` 判成谈钱，误报 escape | `findLeaks('Free orientation')` 现在就返回 `price-wording` |

### 4. 靶子独立性检查

- 词表（`NO_COST_CLAIMS`）和守它的测试都是 #1099 这条线改的，「不误报」那一组就是被同一条线改坏的——靶子自己错了。先修靶子：豁免只认键，监视器那边的豁免文字从词典里按键取，不再手抄。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗？现成方案

不是领域能力，是测试基础设施。现成的：
- i18next 自带 `cimode`（`changeLanguage('cimode')`，`t` 直接返回键，专为测试；出处 i18next API 文档 `i18n-instance.md` changeLanguage 一节）——单测里能让组件吐键而不是字，但只管渲染层、管不到 `desktopStrings` 和真 App 走查。
- Playwright 的 `toHaveAccessibleName` / `getByRole({ name })`：按控件名字认，`aria-hidden` 的键帽不算进去（本轮④的正解）。
- `eslint-plugin-i18next` 的 `no-literal-string` 管的是产品代码没翻译的字面量，不管「测试抄了词典值」；没找到现成工具做这件事。
所以「测试不许抄词典值」这道门只能是薄脚本，归 `gate-family`（under-review，复评 2026-10-31）；比对源头接现成的 `uiText` / `desktopT` / tsx 加载，不另写词典解析。

### 6. 选项对比 + 推荐

| 选项 | 做什么 | 改动面 | 一次做完？ | 误伤 | 推荐 |
|---|---|---|---|---|---|
| A 测试一律经词典取值 | 断言 / 定位改成 `uiText(locale, key)`、`desktopT(key)`、`toHaveAccessibleName(uiText(...))`；单测可开 i18next `cimode` | 存量 428 文件 / 1,417 处 | 否（一次性全改是几百文件的大 PR）；没有门岗会继续回流 | 无 | 作为门岗红时**唯一允许的改法** |
| B 门岗棘轮 | 新脚本扫测试 / 走查 / 冒烟（含 `tests/**/*.json` 豁免表）里「完全等于词典值」的字面量，按文件计数入基线，只减不增；`describe/it` 标题跳过；允许清单只给词表测试本身；挂进 `check:i18n`（本地 gates + CI 都跑） | 新增脚本 + 自测 + 基线 JSON + `package.json` 1 行 ≈ 4 文件 | 是 | 约 15%（夹具输入恰好等于词典句）——进基线不报，新写的才报 | **推荐（主）** |
| C 词表测试从词典生成被检对象 | outcomeText「会红」改为扫整本词典 + 键豁免单一来源；删「这几条真实文案被词表抓到」（词典里已没有价格说法，它的靶子不存在了）；「不误报」例句改成从 `NON_MONEY_KEYS` 按键取词典值；监视器 `findLeaks` 豁免同一批键的值 | 3 文件（`outcomeText.mjs`、`outcomeText.test.mjs`、`check-i18n-no-cost-claims.mjs` 导出键表） | 是 | 无 | **推荐（词表部分）**，顺手修掉监视器误报真 bug |

推荐：**B + C，A 作为改法**。本 PR 内：落 B 的门岗（存量进基线）+ C 的三文件；本轮 6 条红按 A 改（①用 `desktopT` 取提交侧那条键比对；④改 `toHaveAccessibleName(uiText(...))`；⑤两条走查改成新合同「卡上不出金额」，这两条是产品决策变了，不是字面问题）。存量 1,417 处不一次清，谁碰谁改、基线只减。

不选的：只做 A（没有门，新测试照抄，`uiText` 09-29 就有了，之后新增的测试文件里仍有 30 个抄了 83 处字面，用它的只有约 30 个文件）；单测全局开 `cimode`（一次让 71 个 src 测试文件同时红，且管不到走查，先不做，存量降下来后再评估）。

### 7. 用户要权衡的核心

要不要接受「写测试时不能直接抄屏幕上那句话、必须写词典键」这点麻烦，换以后改文案不再全仓撞红（本 PR 拖到第 9 轮就是这个代价）。

## 特征测试清单（动结构前先锁住）

- 现状已被 CI 钉住：Unit 3 条（`vendorOutboundGuard.test.ts`、`outcomeText.test.mjs` 两条）、Core Smoke `spend-confirm`、E2E `agent-spend-card` / `agent-spend-full-auto`，见 #1099 run 37860087508。
- 门岗落地时先写反例自测：新增一处 `expect(x).toBe('<某条词典值>')` 必须红；`describe('<词典值>')` 不红；基线里的旧文件不红。
- 监视器误报：`findLeaks('Free orientation')` 落 C 之前返回 `price-wording`，之后返回空。

## 落地（本 PR）

- B：`scripts/check-test-copy-literals.mjs` + 自测 `scripts/check-test-copy-literals.node-test.mjs` + 基线 `scripts/test-copy-literals-baseline.json`，挂进 `package.json` 的 `check:i18n`；`electron/desktopStrings.ts` 导出 `desktopTranslations` 供门岗读主进程文案表（运行时取词仍只走 `desktopT`）。
- C：例外键 `NOT_MONEY` / `NON_MONEY_KEYS` 从 `scripts/check-i18n-no-cost-claims.mjs` 搬进 `tests/ux/full-walk/outcomeText.mjs`，门岗按键豁免、监视器用 `compileExemptions(词典)` 按同一批键取值豁免；`outcomeText.test.mjs` 的被检对象改成从整本词典生成。
- 6 条红按 A 改：① `desktopT('outbound.submitFakeIpBlocked', …)` 比对；② 删按键名猜意思的那条，换成整本词典扫描；③ 删手抄例句，改成例外键的词典值逐条过监视器；④ `toHaveAccessibleName(uiText(...))`；⑤⑥（连同 ⑤ 调用的 `_agentSpendScopeJourney.mjs` 里同形的 0.90）只把金额断言换成「确认控件不出金额」。
- 本机屏外跑 `agent-spend-full-auto` 时，删掉 0.30 后紧跟着又撞到一处手抄旧句「付费生成也会直接跑」——正是 §3 预测的那一类，同样改成 `uiText` 取值（走查遇第一处红就停，CI 只报得出第一处）。
- 没在本 PR 动、留给协调会话排的：不在 CI 里的 `agent-spend-priced-card` / `agent-spend-reprice` / `agent-spend-r30` 走查仍断言卡上有金额（同属旧产品决策，不是字面问题，门岗也抓不到）。

