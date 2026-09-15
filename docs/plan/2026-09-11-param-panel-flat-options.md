# 参数面板去下拉：选项摊开 · 单参数直出（v1.2）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现，待评审。分支 `fix/param-panel-flat-options-20260911`。

## 用户那一刻卡在哪

2026-09-11 13:00 用户真机反馈：改一个参数要「点好几次」。数出来是四步——

```
底栏 pill → 参数面板 → 面板里的下拉 → 弹出的列表 → 选中那一项
```

中间两步是**同一件事被做了两遍**：面板本身已经是用户点开的那一次结果，里面再套一颗
「还要再点开一次」的下拉，等于把一个折叠层塞进另一个折叠层。图片节点最惨：它常常只声明
一个「尺寸」参数，为这一个值走满四步，而那层面板壳里除了它什么都没有。

**这一版换的不是外观，是步数。**改一个值从四步变两步（pill → 点那一项）。

## 用户拍板的三条（2026-09-11 13:00，不再重议）

1. **面板里不再套下拉**：枚举参数的选项直接摊成可点项，当前值高亮；≤8 项一律摊平，
   >8 才给搜索框——而且列表**默认就展开**，搜索是用来缩短它的，不是用来藏起它的。
   数值 / 滑杆 / 开关保持原样。
2. **付费卡 ⚙ 的长尾面板一起变**（同一块渲染，不是另写一份）；chips 自己那颗下拉不动。
3. **单参数 pill 直接出列表**：面板的价值是「一次打开连改多项」，只有一个参数时它没有那个
   价值，只剩一层壳 → 直出那组选项，点一项即写入并关闭。多参数照旧出面板，每参数一行摊开。

## 先查别人

- **依赖里已有？** Mantine 8.3.18 自带两件同类品：`SegmentedControl`（<https://mantine.dev/core/segmented-control/>）
  与 `Chip.Group`（<https://mantine.dev/core/chip/>）。两者都是**单行等宽、不换行、每项没有图形槽**。
  比例那一组每项要带一枚比例小图形（一眼选对画幅靠的就是它），且面板宽 320px 必须能换行，
  所以这次不引入它们；仓库里那层薄封装 `DesignSegmentedControl`（`src/design/forms.tsx:40`）
  也因此没有成为本次的载体——它就是 Mantine 那个单行控件本身。
- **仓库里已有？** `NomiSegmented`（`src/design/NomiSegmented.tsx:48`）已经是「auto-fit 网格 +
  图形槽 + `role=radiogroup`」的摊开控件，面板里短候选那一支**本来就在用它**。本次只给它加了
  第三种 `fit='column'`（一项一行、左对齐、长文件名可断行），没有新造组件——长标签挤进等宽格子
  只会各自 truncate 成一排读不出的省略号，那时「摊开」等于没摊开。
  搜索框同理复用 `DesignSearchInput`（`src/design/searchInput.tsx:31`）。
- **「8 项」这把尺子哪来的？** 不是拍脑袋：`NomiSelect` 的列表区就是 `max-h-[240px]`
  （`src/design/NomiSelect.tsx:227`）配每行 `minHeight: 30`（`src/design/NomiSelect.tsx:168`），
  240 / 30 = 8 行一屏。沿用同一把尺子，摊开的那一列和原来下拉弹出的那一列一样高，
  不会出现「摊开之后反而要滚」。
- **生态里怎么做？** W3C APG 的 Radio Group 模式（<https://www.w3.org/WAI/ARIA/apg/patterns/radio/>）
  正是「一组互斥选项全部可见、方向键移动、选中即生效」，我们摊开的那组项就按它的角色出（`role=radio`
  + `aria-checked`），走查也据此按属性数而不是按组件名数。NN/g 的《Drop-Down Menus: Use Sparingly》
  （<https://www.nngroup.com/articles/drop-down-menus-use-sparingly/>）给的分界与用户这次的直觉一致：
  选项少且要对比时，下拉是纯粹的多余一次点击。
- **结论：用已有。** 不新增依赖、不新造组件；新增的只有三个纯函数判据
  （`parameterOptionLayout` / `soloOptionControl` / `hasFlatOptions`）和一个把搜索框与
  `NomiSegmented` 拼起来的小容器 `ParameterOptionList`。

## 改了什么（P1：加新必删旧）

| 落点 | 做了什么 | 删了什么 |
|---|---|---|
| `src/workbench/generationCanvas/nodes/parameterOptionPresentation.ts:66` | `parameterOptionLayout` 从「分段 / 下拉」二选一改成**三种都摊开**的 `chips-row` / `chips-column` / `searchable-list`；上限常量 `FLAT_OPTION_LIMIT = 8`（`:59`） | 旧的 `'select'` 分支（面板内下拉那条路）整条删除 |
| `src/workbench/generationCanvas/nodes/parameterOptionPresentation.ts:86` | 新增 `soloOptionControl`：判「pill 能不能直出」，四个条件（无第二参数 / 无供应商 / 无生成方式 / 非 chips 形态）缺一不可 | — |
| `src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:300` | 新增 `hasFlatOptions`：判据就是「它有没有候选项」，滑杆 / 数字框 / 开关脱了小标题读不出在调什么，不走直出 | — |
| `src/workbench/generationCanvas/nodes/controls/ParameterControlBody.tsx:114` | 新增 `ParameterOptionList`：搜索框 + **默认展开**的一列可点项；搜索不自动抢焦点（用户多半点一下就走，抢焦点会把键盘从画布上偷走）；当前值恒在列表里（被搜索过滤掉就没地方读得出当前选的是哪个） | 面板里那颗 `NomiSelect`（连同 `portalTarget={panelRef}` 这条只属于「面板内下拉」的签名） |
| `src/workbench/generationCanvas/nodes/controls/ParameterControlBody.tsx:237` | 抽出 `ParameterControlBody`：**面板与单参数直出共用这一处**，差别只有外面套不套那行小标题 | 给单参数另写一套渲染的可能（那就是并行版） |
| `src/workbench/generationCanvas/nodes/controls/ParameterControlBody.tsx` | **整个控件渲染层搬出编排壳**（R9）：`ParameterOptionGroup` / `ParameterControlBody` / `ParameterPanelGroup` 连同 `ParameterOptionList`、`ParameterTextInput` 住进 `controls/`，`InlineParameterBar.tsx` 885 → 612 行，只留编排（谁打开这块面、面里还摆不摆供应商/生成方式、pill 上印什么） | 壳里那 5 个渲染函数（**搬走不是复制**：单测数「只有一处定义」并断壳里一份副本都不留） |
| `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:341` | 单参数直出：浮层里只有那组选项，`aria-label` 说实话（用参数名，不叫「参数面板」），选完即关 | — |
| `src/design/NomiSegmented.tsx:48` | `fit` 加第三档 `'column'`：一项一行、左对齐、`overflowWrap: anywhere` | — |

付费卡 ⚙ 走的是同一个 `renderParameterPanel`，所以第 2 条是**结构上自动成立**的，不是另改一处；
走查对那一格单独断言一次，防它以后被岔开。

i18n（R15）：搜索框那两句**复用现成词条**、一条新词条都没加——`common.searchOptions` /
`common.noMatchingOptions` 本来就是 `NomiSelect` 搜索框在用的（`src/design/NomiSelect.tsx:222`、
`src/design/NomiSelect.tsx:228`），zh-CN + en 齐（`src/i18n/resources.ts:41`、`src/i18n/resources.ts:452`）。
同一句话在两处说法不同才是 i18n 的债。

## 不动的

底栏 chips 形态里每个主参数那颗下拉（用户明确说不动）、模型 / 变体两颗身份下拉、滑杆与开关、
摘要 pill 的口径（`composerHeadlineSummary.ts`）、面板的定位与浮层几何。

## 验收门

- 单测：`parameterOptionPresentation.test.ts`（三种摆法的分界、solo 的四个条件）、
  `InlineParameterBar.test.ts`（源码级守「面板里没有 `portalTarget={panelRef}`」「`ParameterControlBody`
  只有一个定义、壳里一份副本都不留」——守的是这条路真的被删了，不是又长回来一份并行版；
  拆巨壳之后每条不变量都断在**它真正归属的那层**，断错层就是假绿）。
- 巨壳门岗：`pnpm run check:filesize`（`InlineParameterBar.tsx` 612 < 800，不进白名单）。
- 设计实验室：`node-composer-bar` 新增两格 `composer-bar-panel-flat-options`（多参数 → 面板）与
  `composer-bar-panel-solo-direct`（Agnes Image 只声明「尺寸」→ pill 直出）。两格的展开态由取景台
  **真的点一下那颗 pill** 得到，不是另画一份展开的样子；点不到就当场抛错（静默截一张收起态是假证据）。
- 走查：`tests/ux/design-lab-node-composer-bar.walk.mjs` 断「浮层里下拉数 = 0 且可点项数 ≥ 2 且恰好
  一项选中」，solo 那格再真点一项断「列表随即关闭」；
  `tests/ux/design-lab-agent-panel-v4.walk.mjs` 对付费卡 ⚙ 那一格断同一句；
  `tests/ux/node-composer-placement.walk.mjs` 在**真机**上对视频节点与图片节点各断一次。
  每条「没有下拉」都配一句基线（「数得到可点项」）——面板整个空着时「没有下拉」照样成立，
  那种绿和真绿在观测上一模一样。
- 真机上没有单参数图片模型：这台机器内置可用的图片档案声明了比例 + 清晰度，所以真机只量得到
  「多参数 → 面板、不走直出」那半边；直出那半边由实验室那一格守（Agnes Image 是真实档案）。
  两边合起来覆盖整条规则——不在真机断言里假装走到了一个不存在的模型。

## 回滚

单 PR、改动集中在三个文件的纯函数判据 + 一个渲染分支，`git revert` 即可；没有数据迁移、
没有持久化格式变化、没有新依赖。
