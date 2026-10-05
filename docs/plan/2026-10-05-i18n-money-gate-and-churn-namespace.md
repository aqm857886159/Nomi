# 设计卡：「词典不谈钱」前移本地门岗 + 方向检查按词典功能键计数

日期 2026-10-05。起因见 `docs/plan/2026-10-05-direction-check-i18n-money-copy.md`（在 #1001 分支上）。用户 10-05 拍板「两条都做」。

## ★1 用户怎么用
- 谁：写界面文案的实现线 / 评审线。当……我改了词典，想……在本地提交前就知道有没有写出「免费 / 不花钱 / 不计费」这类断言，以便不用等 PR 的 Unit CI 才红、来回五六轮。
- 步骤：改 `src/i18n/locales/*.ts` → `pnpm run gates`（或 pre-push）跑到 `check:i18n` → 违例当场红并给改法。
- 方向检查：当……我第 3 次 fix 同一功能键，想……被拦下做复盘；而不是因为词典文件什么功能都改就天天被拦、真信号被淹。
- 不做：不改匹配器本身（沿用 `NO_COST_CLAIMS`）；不改 `fix-churn` 对非词典文件的数法；不做「跨命名空间按语义归类」。
- 已知坑：词典里同一类错散在不同功能键时，命名空间计数数不到一起（见 ★4 盲区）。
- 真实任务：①在 `generationCommon.ts` 临时加一条「不花钱」，`check:i18n` 必红；②在最近 14 天的 `origin/main` 上重放 `generationCommon.ts`，看按键拆开后各数多少。

## ★2 谁说了算
- 「界面不谈钱」判据：`tests/ux/full-walk/outcomeText.mjs` 的 `NO_COST_CLAIMS`（唯一一份，走查监视器与本门岗共用）；白名单只在 `scripts/check-i18n-no-cost-claims.mjs`（`OWNED_BY_SPEND_CARD_LANE` / `NOT_MONEY` / fixture 豁免），vitest 里那份已删。
- 方向检查的数法：`scripts/fix-churn.mjs` 唯一计数器（hook / commit-msg / CI 都走它），词典分支加在这里，不另起第二份。
- 碰 2 个概念，各有唯一 owner，没有新增概念。

## ★3 一致与复用 / 先查别人
- 复用：匹配器、`loadDictionaries`、`check:i18n` 链、`fix-churn` 的 history / evaluate / commit-msg 路径全部沿用。
- 先查别人：
  - eslint-plugin-i18next：规则是「JSX 里有没有硬编码字符串」，不是「词典里文案说了什么」，词典值不在它的检查面。
  - Crowdin QA checks / Lokalise QA：是翻译一致性与占位符检查，自定义禁用词只能挂在 TMS 平台上，我们没有 TMS，词典是 `.ts` 对象，本地门岗接不上。
  - Vale / textlint 一类写作 linter：能做禁用词，但吃的是文本文件；词典是嵌套 TS 对象且要读白名单与 fixture 豁免，还得再引入一个配置面。匹配器已经存在并有单测，包一层脚本比接一个新工具再翻译一份词表更省。
  结论：自写部分只有「读词典 + 套已有匹配器 + 白名单」几十行，理由是领域约束（Nomi 的「不谈钱」词表与付费卡披露例外）。
  - 方向检查：没有现成工具按「文件内顶层键」数 fix churn（code-maat / git-churn 类只到文件粒度），自写，登记理由：词典是我们独有的「一个文件装所有功能」的组织方式。

## ★4 全状态 / 文案
- `check:i18n-no-cost-claims`：通过 = 一行 OK；违例 = 逐条列 `语言 键: 文案` + 一句改法（「界面不谈钱（10-02）：只说事实和下一步，比如「本机处理」而不是「本机处理 · 不花钱」；必要的付费披露登记到白名单」）；白名单条目不再命中 = 报「白名单已烂」要求删行。
- 方向检查提示：「`generationCommon.ts#production` 近 14 天已有 N 个 fix，这一刀是第 N+1 个（词典按功能键计数）」。
- 计数口径：词典文件按「文件#顶层功能键」各数各的（缩进 2 格、值是 `{` / `[` 的键；中英同名一个）；一个提交改到几个键各计一次；落在键外的行归 `(根)`；阈值和窗口不变；词典不再投目录那一票。
- 盲区（如实写明）：见下方回放结果。

## ★9 验收与回滚
- 验收：`node --test scripts/check-i18n-no-cost-claims.node-test.mjs scripts/fix-churn.node-test.mjs`；`pnpm run check:i18n`；红 / 绿手验见 PR 说明。
- 回滚：revert 本 PR 即可（vitest 里那两条扫描会随之回来）。

## 回放：最近 14 天 `origin/main` 的 `generationCommon.ts`
29 个 fix 提交碰过该文件（按文件数就是第 30 个），按功能键拆开：observability 14、production 9、phaseDeadline 2、composer 2、canvas 2、spend / batchPlan / node / clipNode / imageToolbar / videoToolbar / decompose / derivative / recoverable / (根) 各 1。（一个提交改到几个键各计一次，所以键的合计大于 29。）

「谈钱」那五次：

| 提交 | 日期 | 落在的功能键 |
|---|---|---|
| `1cbdb8824` | 09-26 | spend、composer |
| `67abfe3ce` | 09-30 | production |
| `5342875b9` | 10-01 | observability |
| `92da5043d` | 10-02 | observability |
| `4babc627e` | 10-02 | batchPlan、production、phaseDeadline |

结论：它们分散在 5 个功能键里，observability 和 production 各有 2 次，但那两个键里同时堆着别的 fix（14 个、9 个），数出来的是「这个功能被反复修」，不是「谈钱这类错在反复冒」。所以命名空间计数能让真正反复修的功能（observability、production）显出来，却**抓不到「同一类文案错散在多个功能」这个盲区**；这个盲区由第 1 件的 `check:i18n` 文案扫描补，不靠改口径凑数。
