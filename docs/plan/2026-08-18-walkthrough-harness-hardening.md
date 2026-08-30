# 走查框架加固：把「假绿」从纪律问题变成结构问题（2026-08-18）

来源：用户「可以研究一下这些测试的根因，迭代更新一下，防止日后一直出问题」。
起因是我两天内在同一类错误上栽了 6 次（详见本轮三份走查的踩坑记录）。

## 调查：是框架的问题，不是个人手滑

全量扫 `tests/ux/` 的 143 个 `.mjs`：

| 缺陷 | 命中 | 分母 |
|---|---|---|
| A 缺基线的「不存在」断言 | **33 处 / 18 文件**（占同类 94%） | 143 |
| B 全页文本 / 歧义选择器观测 | **115 文件（80%）** | 143 |
| D 依赖环境数据的硬编码计数 | 24 处 / 15 文件 | 143 |
| E 扫源码不剥注释的结构测试 | **31 / 33（94%）** | 33 |
| F 截图产出但全文件无任何断言 | 约 50 文件（只有 55% 的文件有判定） | 141 |
| 共享断言助手 | **0 个**（`_launchApp.mjs` 只管启动） | — |
| 使用官方自动重试断言 | **0 / 143** | — |
| CI 实际会跑的走查 | **5 / 143** | — |

**诚实校准**：C 类「文本静止当完成信号」全仓 **0 例**——那条是我独创的，不该算进系统性缺陷。
D 类原始命中被 `design-fidelity.e2e.mjs` 的像素几何断言灌了水，真正依赖环境数据的是 24 处。

## 根因（两层）

**第一层：这片地没有任何门岗看得见。**
`eslint.config.mjs:28` 把 `tests/ux/**` 整个 ignore。更能说明问题的是——
`scripts/check-e2e-launch.mjs:6` 的注释里**前人已经诊断过**：「现有五门没有任何一道能看见这片地」，
但当时只修了「启动路径」这一个症状，没治「这片地没人管」这个病。

**第二层：没有重试断言，于是假绿是这套写法的必然产物，不是意外。**
仓库 0/143 使用 Playwright 的 web-first 断言（官方明确把 `expect(await x.isVisible()).toBe(true)`
标为反模式，因为它**立即取样**）。于是链条是：

> 一次性 `.count()` 天然有竞态 → 作者用 `waitForTimeout` 去糊（全仓 1136 处）
> → sleep 不够长时 count 读到 0 → **而 0 恰好让「不存在」断言通过**

所以 A 和 C 是同一个缺陷：**「不存在」断言架在非重试计数上，与「UI 还没渲染出来」在观测上完全等价。**

**但要说清楚：官方断言只治得了一半。** `toBeHidden()` 解决竞态型假绿；
解决不了「**这个现场根本不可能出现坏东西**」那种空洞通过（我栽的两次都属于后者：
在已有方案的项目里验「不浮拆分镜卡」、在没有多家模型的目录里验「没有 N 家折叠行」）。
后者没有任何库能替你做——必须由 Nomi 自己的断言 API **在类型/签名层面**逼出来。

## 范围

### A 断言底座（用户 2026-08-18 拍板：加官方依赖）
- 新增 devDependency `@playwright/test@1.60.0`（对齐已装的 `playwright@1.60.0`，共用内核与浏览器）。
- 已实测脱离 test runner 可用：普通断言 / `expect.poll` / locator 匹配器均正常。

### B 共享断言库 `tests/ux/_assert.mjs`（让「写对」比「写错」省事）
- `expectVisible / expectHidden / expectCount` —— 包一层官方 web-first 断言，自动重试。
- **`expectAbsent(locator, { provenBy })` —— 签名上强制要基线。**
  `provenBy` 必须是一个已经证明过「这个检查能测到东西」的 locator/断言句柄；
  不给就抛错。这是本仓特有的纪律，官方库不提供，也正是我栽的那两次。
- `waitForTurnIdle(win)` —— 「模型说完了」的**唯一**判定：停止键消失（turn 控制器的 `sending`），
  不许再用文本静止/固定 sleep。一处实现，全仓复用。
- `scopedText(locator)` —— 只读某个容器内的文本，替代 `document.body.innerText`。

### C 门岗 `scripts/check-walkthroughs.mjs`（棘轮，只减不增）
扫 `tests/ux/**` 与结构测试，抓四类，基线钉在今天的数字：
1. 「不存在」断言未经 `expectAbsent`（即缺基线）
2. 全页文本观测（`document.body.innerText` / 全页 `getByText().count()`）
3. `waitForTimeout(>=1500)` 紧跟断言（拿 sleep 当完成信号）
4. 扫源码的结构测试未剥注释
基线只减不增，和 `lint:ci --max-warnings=98`、`check:filesize` 白名单、`check:tokens` 棘轮同一套做法。
挂进 `pnpm run gates`。

### D 先治高危那批（用户拍板）
- **A 类 33 处**缺基线的「不存在」断言：逐个补基线或改用 `expectAbsent`。
  这批是**现在就在发假绿**的，不是理论风险。
- **E 类 31 处**扫源码不剥注释的结构测试：抽一个共享 `readSourceForStructureTest()`（剥注释+字符串）。
  这类会**反噬文档**——我本轮就被自己写的、记录该 bug 的注释打红过。

### E 我这两天新写的 3 份走查迁到新底座，当模板
`creation-flow-fixes` / `selection-toolbar-vendor` / `prompt-picker` / `custom-prompt-realtask`。

## 不动项

- 存量 143 个文件的 B 类（80% 命中）**不全量改**——量太大且多数是良性 `.first()`。
  靠棘轮挡新增，存量随各自被改动时顺手治。
- 不改 CI 跑哪几个走查（那是另一个问题：143 个里只有 5 个进 CI）。本轮只治「写出来的测试骗不骗人」。
- 不动 `_launchApp.mjs` 的启动逻辑（它是好的，本轮只在它旁边加断言层）。

## 回滚

新增文件为主 + package.json 一行依赖。门岗若误报可先从 `gates` 摘掉再修，不阻塞别人。
A/E 两批修复各自独立 commit，可单独 revert。

## 验收门

1. 七门 + 新增 `check:walkthroughs` 全过。
2. **门岗必须自证能抓到**：负向测试——故意写一处缺基线的「不存在」断言，门岗要红；
   修好要绿。（不做这步的话，新门岗本身就是下一个假绿。）
3. `expectAbsent` 不给 `provenBy` 时抛错，有单测钉住。
4. 迁移后的 4 份走查真机重跑，结论与迁移前一致（截图人眼对账）。

## 实施结果（2026-08-18）

### 门岗基线（棘轮，只减不增）

| 规则 | 首次取基线 | 迁移 4 份走查后 |
|---|---|---|
| absence-without-baseline | 79 | **70** |
| whole-page-text | 31 | **29** |
| sleep-as-done-signal | 117 | **113** |
| source-scan-without-strip | 20 | 20（`.ts` 结构测试，本轮未动） |

> 首次基线其实取过两次：46 → 79。因为第一版规则要求「归零比较」和「UI 观测」在**同一行**，
> 而真实写法普遍跨行（先 `const n = await x.count()`，再 `if (n === 0)`）。
> 负向测试当场暴露了这个漏报，改成往回看 5 行后，真实数字才浮出来。
> **这本身就是本轮的论点：没有负向验证的门岗，就是下一个假绿。**

### 迁移过程又挖出两个「一直在报绿、实际什么都没验」的测试

两个都不是产品 bug，是**测试自己在骗人**，且都是被 `expectAbsent` 的 `provenBy` 签名逼出来的：

1. **`prompt-picker` ⑦「自定义提示词不被拆分镜劫走」结构上不可能失败。**
   `StoryboardNudge.tsx:11` 要求文稿正文 ≥60 字才浮卡，而 seed 的故事只有 43 字——
   卡片永远不会出现，`nudge === 0` 恒真。修法：把 seed 加长过阈值。
   还有个连带发现：基线必须放在检查 ③ **之前**——③ 选的「写剧本」本身是 `dedicatedJob`，
   从那一刻起卡片就被永久压制了，基线放后面同样测不到东西。

2. **`creation-flow-fixes` D「素材规划下不推拆分镜」根本没切换模式。**
   旧的 chip 定位器配 `.click().catch(() => {})`，点空了也被吞掉；截图显示 chip 仍是「通用」。
   （诱因是本轮把选择器从 header 挪到了 composer，旧定位器随之失效——
   而**没有断言的点击不会因为定位器过期而报错**。）改用精确锚点 + 硬断言 chip 标签真的翻了。

### 顺带发现（已另开单子，不在本轮范围）

`react-flow__node` 这个类名在 `src/` 里**零命中**，画布节点实际用 `[data-node-id]`；
但 3 个走查在等它：`composer-long-prompt.walk.mjs:133`（计数恒 0）、
`decompose-ui.walk.mjs:119,146`（点击永远落空且被 catch 吞掉）、
`dark-journey.walk.mjs:24,73`（在候选列表里并列，属良性降级）。

## 补做：死选择器（2026-08-18 追加）

用户要求把 `react-flow__node` 那张单子一并做掉。做的过程中把它升级成了门岗的第 5 条规则。

**先证伪再动手**：`.react-flow__node` 是 xyflow 运行时类名，不出现在源码里也可能正常。
实查：`package.json` 零图库依赖、`node_modules` 里没装、画布是自研的 `generation-canvas-v2`
（`comfyuiGraphGeometry.ts:5` 还专门写着「实查无 xyflow/React Flow」）。确认是真死的才改。

真实锚点是 `[data-node-id]`（`BaseGenerationNode.tsx:283` / `ClipNode.tsx:475` /
`LightweightGenerationNode.tsx:41`）。修了 3 个文件；`composer-long-prompt` 那处原来
只把恒为 0 的计数 `console.log` 掉、从没断言过，顺手补上断言。

### 新增规则 `dead-selector` 当场又抓到 2 处

| 命中 | 判定 |
|---|---|
| `canvas-performance-benchmark.e2e.mjs` 的 `...__resize-zone--se` | **误报**——源码里是模板拼的 `` `...resize-zone--${direction}` ``，运行时真实存在。规则已加「去掉尾部 `--xxx` 再查基名」 |
| `archetype-modebar.e2e.mjs` 的 `...__settings-pop` | **真死**，且连它点的 `aria-label="生成设置"` 按钮也零命中 |

第二处是个教科书级案例：**同一个死选择器让一条断言硬红、另一条空洞通过**——

```js
const pop = document.querySelector('.generation-canvas-v2-node__settings-pop')  // 恒 null
assert(hasLabeledRes, …)   // Boolean(null) → false → 报红
assert(!i2vHasRatio, …)    // !false → true   → 空洞通过 ✅
```

根因是那片 UI 已经重做过：旧「生成设置按钮 → settings-pop 弹层」→ 新「摘要 pill → 统一参数面板」
（`InlineParameterBar.tsx:41-44`），而测试没跟着走。按新面板的稳定无障碍锚点修好：
触发钮 `aria-label="生成参数"`、面板 `[role="group"][aria-label="生成参数面板"]`。

`dead-selector` 基线固化在 **0** —— 以后任何一个死选择器进来都会当场报红。

## 补做：`dark-journey` 整份根本没在导航（2026-08-18 追加）

修完死选择器后真机重跑 `dark-journey.walk.mjs`，才看清它**从来没走过那条旅途**，却一直报绿：

| 证据 | 说明 |
|---|---|
| stdout `opened example: false` | 「打开示例项目」的两个候选定位器 count 都是 0，整步没落地 |
| `01-J1` / `02-J2` / `03-J3` 三张 PNG **各 102303 字节、完全相同** | 三段截的是同一张空库页「这个分类下还没有项目 · 全部 0」 |
| `04-J4` 里项目却是开着的，且停在引导 tour 的结束卡（`引导结束`） | 进到项目里的不是脚本，是 tour 自己跑过去的 |

### 三个根因（都不是「定位器写错了」）

1. **库是空的，压根没有项目可点。** 隔离 `userDataDir` 里没有任何项目，
   而「修好一个小机器人」是引导 tour 现建的（`NomiStudioApp.tsx:423` `playJourneyTour`）。
   定位器修一百遍也点不出一个不存在的卡片。
2. **点击失败长得和成功一模一样。** `clickText` 拿 `count() > 0` 当成功判据、
   又用 `.catch(() => {})` 吞掉真实点击失败 —— 这正是 `_assert.mjs` 立项要治的那条，
   但当时只补了断言，没补**点击**。
3. **每段只截图、不判定。** 截图是产出不是判据，截到什么都算数（F 类：约 50 个文件如此）。

### 改法

- **`tests/ux/fixtures/journey-project-fixture.mjs`（新）**：起飞前按落盘格式种一个「做完的项目」——
  6 个成片镜头节点 + 6 条时间轴 clip + 一篇文稿，三个工作区各有真实内容。零模型零额度零网络。
  两个落盘要点写进了注释：项目靠 `<projectsDir>/<文件夹>/.nomi/project.json` 被发现
  （`legacyProjectMigration.ts:114`），hydrate **只读 `payload`**（`workbenchProjectSession.ts:25`）。
  旅程从此不依赖引导 tour，也不依赖用户本机有什么。
- **`_assert.mjs` 补 `clickOrFail(locator, label)`**：`toBeVisible` 后再点，点不到就抛。
  补上了「断言有了、点击还在裸奔」这个缺口。
- **`dark-journey.walk.mjs` 重写**：每段先断言「我到了这儿」（工作台 `[data-workspace-mode]`
  + 本段独有锚点 + 内容计数）再截图；`dismissTour` 整个删掉 ——
  它拿 `/跳过|完成|知道了|开始创作/` 在全页乱点，是这份脚本里唯一会**自己制造导航**的东西。
- **顺手删 X1「模型接入」/ X2「技能库」两段**：都是无断言的顺手截图，
  且 X2 等的 `[aria-label*="技能"]` 在工作台外壳里没有触发入口（`SkillLibraryPanel` 未挂载），
  是永不命中的死步骤。模型接入面另有 `model-onboarding.walk.mjs`。

### 新增结构不变量：截图两两不同

逐段断言各自只看一个锚点；`assertStagesAreDistinct()` 从**产出**这一侧再兜一次底——
五段不同的界面不可能截出字节相同的 PNG，出现重复只有一种解释：中间那步没发生。
这条正是当初唯一暴露问题的证据形态（三张 102303 字节的同款空库页），现在它会报红。

### 负向验证（按本文档验收门第 2 条，两条都真跑过）

| 故意打断的地方 | 结果 |
|---|---|
| 把项目卡定位器改成 `[data-project-card="nope-dead-selector"]` | **报红**：`toHaveCount` 等满 15s 抛错 + 落 `99-failure.png`。旧版在这里只会印一行 `false` 然后继续截图 |
| 让两段截同一屏（两段自身断言都成立） | **报红**：`assertStagesAreDistinct` 抓到字节相同并指名是哪两段 |

真机重跑 6 段全绿，六张截图逐张人眼对账过：库（恰好 1 个项目卡）→ 创作（种下去的正文可读）
→ 画布（6 个镜头节点）→ 选中节点（图片操作工具栏 + 参数面板）→ 预览（6 条 clip + 播放器画面）
→ 导出（进度条 + 转码中）。J5 只走到「导出真的启动了」就收工，不等它跑完——
跑完会 `showInFolder` 弹 Finder，真机走查不该在收尾时劫持用户桌面。
