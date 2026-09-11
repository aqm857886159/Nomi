# 按钮文字 vs 图标：写进设计系统 + 做成门岗

> 状态：✅ 已交付（2026-09-10）
> 规则本体：`docs/design/nomi-design-system.md` §1.8 · 动作词 owner：`docs/GLOSSARY.md`「动作词」表
> 门岗：`pnpm run check:controls`（规则四~六）· `pnpm run check:icon-semantics`（词典登记）

## 为什么做这件事

2026-09-10 用户看着分镜面说：一屏上并排四颗**文字**按钮——「不要」「全部生成」「换模型」「返回修改」——
没有一颗是主动作，每颗都得读一遍才知道点哪个。

**根因不是这四颗各自写错了**，而是「什么时候该用文字、文字该怎么写」这条规则从来没写下来：
§1.5 管控件住哪一层，§1.6 管控件说到做到，§6 管图标长什么样，**没有一节管「该说话还是该画图标」**。
规则缺席的结果是每个面自己发明一套措辞——同一个「取消」在三个面上分别叫「不要」「算了」「取消」，
用户每换一个面就要重新读一遍。

## 先查别人

| 问 | 答 | 出处 |
|---|---|---|
| 生态里已有？（Apple）| "Keep the number of prominent buttons to one or two per view."；"Consider using text when a short label communicates more clearly than an icon."；"…consider starting the label with a verb…" | https://developer.apple.com/design/human-interface-guidelines/buttons |
| 生态里已有？（Apple 图标）| "Strive for a simple, universal design that most people will recognize quickly." —— 只讲「把 icon 设计得通用」，不讲「不通用时退回文字」，别引超 | https://developer.apple.com/design/human-interface-guidelines/icons |
| 生态里已有？（Material 3）| "the filled style should be used sparingly, ideally for only one action on a page."；"Label text … should be very brief, ideally 1–3 words." | https://m3.material.io/components/buttons/guidelines |
| 生态里已有？（Material 3 icon button）| "These buttons should be used for common, easily understandable actions."；"On hover, the icon button displays a tooltip describing its action, rather than the name of the icon itself." | https://m3.material.io/components/icon-buttons/guidelines |
| 生态里已有？（NN/g 图标）| "Due to the absence of a standard usage for most icons, text labels are necessary to communicate the meaning and reduce ambiguity."；小标题 `"Universal" Icons Are Rare` | https://www.nngroup.com/articles/icon-usability/ |
| 生态里已有？（NN/g 文案）| "Lead with verbs or verb phrases…"；"…include no more than 2–4 words."；"Avoid using the generic phrase OK for button labels in confirmation dialogs." | https://www.nngroup.com/articles/ui-copy/ |
| 仓库里已有？ | 图标形制与「一个动作一个图标」已有门岗（`scripts/check-icon-semantics.mjs:1`）；控件交互契约已有门岗（`scripts/check-control-contract.mjs:1`）；**文案侧一条都没有** | 同左 |
| 依赖里已有？ | 没有现成的按钮文案 linter。i18n 侧只有 `check:i18n` 拦硬编码中文（`scripts/check-i18n-visible-text.mjs:1`），不看文案长短与措辞 | 同左 |
| 结论 | **规则用别人的**（三家一手规范一致），**判据自研**——文案规则要吃我们自己的 i18n 词典与 GLOSSARY，没有通用实现可买 | 摘录全文：[prior-art.md](../research/2026-09-10-button-icon-rule/prior-art.md) |

一处真实分歧已写进摘录：NN/g 要求标签常驻可见，M3 接受 icon-only + hover tooltip；
我们选 M3 那侧，理由是**桌面密度优先的生产面**（领域约束），不是偏好。

## 范围

**做**：
1. 设计系统新增 §1.8「按钮三档：文字还是图标」——六条规则 + 正反例 + 门岗覆盖边界表。
2. `docs/GLOSSARY.md` 新增「动作词」表（撤销 / 删除 / 关闭 / 取消 / 生成 / 确认六组），**它是门岗的 owner**。
3. 扩 `check:controls`：规则四（标签长度）、规则五（禁用词）、规则六（同一动作第二种说法）。
4. 扩 `check:icon-semantics`：图标词典登记（新图标必须先登记进 §6）。

**不做**（写清楚，免得被当成漏）：
- 不改任何现有文案。存量 289 条进棘轮，改文案是后续的产品动作，不混进这次。
- 不做「一屏只有一个主动作」的机器判定——那是构图判断，AST 测不出来，留给样张阶段（§1.5.5）。
- 不做「这个图标隐喻对不对」——§6 盲测，人工。
- 不另起平行脚本：两条规则都长在**现有门岗**里，判据本体抽成 `scripts/control-contract-copy.mjs`
  （沿用 `control-contract-discarded-commands.mjs` 已有的分文件写法）。
- 不重做 `check:i18n` 已经拦的硬编码中文，也不重做 `check:icon-semantics` 已有的「一个动作两个图标」。

## 判据与覆盖边界

| # | 判据 | 覆盖 | 刻意不覆盖 |
|---|---|---|---|
| 四 | 控件**可见文字** >4 汉字（英文 >2 词）| 控件子树里作为 JSX 子节点渲染的 `t('key')`，以及非 icon 按钮的 `label=` / `children=` | `aria-label` / `title` / `WorkbenchIconButton` 的 `label`——那是 hover 名字，规则 1 本来就允许它长（`src/design/actions.tsx:150` 把它落到 aria-label） |
| 五 | 标签含「请 / 我的 / 使用 / 一下 / 不要 / 不用 / 算了」| 可见文字 + hover 名字 | — |
| 六 | 整条文案等于 GLOSSARY 某个规范词的替代说法 | 已登记的六组 | 包含式匹配（「确认删除这个项目」是一句话不是第二种说法）；未登记的动作 |
| — | 说明文字不是标签 | — | 键名以 `Hint`/`Description`/`Summary`/`Placeholder`/`Title`/`Name`… 结尾的，以及带句读（，。；：、！？）的整句 |
| 词典 | 全仓在用的 Tabler 图标 | 新图标不在基线且没登记进 §6 → 红 | 反方向（一个图标用在几个动作上）——`IconX` 天然要关掉弹窗/面板/预览，硬做只会产出几百条永远修不掉的基线 |

## 验收（R17：加规则必须先验它会红）

| 规则 | 修前红了几处 | 留得住的红证明 |
|---|---|---|
| 四 标签过长（中文）| 130 | `scripts/check-control-contract.test.mjs`「抓得到超过 4 个字的中文标签」 |
| 四 标签过长（英文）| 149 | 同上文件「抓得到 2026-09-10 那一屏…」 |
| 五 禁用词 | 8 | 同上（「不要」）|
| 六 第二种说法 | 2（两处「知道了」）| 同上（「知道了」→「确认」）|
| 词典登记 | 209（立项时全仓在用、未登记的图标）| `scripts/check-icon-semantics.node-test.mjs`「会红：新图标不在词典基线、也没登记进 §6」 |

存量棘轮：`scripts/control-copy-baseline.json`（289 条）、`scripts/icon-semantics-baseline.json` 的
`dictionary`（216 个图标）。**只减不增**，新增即红。

## 回滚

三处独立可回滚，互不牵连：
① `git revert` 脚本那一 commit → 两道门岗回到扩之前（基线文件一起走）；
② 文档 commit 单独 revert → 规则回到没写下来的状态（不影响门岗，但门岗报错文案会指向不存在的章节，别只回这一半）；
③ 只想临时放行：`node scripts/check-control-contract.mjs --update-copy-baseline` 重拍基线——
   **这是逃生口不是修法**，用了要在 PR 里说清为什么。
