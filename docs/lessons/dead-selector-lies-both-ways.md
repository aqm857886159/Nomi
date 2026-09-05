# 一个死选择器同时造假红和假绿

> 📎 教训 · 首次记录 2026-08-24 · 状态：现行
> **触发场景**：确认某个走查锚点已经失效（元素改名 / 被删 / 语义变了），你正准备只改报红的那一处。

**结论**：**别只修报红的那一处**。同一个死选择器在「断言它存在」处报**假红**，在「断言它不存在」处报**假绿**（数到 0 恒真）。修之前先 grep 该选择器的所有用法，逐处判断。

## 为什么会踩

报红会逼你去看，**假绿不会**——所以假绿能活很久。而它俩往往是同一行代码的两个面。

2026-08-24 实例：`scene3d-export-journey` 里 `[title="拖动播放头"]` 早已失效（播放头按设计退化成 `pointer-events-none` 纯指示器，seek 交给轨道容器）。它同时制造了：

- **假红**：「落预设后时间轴没自动打开」——时间轴其实好好地自动开了；
- **假绿**：「时间轴默认收起」——这条从来没验证过任何东西。

只盯着报红那条修，假绿会原地留着继续骗人。

## 怎么用

1. 确认锚点失效后 `grep -rn '<那个选择器>' scripts/ tests/`，逐处判断。
2. 「不存在」类断言一律改走 `tests/ux/_assert.mjs` 的 `expectAbsent(locator, { provenBy })`——签名会逼你先 `proveProbe()` 证明探针在这一屏是活的。
3. 同理复查「点得动就算过」的写法（`.click().then(() => true)`）——**点中了错的元素也会 true**，要用状态数量变化来证明动作真发生了。

2026-09-05 再一例（**锚 i18n 文案的选择器会随组件退役整批死**）：`[aria-label="生成区 AI 助手"]` 是 i18n 值 `generationCommon.assistant.panelAria`，消费组件在 Agent Host cutover 里被删，但同一字面量还活在两份走查里——`agent-panel-system-prompt` 断言它存在（假红），`design-fidelity` 先断它「未挂载」（恒真=假绿）再 `waitForSelector` 它（假红）。走查锚点优先用 `data-*` 结构锚（`[data-agent-panel]`、`[data-agent-transcript]`），不随语言和文案变；一个 aria-label 字面量在 `tests/ux` 里出现就 `grep -rn` 它在 `src/` 里还有没有渲染者。

2026-09-05 第三例（**整块 UI 被删时，比例不是 1:1，是一对多**）：`805096d41` 删掉中列 `StoryboardPlanCard`，
一并带走 `[data-storyboard-card]` 和它上面「打开分镜 / 再次编辑」两条 i18n 文案。repo-wide grep 的结果是
**10 处用法、9 处假红、0 处假绿**——唯一那处「断言它不存在」（`agent-ui-a-composer.walk.mjs`）是删卡片那次
自己写的，是对的。所以 grep 的收益不只是"揪出假绿"：**删组件那一类会一次性造出一片假红**，只修报红的那份
等于把同一份考古再做八遍。另有一处更阴的：`agent-runtime-walk-support.test.mjs` 用结构断言**把死锚点钉住**
（`expect(runner).toMatch(/\[data-storyboard-card\]/)`），谁去修那条走查反而会被门岗拦下。

顺带一条量过的负结论：想把这条做成机器门岗（照 `dead-aria-label` 的样子扫 `[data-*="…"]`）——实测 `tests/ux`
下 45 个"src 里零命中"的 data 属性，绝大多数是第三方运行时属性（React Flow 的 `data-id`、Radix 的
`data-radix-popper-content-wrapper`）和官网（源码不在 `src/`）。**不先解决语料和白名单，这条规则就是噪音**，
噪音规则等于没规则。

**出处**：`tests/ux/scene3d-export-journey`（`[title="拖动播放头"]` 失效案例）；`tests/ux/agent-panel-system-prompt.walk.mjs` + `design-fidelity.e2e.mjs`（2026-09-05 `生成区 AI 助手` 案例）；`tests/ux/agent-runtime-production.walk.mjs`（2026-09-05 `data-storyboard-card` 案例）；断言层 `tests/ux/_assert.mjs`。

**相关**：[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)、[assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md)、[gates-green-does-not-mean-walkthrough-ran](gates-green-does-not-mean-walkthrough-ran.md)
