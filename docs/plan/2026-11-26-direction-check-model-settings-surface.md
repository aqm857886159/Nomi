# 方向检查：模型设置 / 积分用量这一屏，为什么一轮轮和拍板图对不上（#1665）

> 写的线：RW-1665（没参与过 #1665 的实现和验收）· 2026-11-26。只读代码、报告、截图。
> 依据：分支 `origin/feat/t6a-settings-models-and-policy` @ `9e436ebda`，行号都按它；另有 L8 已暂存、未提交的第 4 刀。
> 触发：
> - `fix-churn` 判 `src/ui/onboarding/ModelAccountCard.tsx` 14 天内第 4 个 fix。
> - `12f6d8483` 撤回了 `953eb7973` 的固定高，是一个 fix 撤另一个 fix；标题不带 revert，`fix-churn` 数不到。
> - 同一条线已修补到第 3 轮以上。
>
> 没找到：T-6a 最初的派工书（`tmp/briefs-*`、coord-handoff/briefs 里 grep 只搜到 1126 这一批）。所以「派工没出表」是按设计卡和清单里都没有这张表推出来的。

**这一处的全图在哪**：表外。`docs/engineering/seams.json` 里没有设置 / 接入这一处。全图暂时用两份文件代替：拍板清单 `docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json`，流程 `docs/engineering/design-pipeline.md:31-41`。本线只写自己的目录，没登记；要不要补，由协调定。

### 0. 一句话根因

拍板图上的数字（字号、间距）和图上没画出来的状态，从出稿到合并没有一处用机器量过：

- 出稿时字号不过字号表；
- 派工时没有逐元素、逐态的对照表；
- 走查只量「字在不在」；
- 并排图的缩放把小一档显示反了；
- 设计实验室整屏跳过这一页；
- 「已实现」由实现线自己翻。

所以差异只能靠人眼一轮轮找，谁读了数字，谁就找到几处。

### 1. 归类表

分支上 `origin/main..` 之间的 fix 提交只有下面 4 个。旧复盘还被 `1dd26d84b`（docs）和 `3f1781bc4`（refactor）当作 trailer，这两个不是 fix，不归类。

| 提交 / 问题 | 直接原因 | 类 |
|---|---|---|
| `97f03c5d7` feat（起源） | 大数字写成 13px（板上 18）；三格之间没有分隔线；AI 卡改成 `<details>` 后，外层 gap 作用不到展开后的内容；同一提交自己把清单十几个元素从 missing 翻成 implemented（清单 `stage` 仍是 `explored`） | 实现没照图，状态自己翻 |
| `d56ec3989` | 补上三格竖线 | 实现没照图 |
| `87e42046a` | 板上「用量与单价」超过 `check:controls` 的控件文案长度，改成「用量」并加 aria-label | 画稿本身不合规（图和门岗冲突） |
| `953eb7973` | 为过 CI 把设置框钉死在 560，并重录两张基线；板上是「高随内容 360–560」，断言 `360 ≤ 高 ≤ 560` 放过了固定 560 | 断言量的不是图上那个东西 |
| `12f6d8483` | 补上漏掉的钥匙串、今天页签、近 7 天；单价夹具原先给所有图片模型同一个价，断言照抄；撤回固定高 | 实现没照图 + 断言量的不是图上那个东西 |
| L8：大数字 | 板上 18px 不在 §2.3 字号表（`nomi-design-system.md:665-678`）里；协调裁定取 title 16（D-1126-1665-type-scale） | 画稿本身不合规 |
| L8：展开态间距 0 | 板上没画展开态，`BOARD_STATES` 里也没有这一态 | 没有逐态的表 |
| 本线量出、没人报过：同屏 9 处小一档 | 新页沿用了 main 上改造前的字号：AI 卡从 09-11 `82f040541` 起就是 caption 12 / micro 11。板比旧页大一档，而且和其他设置分区一致：`ProjectLocationSection` 等分区的行标题是 body-sm 13，说明是 caption 12。没有逐元素对照表，所以没人把这处差别列出来 | 实现没照图（根子在没有逐元素的表） |

### 2. 为什么一直出现

缺的量具有 6 处，每处都写了出处：

1. **出稿**：`check:tokens` 只扫 `src/`（`scripts/check-design-tokens.mjs:60`），板源不过字号表。现有板源里表外字号共 173 处（按出现次数数，含复制出来的画板），17 个板目录有 16 个带。
2. **派工**：`design-pipeline.md:31` 要求派工前出逐态对照表。ModelSurfaces 没有这张表，设计卡 ★9 全是功能检查。11-16 以后唯一的一张表 `NomiEntryTopbar.mapping.md` 也只量位置和宽度，不量字号。状态词表 `scripts/check-board-parity.mjs:49` 里没有「展开」。
3. **断言**：走查 25 个 `board:` 断言里，没有一个量字号或间距，例如 `tests/ux/t6a-model-settings.walk.mjs:192` 只判可见，`:254` 只判含 52.3。`check:board-parity` 只查断言名在不在（`design-pipeline.md:99` 自己写明了）。仓库里 `toHaveCSS` 已经用了 20 处，这一屏一处没用。
4. **并排图反向**：`shot()`（walk :52-74）把两边都缩到 800 高。板图 1440×900 被缩到 0.889 倍，实窗 1280×800 不缩，结果板上 12px 在图里约 10.7，实现的 11px 仍是 11，小一档反而显得一样大。窄窗时板图被放大到 1.14 倍。人眼只能看出 18 对 13 这种大差距。
5. **实验室跳过**：settings 屏从 10-17 起登记在 `pendingApprovalScreens`（`tests/ux/design-lab/calibration.json:7`），理由是隐私文案，和这一页无关；`design-lab.visual.spec.mjs:26` 因此整屏跳过。`assisted-01` 基线还是旧的 `<section>` 样子，CI 照样绿。全局看，884 格跳过了 720 格。
6. **自己翻状态**：`design-pipeline.md:41` 要求由另一条线核过才能标 implemented。`97f03c5d7` 是实现线自己翻的，翻完账户卡的 owner 字段还写着「（未开工）」（board.json:242）。

**为什么验收能发现、实现线发现不了**：实现线的尺子都是自己写的，只量文字；门岗全绿；并排图对小一档是反的。V-1665 和上一轮 t6a-verify 只差一件事：V-1665 读了板源的数字和代码里的类名。t6a-verify 逐张看完七张并排图就判了通过，还认可了固定 560。

**三条铁律都不适用**：⑩ 没有意图和参数的对比；⑪ 不涉及模型档案清单；⑫ 问题不出在点击结果，而是静态视觉数值。这一类是「拍板图数值对计算样式」的对账。逃逸账本里也没有 1665、t6a 或设置页的条目；要不要补一条 candidate，由协调定。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 验证 |
|---|---|
| ① 同屏还有 9 处表内字号比板小一档：页头副标题、卡名、Key 行、三格标签、「接别家的模型」、AI 行标题和副标题、「其他接入方式」标题和副标题。页头标题板上是 15（表外），实现 14。L8 合并后，下一条读板源数字的验收线会再报一次 | 下面命令 ①。板输出 `.cap 12 / .bs 13 / .b 14 / .sec-h 13`（本线已跑），实现输出 `body micro caption caption micro / body-sm micro micro body-sm / caption micro`。起窗口版：在走查里逐处加 `toHaveCSS('font-size', …)`，**待起窗口验** |
| ② 下一张新板照样会带表外字号，门岗照样全绿 | 命令 ② 对新板输出非 0（今天全部板源是 173），同时 `pnpm run check:board-parity`、`pnpm run check:tokens` 都绿 |
| ③ settings 屏解除跳过后会红，至少 assisted-01 那一组 | 在 darwin 专用工作树里删掉 `calibration.json` 的 `settings` 登记，跑 `pnpm run check:design-lab -- --screen settings`。这个脚本确实会起 Playwright 跑 `*.visual.spec.mjs`（`scripts/check-design-lab.mjs:347`），**待跑** |

```sh
B=origin/feat/t6a-settings-models-and-policy
# ① 板 vs 实现
git show "${B}:docs/design/boards/2026-11-07-model-surfaces/source/ModelSurfaces.dc.html" | grep -oE '\.(b|bs|cap|sec-h)\{[^}]*font-size:[0-9]+px' | sed -E 's/\{.*font-size:/ /'
git show "${B}:src/ui/onboarding/ModelSettingsHome.tsx" | sed -n '106p;107p;149p;153p;154p' | grep -oE 'text-(micro|caption|body-sm|body|title)\b'
git show "${B}:src/ui/onboarding/ModelAccountCard.tsx" | sed -n '46p;49p;59p' | grep -oE 'text-(micro|caption|body-sm|body|title)\b'
git show "${B}:src/ui/onboarding/AiAssistedOnboardingCard.tsx" | sed -n '110p;113p' | grep -oE 'text-(micro|caption|body-sm|body|title)\b'
# ② 表外字号（把路径换成新板目录）
grep -rhoE 'font-size: ?[0-9.]+px' docs/design/boards/*/source/*.dc.html | grep -vE 'font-size: ?(11|12|13|14|16|20|24|28)px' | wc -l
```

### 4. 靶子独立性检查

- **尺子出自实现线**：走查断言和并排图都是实现线写的。旧复盘 `docs/plan/2026-11-24-t6a-model-settings-direction-check.md` 被 6 个提交引用，每轮往下追加内容，从没覆盖过字号和间距；它的推荐是「逐状态复验」，还是靠人。
- **修对了要先改靶子**：`953eb7973` 把偏离板的实现录成了基线；`12f6d8483` 改回板的样子后，又得重录。
- **靶子本身有错**：板上的 18 和 15 不在字号表里。协调的「取 16」只写在 PR 正文和走查注释里，板源和清单的 `decisions` 里都没有。并排图的缩放也反了。这两处要先修。

### 5. 这一整块归谁（P0）

这一整块：拍板图到生产组件的视觉对账——板上的字号、间距、状态这些数怎么变成能失败的合同，并在出稿、派工、交回三处被机器量；不是这一屏某个字号。
归谁：我们唯一的主人是拍板清单这一套（流程 docs/engineering/design-pipeline.md:31-41、状态词表 scripts/check-board-parity.mjs:49、候选抽取 scripts/board-extract.mjs:127），字号令牌唯一出处 src/theme/nomiTheme.ts:86；量计算样式用已在用的 Playwright 1.60.0 `toHaveCSS`（https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-have-css），整屏回归用已在用的设计实验室 tests/ux/design-lab/design-lab.visual.spec.mjs:26。
我们哪里绕开了它：派工没出逐元素逐态对照表（design-pipeline.md:31）；实现线在 97f03c5d7 自己翻 implemented（ModelSurfaces.board.json:242、:462，绕开 design-pipeline.md:41）；board-extract 已调 getComputedStyle（scripts/board-extract.mjs:76）却只记 bbox（:127）；走查 tests/ux/t6a-model-settings.walk.mjs:192、:254 只判可见和含字；实验室 settings 屏整屏跳过（tests/ux/design-lab/calibration.json:7）；token 门岗只扫 src/（scripts/check-design-tokens.mjs:60）。

**自写登记**：`fix-churn` 按路径还命中 `apimart-onboarding-balance`（30 天内第 4 个 fix）和 `model-settings-usage-receipts`（第 3 个）。两条都是 justified，登记的能力是取账户资金、按 runId 汇总积分，理由是领域约束。这几刀改的是显示层，不碰那段能力，所以为什么换不了、哪天重看，都照登记原文的 `revisitWhen`。

另外，`ModelAccountCard.tsx` 这个文件本身就是热点，不属于「只因口径命中」的代批例外，要交用户拍板。

自写登记 gate-family：本 PR 对 scripts/check-i18n-no-cost-claims.mjs 只做一处键名改名（usage→usageTitle，键名收成一个家），不新增逻辑或特例；换不了现成方案的理由与重看时间按登记原文 revisitWhen。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 同类还会不会出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | L8 两处改动 + 已知差异登记，合并 | 最小，今天能合 | 会：同屏 9 处和页头 15 都留着，下一条读数字的验收线会再报；下一张板也一样 | 第 5 刀又要写复盘，还是靠人 | 否 |
| 换一种做法（把已在用的量具接到现有主人上） | **A，在本 PR 内**：用 `toHaveCSS` 把这一屏带文字的元素全量一遍。表内的照板改；表外的 18、15 按 D-1126 映射，写进清单 `decisions` 和板源注释；在同一个带 Direction-Check 的提交里完成。<br>**B，独立任务，下一块拍板界面实现前落地，由非实现线做**：① board-extract 多记计算字号、行高、字重，`check:board-parity` 对表外字号报红，除非清单里登记了映射；② 有文字的 implemented 元素，走查里必须有 `toHaveCSS` 字号断言；③ `BOARD_STATES` 加「展开」；④ implemented 只能由非实现线翻；⑤ 并排图改成同一 CSS 比例；⑥ settings 屏截图交用户拍板后录基线、解除跳过 | **A**：多约半天。用户会看到这一页说明文字、行标题整体大一档，和其他设置分区对齐，属于可见改动，要出并排图。<br>**B**：一条线 1–2 天；老板子要补映射或登记豁免 | A 做完，这一屏收口。B 做完，出稿、派工、交回三处都会红。间距仍没有量具（未验证：缺量具） | B 起步只对新板、新翻的 implemented 生效，免得老板子一批变红 | **是** |
| 删掉 | 最小单位是「板上的 px 算合同」：改成只认 token 名 | 小 | 字号不再算差异，但用户批准的层级（如大数字醒目）没人守，实现可以再选回 13 | 拍板图失去约束力 | 否 |

### 7. 用户要权衡的核心

拍板图上的数字算不算合同：算，就由机器量，这一屏多半天、以后每张新板多一步映射；不算，就只守 token 名，放弃板上画的层级。

## 特征测试清单

- **已钉住**（暂存未提交，在 L8 工作树的 `tests/ux/t6a-model-settings.walk.mjs`）：
  - 大数字的计算字号 = `.text-title` 探针；
  - 展开态状态行到「复制指引」的间距 > 0，且等于分段到状态行的间距。
  - 红绿：各红一次，绿 7 个场景。日志没存成文件。
- **没钉住**：
  - 同屏另外 9 处字号：没有断言。
  - 框高随内容：现在只判区间，应改成「两种内容高度量出两个不同的高」。
  - 展开态的正确样子：板上没画。
  - settings 屏的实验室格子：整屏跳过。

## 和原方案对照（原方案：L8 两处小改 + 已知差异登记）

**够的**：
- 两处都改到了，有红绿。
- 字号比的是 token 探针，没写死 px，符合 D-1126。
- 间距修在 `<details>` 内容槽这一层，是对的那一层。

**不够的**：
1. 同屏另外 9 处没量，页头 15 也没量，D-1126 只覆盖了 18。
2. D-1126 没写进板源和清单 `decisions`，下一条读板的验收线会把 16 对 18 再报一次。
3. 展开态的断言比的是组件自己的节奏，不是板。展开态「对」应该长什么样，至今没人定。
4. 交接单说 `run/live.zh-CN.light.png` 是展开态，实际是收起态、未连接：driver 展开读完数后收起，最后一张截图覆盖了前面的。L8 任务书要的中文浅色、英文暗色两张并排图也没交。展开态没有一张真截图。
5. 「已知差异登记」只让差异被看见，不会变红，拦不住下一张板。
6. 第 4 刀碰的是热点文件本身，要用户拍板。

**放进分支时**：文件放到 `docs/plan/2026-11-26-direction-check-model-settings-surface.md`，最后一刀的提交带 `Direction-Check: docs/plan/2026-11-26-direction-check-model-settings-surface.md`。门岗正反实测见 `gate-probe.out.json`：本文 `ok:true`；没有 trailer 时拦下；假稿只写「以后注意」、归谁写「不适用」时拦下。门岗只核 §5 三行的形式，不判内容好坏。
