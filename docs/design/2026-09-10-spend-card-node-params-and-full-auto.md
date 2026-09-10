# 付费确认卡换成节点参数条 · 「全自动」档（2026-09-10）

> 状态：📋 **方案待拍板**（只出样张，一行接线都没做）
> **基线 = `v4-intervention-spend` 那张付费卡 + 图片/视频节点底下那条参数条。本文只记增量。**
> 拍板依据：2026-09-10 用户原话 ——「得类似于图片节点、视频节点，它得点之后，下拉之后，它得选」
> 「只能选改模型就不对，而且改模型就应该是下拉框选」。
> 实验室：`design-lab.html?screen=agent-panel-v4`（新加 11 格，id 前缀 `v4-spend-params-` / `v4-auto-mode-`）

---

## 1. 任务卡

**这解决的真实摩擦**：Nomi 说「要花 ¥1.20 生成 4 段视频」，用户想改的从来不只是模型——
时长、画质、比例、几段，任何一项都可能是他真正想动的那个。今天这张卡上这些值是**四枚不能点的灰 chip**，
唯一的出口是一颗「换模型」按钮。想改时长？只能拒掉这张卡、回去打字重说一遍，
然后再看一次报价。**一次决定被拆成三个来回，其中两个来回是我们自己造出来的。**

而「点了能选」这件事，Nomi 里早就有一份做好了的：图片/视频节点底下那条参数条
（2026-07-17 用户拍板的「模型芯片 + 摘要 pill + 参数面板」）。它已经能从模型档案里长出
画质/时长/比例/声效，已经有下拉、有分段选择器、有比例的描边小矩形。

**所以增量只有一句话：把那排不能点的 chip，换成那条参数条本人。**
不是照着它再画一份长得像的（那是并行版，P1），也不是把它抄进 v4 词表（那是同一个控件两份定义）。
样张里 `import` 的就是 `InlineParameterBar` 那一个组件、`resolveRenderedControls()` 那一个函数、
Kling 3.0 那一份真档案。

**用户要权衡的那个核心东西**：卡上给多少自由。给到「全部参数可改」，这一刻的决定就完整了，
但卡会长高一点（收起态 279px，展开参数面板 546px）。给少了，就还是今天这个三来回。
本方案选前者，并用「参数收起成一枚摘要 pill」把高度按住——那正是节点那条条当初的解法。

---

## 2. 增量 1 · 付费卡（参数条版）

骨架完全沿用 `V4Intervention` 的 spend kind（槽头 accent 条 + 摘要 + 底栏两颗钮）。改动四处：

| # | 改了什么 | 为什么 |
|---|---|---|
| ① | 参数 chip 行 → **`InlineParameterBar` 本人**（`layout="stacked"` + `panelMode="inline"`） | 用户拍板：和节点那条一模一样，点了要能选。`stacked`/`inline` 两个档位本就是为窄面板留的，不是为这次新加的 |
| ② | 模型芯片带极小徽标**「Nomi 选的」**（`NomiSelect` 的 `triggerBadge`） | 用户有权知道「这一项不是我挑的」。标记必须长在**那颗芯片上**：另起一行小字的话，用户一改模型那行字还在，就变成一句假话 |
| ③ | 新增**价格行**：`4 段 × 3s · 标准画质 · ¥0.10/秒　合计 ¥1.20` | 形态 9 / B-02 要的「逐项单价 + 加粗合计」。改参数时它**原地刷新**，卡不重开、不跳转 |
| ④ | 底栏只剩**「生成 ¥1.20」/「不要」**，「换模型」删除 | 模型芯片本身就是下拉，一件事不留两个入口（§1.5.2 一功能一个家） |

标题里**不再印金额**（旧卡是「要花 ¥1.20 生成 4 段视频」）：金额随参数变，两个地方印同一个数一定有一个先漂。
标题只说要做什么，钱归价格行（合计）与确认钮（按下去时的那句承诺）。

### 七张图

| 图 | 说的是什么 |
|---|---|
| `v4-spend-params-collapsed.png` | 默认收起态（浅）。模型芯片 + 「Nomi 选的」+ 摘要 pill + 价格行 + 生成 ¥1.20 |
| `v4-spend-params-collapsed-dark.png` | 同上（暗）。token 翻转，没有第二套样式 |
| `v4-spend-params-model-open.png` | **模型下拉展开**。和节点上同一个下拉：同一份目录、行尾同一套供应商标注（Kie / APIMart）、选中同一枚对勾 |
| `v4-spend-params-panel-open.png` | **参数面板就地展开**。画质 std/pro/4K · 时长 3/5/10 · 比例（带描边小矩形）· 声效开关——**全部可改，不只是模型**。这一格是用户那句拍板的正面证据 |
| `v4-spend-params-repriced.png` | 时长 3s→5s 后**同一张卡**上价格行与按钮一起变成 ¥2.00。不跳转、不出第二张卡 |
| `v4-spend-params-batch.png` | 多镜批量：参数条是**整批默认值**，价格行下面一个「逐镜 · 4 镜」折叠口，展开是逐镜金额 |
| `v4-spend-params-price-unknown.png` | 价格算不出（沿现役）：右端印「暂时算不出价格」而**不是 ¥0**，算式里连单价都不印，钮退成「仍要生成」，范围行换成一句诚实交代 |

> ⚠️ **「改了比例后价格刷新」这条画不出来，因为它不该发生**：Kling 的报价按 `每秒单价 × 时长 × 段数` 算，
> 比例不进价钱。所以刷新态画的是**改时长**。做一张「改比例也变价」的图是编证据。

### 实验室这几格是真能点的

夹具镜像的真实调用点是 `NodeParameterControls.tsx:686`。控件不是手写的：
`resolveRenderedControls(option, meta, false, true)` 从 `electron/shared/videoCapabilities/kling.ts`
的真档案算出来，`onParameterControlChange` 真回写 meta。所以在实验室里换个时长，
下面那行价格当场跟着变——截图钉住形态，能点的那部分请拍板人自己试。
价格那半行是实验室的**报价桩**（`quotePrice`，口径 `单价/秒 × 时长 × 段数`），接线时换成真报价。

---

## 3. 增量 2 · 「全自动」档

沿定稿三个词「每步问 / 自动改 / 全自动」，不新造档、不新造词。只补两件：

**(a) 切档二次确认**（`v4-auto-mode-confirm.png` / `-dark.png`）
一句话：「之后可撤销的改动 Nomi 直接做，不再逐步问你。**付费和不可逆的操作仍然每次问。**」
**它不是新组件**——就是介入槽的可撤销档（换档本身可撤销），所以没有「不再问 →」、没有 badge、没有范围行。

**(b) 开启后的常驻提醒**（`v4-auto-mode-reminder.png` / `-dark.png`）
一条 h-6 的微字横条压在 composer 上沿：`● 全自动　付费和不可逆仍会问　[回到自动改]`。
新组件 `V4AutoModeBanner`（56 行）。

为什么需要它：三档里只有「全自动」会让 Nomi 在**没人看着**的时候连着做改动。
另外两档每一步都会在介入槽里现身，用户不可能忘了自己开着什么；全自动恰恰相反——
它的特征就是「什么都不问」，于是「我现在开着什么」在界面上没有任何痕迹。
composer 底栏那颗档位钮不算：三档长得一模一样，读它等于每次都要低头确认一遍。

它**不是第二个开关**：开全自动的家仍是底栏那颗钮，这条只提供「我不想要了」这一条最短出路。
只在 `project` 档渲染，别的档一行都没有。不画闪电/机器人 icon（定稿 ⑧ 禁用那一族），
一颗 6px 的点 + warning-soft 底就够被眼睛抓到。

---

## 4. 删除清单（想过、故意不放）

| 不放 | 为什么 | 要它时怎么找 |
|---|---|---|
| **倒计时** | 定稿 v3 整改⑨已裁：倒计时只属外部 MCP 档，agent 受理档没有。给用户直发的操作加倒计时 = 逼他在读完之前做决定 | 外部 MCP 宿主那条路另有形态，不在本卡 |
| **「本会话不再问」** | 花钱**永远逐次问**（定稿 ③ + 2026-09-09「钱的闸 = 每次提交看报价确认」）。这颗开关的存在本身就在暗示「可以关掉」 | 想少被打断，改的是权限档（自动改 / 全自动），不是关掉钱的闸 |
| **Prompt 全文** | 提示词不是这一刻的决定对象。这一刻要判断的是「这些参数、这个价钱，做不做」；把 300 字提示词摊在 390px 的卡上，会把价格行挤出视野 | 提示词的家在它自己那儿：节点里改节点、分镜行双击进 v6 全页（§1.5.2） |
| **请求 JSON / 技术参数** | 同上，且它对「做不做」这个决定没有行动价值（R2） | 收据行展开（`v4-tool-expanded`）看输入输出 |
| **「换模型」按钮** | 模型芯片本身就是下拉。留着它 = 同一件事两个入口，而且它还暗示「只有模型能改」——那正是用户这次要推翻的东西 | 点模型芯片 |
| **逐镜改参数**（批量卡里每镜一条参数条） | 4 条参数条塞进 390px 是把最重的活放在最窄的地方；而且逐镜参数已经有家了 | 分镜表 v6 逐行改（那张表的右半列就是干这个的） |
| **确认后的「再改一次」** | 用户拍板：**确认前都可改，确认后不能再改**。留个改口 = 让人以为按下去还能反悔 | 拒了重来，或去任务卡停止 |

---

## 5. 卡点表（用户视角走一遍）

| # | 问题 | 他看到什么 | 几步 | 能不能砍一步 |
|---|---|---|---|---|
| ① | **怎么知道有卡** | 面板收起时：顶栏 Nomi 角标出数字徽标 + tooltip「等你确认 1 条」（`v4-collapsed-needs-confirm`，已在基线）。面板开着时：卡就在 composer 正上方那一格，accent 描边 | **0 步**（不需要找） | 已经是 0 |
| ② | **动手前知不知道要花多少** | 卡上第三行：`4 段 × 3s · 标准画质 · ¥0.10/秒　合计 ¥1.20`，按钮上再印一次「生成 ¥1.20」 | **0 步** | 已经是 0。同一个数印两遍是有意的：一处是**账**（怎么算的），一处是**承诺**（按下去要付的） |
| ③ | **价格算不出看到什么** | 右端「暂时算不出价格」（warning 色），算式里连单价都不印，按钮退成「仍要生成」，范围行改说「价格没取到。要继续就得接受『花多少事后才知道』」 | **0 步** | 已经是 0。**绝不印 ¥0**——三种可能里只有它会被读成「这次免费」 |
| ④ | **确认后卡变成什么** | 卡原地换成**任务卡**（`v4-task-running`，已在基线）：同样的参数 chip、进度条、`≈ ¥0.12`；跑完变完成态带候选缩略图与实付。介入槽消失，不留一张「已确认」的空壳 | **0 步** | 已经是 0 |
| ⑤ | **改一个参数要几步** | 点摘要 pill → 面板就地展开 → 点那一档。价格当场变，卡不动 | **2 步** | 砍不掉。第 1 步是「把 4 组参数收起来」换来的：全摊开=卡高 546px 常驻，价格行会被挤出首屏。摘要 pill 上已经印着当前值（`std · 3 · 16:9`），不点也读得到 |
| ⑥ | **换模型要几步** | 点模型芯片 → 点一行 | **2 步**（和节点上一样） | 砍不掉，下拉就是两步 |

---

## 6. 与定稿逐条对账

| 定稿条目 | 本方案 | 说明 |
|---|---|---|
| 形态 9 ·「**过闸后不能再改：镜头数、模型、时长、清晰度**」（09-01 §4 形态 9 / v3 整改⑥「付费后就不能再改」） | ⛔ **作废** | 2026-09-10 用户拍板改为「**确认前都可改，确认后不能再改**」。卡上那句话相应改成「确认前这些参数都能改；确认后这一单就定了。」 |
| 形态 9 · 逐项单价 + **加粗合计** | ✅ 落地 | 价格行左算式、右「合计 **¥1.20**」 |
| 形态 9 · 确认钮带金额「确认并生成 ¥1.26」 | ✅ 落地（措辞按用户 09-10 原话改成「**生成 ¥1.20**」） | 「确认并」是废字：钮的位置和主色已经说了它是确认 |
| 形态 9 · **无倒计时、无「本会话不再提示」**（v3 整改⑨ + D4） | ✅ 沿用 | 见删除清单 |
| 09-06 定稿 ② 权限三档「每步问 / 自动改 / 全自动」 | ✅ 沿用，不新造词 | 增量 2 只补「切档确认」与「常驻提醒」两件 |
| 09-06 定稿 ③ 介入槽按钮只有「确认 / 不要」 | ✅ 沿用 | 「换模型」删掉后正好回到两颗 |
| 09-06 定稿 ③ 花钱**永远逐次问** | ✅ 沿用，并被 09-09「钱的闸 = 每次提交看报价确认」再确认一次 | 全自动档也不例外——(a) 那张确认卡上那句话就是这个承诺 |
| 不一致清单 **A4**「付费确认卡正常态不存在」 | ✅ 本方案就是补它 | 现役只有「价格算不出」那一态（恒红框 + 「重新获取价格 / 仍要生成」） |
| 不一致清单 **B5**「合计行没有地方放『合计』这个标签」 | ✅ 顺手修掉 | 价格行现在是 `算式　合计 ¥X`，合计紧跟算式（09-09 用户拍板：行尾附属信息紧跟内容，不许 ml-auto 贴右缘） |
| 不一致清单 **D3**「六张决定卡接不进面板」 | ⚪ 不动 | 那是接线的活，本轮只出样张。本方案的 11 格全部 `coverage: component-only` |

---

## 7. 顺手发现（不在本轮改，记下来）

1. **节点摘要 pill 丢单位**：付费卡上那枚 pill 显示 `std · 3 · 16:9`——「3」是时长 3 秒，但没有单位。
   根因在档案：`kling.ts` 的 duration 选项 `label` 就等于 `value`（`"3"`），pill 照抄。
   在**节点**上同样如此。要修得改档案的 label（或 `summaryPart` 补单位），**两处一起改**；
   本轮照实画，不给付费卡单独套一个 `summaryOverride`——那样它就不是「和节点一模一样」了。
2. **`permissionWhy.project` 与钱闸拍板打架**：现役文案是「预算内都不问，流里只留收据」，
   而 2026-09-09 用户拍板「每次提交看报价确认；删掉设置里的硬预算上限」。
   两句话在同一个界面上不能同时为真。本轮**没改**（改它是改生产文案），
   增量 2 那张确认卡说的是新口径（「付费和不可逆仍然每次问」）。接线那一刀要一起收口。

---

## 8. 拍板后怎么落地（不是本轮的活）

1. 删旧（P1）：`agentPanelV4LabKit.tsx` 里 `slots.spend` / `slots.spendOneClip` 的 `params: [...]` 与
   `alternateLabel: 换模型` 一并删掉，`v4-intervention-spend` 那格改用参数条版。
2. 接数据：`projectV4Intervention()` 里给 spend kind 填 `price`；参数条的 `meta`/`onXxxChange`
   接到待决那笔请求的参数上，确认时把改过的参数一起回给宿主。
3. 录基线：`agent-panel-v4` 整屏仍登记在 `calibration.json` 的 `pendingApprovalScreens` 里
   （见下节），拍板后连同整屏一起录，并删掉那条登记。

---

## 9. 为什么本轮**没有**录视觉基线

`agent-panel-v4` 整屏在 `tests/ux/design-lab/calibration.json` 的 `pendingApprovalScreens` 名单上：
这屏的基线本来就在等用户拍板。给还没被看过的格子录基线，等于替用户点头把「今天碰巧长这样」
钉成「应该长这样」——那比红更糟（同 `docs/lessons/design-lab-update-rewrites-every-baseline.md`）。
所以本轮产出的是**给人看的截图**（下节），不是基线。门岗 `check:design-lab` 结构道全绿、
视觉道整屏按登记跳过。

---

## 10. 截图（绝对路径）

committed 副本（随本分支走）：

- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-collapsed.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-collapsed-dark.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-model-open.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-panel-open.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-repriced.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-batch.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-spend-params-price-unknown.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-auto-mode-confirm.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-auto-mode-confirm-dark.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-auto-mode-reminder.png`
- `/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/docs/design/2026-09-10-spend-card-shots/v4-auto-mode-reminder-dark.png`

走查现产（每次跑 `node tests/ux/design-lab-agent-panel-v4.walk.mjs` 重生成，不入库）：
`/Users/aoqimin/Desktop/Nomi-permission-ui-mockup/tests/ux/shots/design-lab-agent-panel-v4/`
——含整屏 90 格的接触表 `_contact-sheet.png`。

**想自己点一点**：`pnpm run dev:renderer` → `http://127.0.0.1:5173/design-lab.html?screen=agent-panel-v4&state=v4-spend-params-collapsed`
（这几格是真能点的：换模型、开参数面板、改时长，价格当场跟着变）。
