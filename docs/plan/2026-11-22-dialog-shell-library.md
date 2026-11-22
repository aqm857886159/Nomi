# 弹窗外壳改用 Mantine 组合组件管读屏名字（设计卡）

```
改动名：弹窗外壳接管读屏名字与测试定位    线/负责人：I-dialog-shell-library（Claude 实现线）    类别：[花钱][新界面]
```

方向检查：`docs/engineering/direction-checks/2026-11-22-dialog-shell-owns-name.md`（推荐「换一种做法」，用户 2026-11-22「照推荐做」；随后追问「有没有什么开源的东西……别人怎么做」→ 做法是接现成的：名字用 Mantine 组合组件、定位用 Playwright 按角色找、漏写检查用 axe-core）。已定：D-1122-dialog-shell-owns-name、D-1122-dialog-shell-use-library、D-1122-modal-names-release。协调 2026-11-22 四项裁定（尺子、副标、两处名字变化、锚点）写在各格里。

目标：读屏用户打开任何弹窗，听到的只是它叫什么，副标在阅读顺序上紧跟名字（Mantine 8.3.18 的 aria-describedby 固定指向 Modal.Body，出处 `node_modules/@mantine/core/esm/components/ModalBase/ModalBaseContent.mjs:42-43`）；以后新写一个弹窗，从结构上写不出把图标、副标、按钮并进名字的错；测试找弹窗跟创作者和读屏看到的一样（角色 + 名字）；「有没有弹窗漏写名字」由 axe-core 的 `aria-dialog-name` 查。19 个用外壳的弹窗样子一像素不变。

## 先查别人

- `node_modules/@mantine/core/esm/components/ModalBase/ModalBaseContent.mjs:39-43`（@mantine/core 8.3.18，`package.json` 里的版本；任务书写的 8.3.14 是旧数）· 对话框本体 `role="dialog"`、`aria-modal`、`aria-labelledby` 指向 `Modal.Title` 的 id、`aria-describedby` 指向 `Modal.Body` 的 id，四个都写在 `...others` 之后，外面传什么都盖不掉 · **确认了**：名字只能来自 `Modal.Title` 里的文字，所以名字以外的头部内容必须放到 `Modal.Title` 之外；**改了**：任务书原想把副标挂成 `aria-describedby`，库不支持，协调裁定照库原样，副标在 `Modal.Header` 里紧跟名字，删掉 sr-only 复本。代价：NVDA 焦点刚落到对话框时不把副标当描述先念，要往下读才念到。
- `node_modules/@mantine/core/esm/components/Modal/Modal.mjs:55,67-103` + <https://mantine.dev/core/modal/>（Compound components、Accessibility 两节）· `<Modal>` 自己就是 `Modal.Root` → `Modal.Overlay` + `Modal.Content` →（`Modal.Header` → `Modal.Title` + `Modal.CloseButton`）+ `Modal.Body` 的组合；文档说 `Modal.Title` 是 `aria-labelledby` 指向的 h2、`Modal.Body` 是 `aria-describedby` 指向的元素；`classNames` / `styles` 给 `Modal.Root` 后各部件照样吃到 · **确认了**：外壳改用组合组件后 DOM 与今天 `<Modal>` 渲染的逐层相同（同样的类、同样的 id 规则），头部插槽放在 `Modal.Header` 里、`Modal.Title` 之外是库支持的写法，不触发「Mantine 做不到」那个停点。
- <https://playwright.dev/docs/locators>（Locate by role、Locate by test id 两节）· 推荐按角色 + 可访问名字找元素（`getByRole('dialog', { name })`），test id 是最后手段，`getByTestId` 默认认 `data-testid` · **改了**：迁的走查改按角色 + 名字找弹窗、按角色 + 名字找关闭键；外壳只留一个带类型的 `testId` 口子（渲染成 `data-testid`），不再开任意属性包。
- <https://dequeuniversity.com/rules/axe/4.10/aria-dialog-name> · axe-core 规则 `aria-dialog-name`：`role="dialog"` / `alertdialog` 必须有可访问名字（aria-label / aria-labelledby / title），严重度 serious · **改了**：自写的语法普查 `src/design/modalTitleAccessibleNameCensus.test.ts` 删掉，「有没有弹窗漏写名字」改由 `@axe-core/playwright` 跑这条规则；axe 只管「有没有名字」，「名字是不是只有标题那一句」由同一个测试另断言 aria-labelledby 指向的元素文字等于 `title`、上面没有 aria-label（协调裁定①的尺子）。
- <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/> + <https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html> · APG：`aria-labelledby` 指向看得见的标题，`aria-describedby` 可选、内容复杂时宜省略；WCAG 2.5.3：可访问名字要包含看得见的标签文字 · **确认了**：上手手册的名字改成看得见的那行标题（今天读屏念「上手手册」，屏幕上写的是「Nomi 一页上手：从安装到第一条 AI 视频」，两者不一致），自定义调用（弹窗形态）的名字只留标题「请求脚本」/ "Request script"、模型名紧跟其后（协调裁定③）。
- 出口：不涉及：不新增、不扩大、不挪动任何挡人的保护；花钱确认的弹出条件、确认顺序、关法（关闭键 / Esc / 点遮罩 / 取消都不花钱）一律不动。

## ★1 用户怎么用

当读屏创作者在画布上点「生成」弹出花钱确认、或在技能库点开一个技能、或打开设置 / 更新 / 上手手册，我想读屏先念出这个弹窗叫什么（只念名字），接着念到副标和正文，以便知道这一步要我决定什么。

步骤：①触发弹窗（画布生成、技能卡、顶栏设置、更新角标、上手手册入口）；②焦点落到弹窗；③读屏念名字；④往下读到副标（Agent 发起的花钱卡「经 AI 助手驱动 · 需你确认生成」）；⑤读正文与决定栏；⑥用关闭键、Esc 或决定栏关掉。

不做什么：不改任何弹窗的样子、文案、按钮顺序；不改花钱确认的弹出条件、扣费、确认顺序；手写 `role="dialog"` 的 26 处不在本刀（清单留给后面一刀）；Agent 聊天里的花钱卡不走这个外壳，不动。已知坑：副标不进 `aria-describedby`（库写死指向正文），NVDA 焦点刚落下时不先念副标。

真实任务（不花钱）：
1. 花钱确认（Agent 发起，带副标）：设计实验室 ps-37 经 E2E 桥（真 `requestConfirm`）开 Agent 生成 / Agent 方案 / 用户参考三种头部，中英 × 明暗；真窗口走 `tests/ux/generation-lock-exit-approved.walk.mjs`（假供应商，确认 / 取消 / 关闭键 / Esc / 点遮罩）。
2. 技能详情（标题栏装封面、简介、来源链接、自带关闭键）：设计实验室 ps-21；真窗口走 `tests/ux/skill-library-specimen.walk.mjs`、`tests/ux/skill-library-cards.walk.mjs`。
3. 设置（页签）与更新弹窗：`tests/ux/about-update-entry.walk.mjs`、`tests/ux/notification-policy.walk.mjs`、`tests/ux/vendor-baseurl-discoverability.walk.mjs`。

指标（目标 → 信号 → 指标）：
- 主指标：19 个弹窗中「名字只有标题那一句」的比例。量具：`tests/ux/design-lab-primitives-surfaces.walk.mjs`（每格 axe `aria-dialog-name` + aria-labelledby 指向元素文字 === 名字、无 aria-label）与 `src/design/dialogName.browser.test.ts`。基线（main 1745327c7）：7 个不合格（技能详情、提示词提取设置、上手手册、更新、选区保存、自定义调用、花钱卡 Agent 头部）；目标：全部合格。
- 质量指标：样子不变。量具：逐像素对照脚本 `diff-shots.mjs`（证据目录），main 与分支同一脚本同尺寸截图，差异像素 0（会动的 3D 预览单列）。
- 护栏指标：`title` 只收字符串。量具：`src/design/overlays.types.test.ts`（`pnpm run typecheck` 里的测试类型检查；`tsconfig.test.json` 只收 `*.test.ts`，所以是 `.ts`、用 `createElement` 写）；锚点冻结名单 `src/design/dialogAnchorFreeze.test.ts`。

新界面一句话 brief：不新画界面，外壳内部换实现；人设：读屏老手（NVDA / VoiceOver 用户）与看屏的新手都不该察觉样子有变化，读屏老手听到的名字更准。每步「预期 → 实际」记在证据目录 `real-*/` 与报告里。

### ★1b 连带界面

- 读屏念的名字变化的弹窗（PR 正文「读屏名字变了的弹窗」一节逐个列改前 / 改后）：上手手册（「上手手册」→ 看得见的标题）、自定义调用的弹窗形态（「请求脚本 模型名」→「请求脚本」，模型名紧跟着念；产品里只用页面形态）；其余弹窗念的名字不变。
- 设置弹窗左侧页签：当前页签多了 `aria-current="page"`（替掉 `data-settings-tab` 锚点，走查按它认当前页），读屏在当前页签上会多念一句「当前页」；页签按钮本来没有 `role="tab"` / `aria-selected`，不冲突。
- Agent 回执、通知、任务列表、错误卡、撤销提示：不涉及（不新增动作、不改文案）。

### ★1c 老用户

不适用：不碰存量数据（花钱卡的待确认只在内存，`spendConfirm.ts`；其余弹窗不落盘），升级后样子、入口、操作都不变，退回上一版无影响。用户自己写的走查 / 脚本若认 `data-skill-detail`、`data-update-dialog`、`data-updater-dialog`、`data-settings-tab`、`data-settings-frame`、关闭键 `data-spend-confirm-action="close"`，要改按角色 + 名字找（仓库里的消费方本刀全部迁完）。

## ★2 谁说了算

- 弹窗的读屏名字：唯一主人 = Mantine `Modal.Title`（由外壳 `src/design/overlays.tsx#DesignModal` 渲染，内容只能是 `title: string`）。别处拿不到做名字要用的原料：`DesignModal` 的 `title` 类型只收字符串、`accessibleName` 口子删掉，外壳之外的头部内容只能进 `header` 插槽，而插槽拿到的是外壳已经造好的标题元素（渲染函数 `header={(title) => …}`），插槽里再写什么都在 `Modal.Title` 之外。概念登记：并进已有概念 `ui.dialog-layout`（主人同是 `DesignModal`），不另起概念。
- 测试定位：走查按 `getByRole('dialog', { name })`；外壳给的唯一自起锚点口子是带类型的 `testId`（`data-testid`）。还没迁的旧锚点只有冻结名单里那几个（`src/design/dialogAnchorFreeze.ts`，类型上是封闭的字面量联合，名单外的名字写不进外壳；名单只许减）。
- E2E 桥 `window.__nomiSpendConfirmE2E`：唯一的家 = `SpendConfirmHost`（app 根上常驻挂载的那一个），删掉 `NomiStudioApp.tsx` 与 `SpendConfirmDialog.tsx` 两处赋值；结构检查并进已经遍历 src 的 `src/workbench/generationCanvas/spend/SpendConfirmHost.test.tsx`（已在推送前扫描名单里），数全仓赋值 = 1 且在 `SpendConfirmHost` 里。
- 外壳的主题默认值：`Modal.Root` 读的是 `ModalRoot` 的主题默认值，不读 `Modal` 的；`nomiTheme.ts` 给 `Modal` 配的 radius / shadow / zIndex 由外壳自己 `useProps('Modal', …)` 取，样子才和改前一样（少了它 shadow 'lg' 会丢）。
- 漏写名字检查：axe-core `aria-dialog-name`（第三方规则），删自写普查 `src/design/modalTitleAccessibleNameCensus.test.ts`；它在 `self-written.json` / 概念登记里本来没有条目（实查），唯一的登记是 `scripts/pre-push-scan-guards.mjs` 的推送前扫描名单，那一行换成 `dialogAnchorFreeze.test.ts`。
- 「不知道」当成功：不涉及（没有异步结果、没有状态推断）。
- 全部家清单：`node scripts/door-map.mjs DesignModal`、`git grep -n "accessibleName\|contentAttributes" -- src`（改后应为 0）、`git grep -n "__nomiSpendConfirmE2E =" -- src`（改后 1）。

## ★3 一致与复用

- 以前定过什么：D-1122-modal-names-release（#1594 的 `accessibleName` 是过渡，本刀删）；`docs/design/nomi-design-system.md` §3.5（外壳的高度、滚动、决定栏、初始焦点照旧）；D-1118-creator-view-testing（走查按角色 + 名字找）。都还算数。
- 三条路（方向检查 §6）：沿原方向修（留口子 + 普查）× ——其它 18 个弹窗照样能写错；删掉（花钱卡标题栏只留一句）× ——样子变、只管一张卡；**换一种做法（接现成的 Mantine 组合组件 + Playwright getByRole + axe）✓**。
- 复用：Mantine `Modal.*` 组合组件（外壳内部）、`@axe-core/playwright` 4.14.0（新增开发依赖，只进测试，不进安装包）、Playwright `getByRole` / `getByTestId`。不新增自写登记（`check:self-written`）。

## ★4 全状态

外壳不新增状态。逐类核：空（花钱卡没有待确认 → 不挂卡，不变）/ 加载（不涉及）/ 成功、失败、部分成功（弹窗内容各自的，不变）/ 取消中（花钱卡关法四种都不花钱，不变）/ 过期（不涉及）/ 能力不可用（不涉及：外壳不调模型或外部资源）。会被数据撑开的地方：花钱卡标题 `truncate` 单行、Agent 副标单行，技能详情标题、简介按原样换行——这些 class 原样搬进插槽，设计实验室截图核长名字格（ps-21、ps-37）。文案：不新增、不改词条（`check:i18n`）。

## 5 中途表

| 状态 \ 打断 | 停（Esc / 关闭键） | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 花钱卡开着 | 看到卡关掉 · 不扣 · 不派生成（走查 `generation-lock-exit-approved` 核假供应商请求数不变） | 卡随窗口没了 · 不扣 · 待确认在内存里，按「未确认」处理（不变） | 卡照样在 · 不扣 · 确认后才发请求（不变） | 卡没了 · 不扣 · 不恢复（不变） | 确认键一次只结算队首一张（store 不变） |
| 其他 18 个弹窗开着 | 看到弹窗关掉 · 不涉及花费 · 无回执（不变） | 弹窗没了 · 不涉及 · 无（不变） | 不涉及（外壳不发请求） | 弹窗没了 · 不涉及 · 无 | 关闭键 / Esc 重复按只关一次（Mantine 不变） |

## 6 外部数据与失败

- Mantine 8.3.18 Modal（<https://mantine.dev/core/modal/>）· 偏差：不用 `<Modal>` 一体式，改用组合组件逐件拼出同一棵 DOM · 失败时用户看到：样子变（由逐像素对照拦）。
- axe-core 4.x 规则 `aria-dialog-name`（<https://dequeuniversity.com/rules/axe/4.10/aria-dialog-name>）· 偏差：另加「名字只有标题那一句」的断言（axe 只查有没有名字）· 失败时：只在测试里红，不影响用户。
- 不涉及供应商 API、用户文件、用户输入。

## ★7 性能

不适用：外壳内部从一体式 `<Modal>` 换成同一套部件逐件拼，渲染的 DOM 层数、组件数与今天相同，不新增用户操作、不新增监听、不新增动画；没有新功能。量具：设计实验室逐像素对照（同一棵 DOM）。

## 8 真实条件

- 英文界面：设计实验室中英两轨全截；真窗口走查中英各一遍（`generation-lock-exit-approved` 内置 zh-CN / en）。
- 暗色：花钱卡四种头部明暗都截。
- 最小窗口：unverified（本刀不改布局，逐像素对照在 1440×1000 视口）。
- Windows：unverified（无设备；只换外壳内部结构，不涉平台分支）。
- 真规模 / 干净安装：不涉及。
- 真付费：不跑（协调豁免：只换名字结构，不碰发送和扣费），付费 / 真模型走查逐个记 unverified。
- 键盘全程：关闭键、Esc 各关一次（真窗口），花钱卡回车 = 主动作与初始焦点落在对话框本体照旧（`spend-confirm-a11y.walk.mjs`）。
- 读屏实机（NVDA / VoiceOver）：unverified（无读屏实机；以 accname 计算 + axe 代替）。

## 拍板图清单：链接

不适用：不照板实现、不认领拍板元素——外壳内部换实现，19 个弹窗样子不变，用改前 / 改后逐像素对照证明（D-1116-board-map-rule-wording）。

## ★9 验收与回滚

验收清单（动手前写全，实现线按它自验、验收线只核它）：

两种没做成的版本，两种都红才往下做：
- 「什么都不做」（main 1745327c7，分支后来快进到 bdfc8f3ed；两者之间没有碰弹窗外壳和 19 个调用方的提交）：① `src/design/overlays.types.test.ts` 的 `// @ts-expect-error`（给 `title` 传 JSX）在 main 上红（指令没用上）；② 名字断言（aria-labelledby 指向元素的文字 === 名字、元素上没有 aria-label）对技能详情、花钱卡 Agent 头部在 main 上红（设计实验室量具 + `dialogName.browser.test.ts` 在 main 的真组件上跑）。
- 「全部拦下」（临时改外壳：不渲染 `Modal.Title`；或给对话框本体加 `aria-hidden`）：axe `aria-dialog-name` 红、`getByRole('dialog', { name })` 找不到红。

反例（改坏 → 红、还原 → 绿，日志进报告）：
| # | 改坏 | 应红的检查 |
|---|---|---|
| ① | 某个调用方给 `title` 传 JSX | `pnpm run typecheck`（TS2322）+ `overlays.types.test.ts` |
| ② | 把花钱卡的 Agent 副标挪进 `Modal.Title`（插槽里把副标包进标题元素） | `dialogName.browser.test.ts` 名字断言 |
| ③ | 删掉某个弹窗的标题（外壳不渲染 `Modal.Title`） | `dialogName.browser.test.ts` 的 axe `aria-dialog-name` |
| ④ | 迁过的走查改回用 data 锚点、并把锚点改名 | 该走查（`skill-library-specimen.walk.mjs`）红；改回按角色 + 名字找则不依赖锚点名 |
| ⑤ | E2E 桥在别处再赋值一次 | `SpendConfirmHost.test.tsx`（「E2E 桥全 src 只赋值一处」） |
| ⑥a | 经 `frozenAnchors` 挂名单外的锚点 | `pnpm run typecheck`（封闭联合，TS2353） |
| ⑥b | 直接在 `<DesignModal>` 上写名单外的 `data-*`（带连字符的 JSX 属性 TS 不查） | `dialogAnchorFreeze.test.ts`（名单外） |
| ⑥c | 名单里的锚点调用方已不挂、名单还列着 | `dialogAnchorFreeze.test.ts`（名单过期） |

这一类还会从哪回来：另一个调用方（19 个以外新写的弹窗）——`title: string` 类型拦；手写 `role="dialog"` 的 26 处——本刀不保护，列清单留后面一刀；Agent 聊天花钱卡——不是弹窗，不在范围；Mantine 升级——`dialogName.browser.test.ts` 用真库跑，升级改了 aria 接线会红。

样子：19 个弹窗设计实验室中英 × 浅（花钱卡另加暗色与三种头部）main 与分支逐像素比，差异像素数逐格列出，必须 0（ps-33 的 3D 动作预览本身在动，main 自比就不为 0，掩掉那块画布单列）；`pnpm run check:design-lab` 无差异。真窗口：19 个弹窗各开一次、关闭键 / Esc 各关一次；花钱卡确认后假供应商收到的生成请求数与 main 相同。

自验命令：`pnpm run typecheck`、定向测试与 eslint、全量 `pnpm test`（经锁）、`pnpm run gates:contracts`（经锁）、`pnpm run check:design-lab`（经锁）、迁过锚点的免费走查全跑、`node scripts/verify-line-meter.mjs`。

独立验收：另一条线（编号由协调定，不得为 I-dialog-shell-library），按上表跑两种没做成的版本与反例，报告链接写进 PR `## 独立验收`。

回滚：revert 本 PR 的合并提交即可（不碰存量数据，无迁移）。
