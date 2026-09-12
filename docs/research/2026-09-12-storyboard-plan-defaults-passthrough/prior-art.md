# 先查别人 —— 整片默认怎么到达逐镜请求参数

> 2026-09-12 · 服务于 [docs/plan/2026-09-12-storyboard-plan-defaults-passthrough.md](../../plan/2026-09-12-storyboard-plan-defaults-passthrough.md)
> 结论先说：**「两段作用域」这个模型仓库里早有，生态里也早有；本轮缺的不是模型而是它的第二个读者——
> 给请求体用的 resolver。**所以修法是给现役 owner 补一个导出口（`storyboardAspectScope.ts` → `storyboardShotScope.ts`），
> 不是新造一层「默认值合并器」（那是并行版，P1）。

问题一句话：整片级默认（画幅）在界面上设得上、表里也画对了，**发出去的请求体里没有它**。

---

## ① 依赖里已有？

- **React Flow 的 `defaultEdgeOptions` 是「创建时盖章」不是「读时解析」**：
  `node_modules/@xyflow/react/dist/esm/types/component-props.d.ts:40-49` 的原话是
  "Defaults to be applied to all new edges that are added to the flow. Properties on a new edge will
  override these defaults if they exist."；实现在
  `node_modules/@xyflow/react/dist/esm/index.js:1874-1876`——`onConnect` 那一刻把 `...defaultEdgeOptions`
  **展开进新 edge 对象**，此后这条 edge 与「默认」再无关系。
  同一份默认里还有相反的一半：`node_modules/@xyflow/react/dist/esm/index.js:1538`
  的 `defaultEdgeOptions?.selectable ?? true` 是**读时**问默认。
  **怎么用它**：这正是我们要避开的那一半。盖章式默认的代价是「改默认不追溯已建对象」，
  在分镜表里就等于「95% 的行把同一个值抄了一遍」——v6 §2.4.1 拆掉的就是这个（见 ②）。
  Nomi 选读时解析，而 React Flow 那条盖章语义我们**只用在节点建出来之后的画布覆写**这一段（第三段作用域）。
- **zod 默认「静默剥掉不认识的键」**：`node_modules/zod/v3/types.js:1984`（`unknownKeys === "strip"`）
  与 `:2053`（`z.object` 的默认 `unknownKeys: "strip"`），版本 3.25.76。
  **这就是本轮病灶之一的机制**：`storyboardPlanSchema` 没声明 `aspectRatio`，规划师写了也在 `parseStoryboardPlan`
  处被无声丢弃——不是 bug，是 zod 的契约。**用已有**：不给 schema 加 `.passthrough()`（那会让任意脏键混进 plan），
  而是把登记表里的 `planKey` 逐个声明进 schema，并由 `check:storyboard-owner` 判据 1 机器保证「表里有、schema 里也得有」。
- **`.strict()` 是另一端的反面**：主进程 envelope 用 `.strict()` 直接**拒收**未知键
  （`electron/shared/agentCapabilities/canvasWrite.ts:180` 补上的 `aspectRatio`，envelope 的 `.strict()` 在 `:184`）。
  一端静默丢、一端硬拒，两端都得改——**依赖已经把「未声明 = 不存在」说得很清楚了，是我们没把键声明上去。**

## ② 仓库里已有？

- **两段作用域的 owner 早就有，而且它自己写着「请求体也读这一个」**：
  `storyboardAspectScope.ts`（2026-09-05 v6 §2.4.1 拍板，commit `0d5a56d47`）第 48 行
  `effectiveShotAspect` 的注释原文是「这一行**生效**的画幅（覆盖优先，否则整片默认）——画面格几何、请求体都读这一个」。
  **实查推翻了后半句**：`git grep effectiveShotAspect 0d5a56d47 -- src` 的全部调用点是
  `StoryboardShotTable.tsx:281`、`storyboardLabKit.tsx:96` 和它自己的单测——**请求体那一端一个调用者都没有**。
  **怎么用它**：这条 owner 不推翻、不重写，本轮做的是把那句注释**变成真的**（补 `resolveShotParams` /
  `resolveKeyframeParams`，落在同一个文件里，改名只为职责扩面）。同时得到一条教训：
  「注释声称的 owner 覆盖面」不是证据，`git grep` 调用点才是（R14.1 的同类扫法）。
- **「键缺席 = 由下游默认接管」这个语义仓库里已有先例**：
  `src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:401-403` ——
  「存量值越界 → 回落该参数 defaultValue（无 default 则删键，由下游取档案默认）」。
  **用已有**：resolver 的第三段（整片默认为空时**不编值、干脆让键缺席**）与它逐字同义，
  不新造「显式 null / 'auto' 哨兵值」那种第二种表达。
- **「档案默认」这一层的 owner 也已经有**：`src/workbench/generationCanvas/agent/plannedNodeMeta.ts:156`
  （`control.defaultValue` 填 meta）与 `:164-170`（按 `control.key` 匹配，接不住的键诚实丢弃）。
  **用已有**：`unsupportedFilmDefaultKeys`（`storyboardShotScope.ts:172`）的判据与它**完全一致**——
  都按 `control.key` 匹配。判据分叉过就是「界面说接得住、执行侧丢掉」的下一个 bug。
- **第三段（画布覆写）的 owner 也已经有**：`src/workbench/generationCanvas/model/storyboardOverrides.ts:10`
  `overriddenShotFields`（2026-09-09 拍板方案 B：方案正本 + 逐字段覆写）。
  **用已有 / 不碰**：resolver 只产出前两段的合并值，`projectShotNode` 末尾照旧让画布覆写最后落笔，两层不争。
- **同形状的 resolver 在主进程侧也已存在**：`electron/shared/videoCapabilities/planResolver.ts:181`
  按 `modeDurationRange(mode)` 把时长夹进档案范围。
  **结论**：「按档案能力把意图折算成合法参数」这件事在 electron 侧有一份、渲染侧现在有一份——
  它们今天分管不同的键，不重叠；但这正是 §6 那条遗留（画幅键翻译）**不能随手在渲染层再写第三份**的理由。
- **「哪个键表示画幅」的 owner 也已经有两处**：`src/workbench/generationCanvas/nodes/aspectRatio.ts:12`
  的 `ASPECT_RATIO_KEYS`（四种写法）与 `src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:113`
  的 `ASPECT_RATIO_ALIASES`（九种写法，含 `aspectRatio` / `videoSize`）。
  **用已有**：§6 的遗留落点就在它身上，本轮**不新造第三份**，也因此本轮不做——它需要一次跨进程的边界搬家。

## ③ 生态里已有？

- **CSS 的层叠与继承**（<https://www.w3.org/TR/css-cascade/>）：这是「读时解析」最成熟的先例——
  继承值不会被抄进每个元素的 declaration，而是在**计算值**阶段沿树求出来；元素自己写了声明才叫覆盖。
  **对齐**：我们的优先级链（画布覆写 > 行覆盖 > plan 默认 > 全镜共同值 > 片种声明 > 档案默认）
  就是一条 cascade，`shot.params` 里**键缺席**等价于 CSS 里「没有这条声明」，不是「显式设成 auto」。
  这也解释了为什么「把默认抄进每一行让症状消失」是错的：那等于把计算值写回 specified value，第二次改默认就全失效。
- **React Flow 的官方 API 文档**（<https://reactflow.dev/api-reference/react-flow#defaultedgeoptions>）：
  盖章式默认的权威说明，见 ①。生态里这两种默认语义**都存在且都正当**——
  区别在于「默认之后还会不会变」。整片画幅是会变的（用户随时改批量条），所以只能读时解析。
- **模型供应商这一端没有统一标准可对齐**（R31 的边界）：画幅参数在各家 API 里就是分叉的——
  仓库自己的键表 `src/workbench/generationCanvas/nodes/aspectRatio.ts:12` 就登记了四种写法
  （`aspect_ratio` / `size` / `ratio` / `image_size`），逐档案的清点见方案 §6。**没有标准可抄**，所以 canonical 键沿用仓库既有的
  `aspect_ratio`，各家差异交给 codec 的 `paramMap` 翻译（`src/config/modelArchetypes/gptImage2.ts:11-13` 的铁律注释）。
  接不住的档案**诚实丢弃并在界面说出来**，不自造一层「猜一个最接近的尺寸」——那是替用户编数据。

## ④ TikHub 自媒体里怎么说？

本轮**查成了**（`TIKHUB_API_KEY` 在环境里）：`node scripts/research/tikhub-search.mjs --q "AI生成视频 画幅 竖屏 设置了没用"
--platform douyin,xhs,bilibili --limit 10`，30 条原文落在同目录 [`tikhub/tikhub-search.md`](tikhub/tikhub-search.md)。
读下来只有三条与本轮有关，其余都是「横转竖怎么扩图」的剪辑教程（不是同一件事）：

- **「AI视频比例翻车，一招教你搞定比例控制！」**（抖音 · AIGC王海龙，<https://www.douyin.com/video/7646282377853772392>）——
  「比例翻车」是这群人的通用说法：**设了比例、出来的不是那个比例**。这正是用户报的形状，说明它不是 Nomi 独有的体验。
- **把画幅写进提示词正文**（小红书 · AI变现研习院，标题即
  「9:16竖屏画幅，15秒视频、60fps帧率…」，<https://www.xiaohongshu.com/explore/6a922cb4000000002501d6f6>）——
  用户的**真实绕行**是不信任那个参数，改用提示词去求。
  **对本轮的意义**：绕行的存在说明「参数没传到」这件事用户**察觉得到但归因不到**，
  所以诚实交付必须是「界面说出来哪几镜的模型不吃这个键」，而不是默默替他把值塞进 prompt。
- **「秒剪，竖版照片有时候铺满，有时候又很小」**（小红书 · 大枣大核，
  <https://www.xiaohongshu.com/explore/690edc460000000007002c20>）——
  同一族症状的另一种面孔：**同一个设置在不同素材上时灵时不灵**。对应我们这里「有 params 的行灵、继承的行不灵」。

**没查到的**：没有一条自媒体在讲「工具内部整片默认怎么落到每一镜」——这是实现侧的话题，
自媒体那一层只看得见结果。所以 ④ 对修法**没有**贡献，只对「要不要如实说出来」这个取舍有贡献。

---

## 结论

**用已有 + 补一个导出口，不自研第二套默认合并层。**

| 这一层 | 裁决 |
|---|---|
| 两段作用域模型（整片默认 / 行覆盖） | **用已有**（v6 §2.4.1 的 `storyboardAspectScope`），只扩职责改名 `storyboardShotScope.ts` |
| 读时解析 vs 创建时盖章 | **读时解析**（对齐 CSS cascade；React Flow 的盖章语义只用在画布覆写那一段） |
| 「键缺席 = 下游默认接管」 | **用已有**（`archetypeMeta.ts:401-403` 同语义） |
| 「模型接不接得住这个键」 | **用已有**（`plannedNodeMeta.ts:164` 的 `control.key` 匹配，判据不许分叉） |
| 画幅键跨档案翻译（`aspect_ratio` ↔ `size`） | **本轮不做**：owner 在渲染层、第二个读者在 electron/shared，需要一次独立的中立契约层搬家（方案 §6） |
| 新造「默认值合并器」 | **不做**（并行版，P1） |
