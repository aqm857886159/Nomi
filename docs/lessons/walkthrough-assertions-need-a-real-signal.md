# 走查断言必须有真信号：用 `tests/ux/_assert.mjs`，别手写 `.count()`

> 📎 教训 · 首次记录 2026-08-18 · 状态：✅ 已固化（`pnpm run check:walkthroughs` 棘轮门岗接管，基线在 `scripts/walkthrough-baseline.json`）
> **触发场景**：要写或改 `tests/ux/**` 下任何走查；或看到走查里出现 `await el.count()` 比较、`if (await el.count()) el.click().catch(() => {})`、固定 `sleep` 等待、`document.body.innerText` 快照。

**结论**：走查断言一律从 `tests/ux/_assert.mjs` 取，不要再手写 `.count()` 比较或 `.catch(() => {})` 兜底。这不是风格偏好——手写路径会**结构性地**产出假绿。

## 断言层提供什么（2026-08-18 建）

- `expectAbsent(locator, { provenBy })` —— 断言「不存在」**必须**先 `proveProbe()` 拿基线，签名上卡死，随手编个对象也不认。
- `clickOrFail(locator, label)` —— **所有点击走它**。别再写 `if (await el.count()) el.click().catch(() => {})`：`count()>0` 只证 DOM 里有、不证点得着，`.catch` 又把真实失败咽掉，于是**定位器过期 = 静默跳过这一步**，脚本照常往下截图报绿。
- `waitForTurnIdle(win)` —— 「模型说完了」的唯一判定（停止键出现 → 消失）。
- `scopedText(locator)` —— 别读 `document.body.innerText`。
- `stripCommentsAndStrings()` —— 结构测试扫源码前先剥注释。

## 为什么会踩

全量扫过 143 个走查后确认这是**框架缺陷不是个人手滑**：

- `eslint.config.js:28` 把 `tests/ux/**` 整个 ignore——所有门岗都看不见这片地；
- 0/143 使用 Playwright 的自动重试断言。

于是形成必然链条：一次性 `.count()` 有竞态 → 拿 `sleep` 去糊 → sleep 不够长读到 0 → **而 0 恰好让「不存在」断言通过**。假绿是这套写法的产物，不是意外。

官方 `toBeHidden()` 只治竞态那一半；治不了「这个现场根本不可能出现坏东西」，那只能靠签名逼。

## 怎么用

- 任何「期望看不到 X」，先问：**这个现场真的可能出现 X 吗？** 不能证明就先换现场。已抓到的真例：在已有分镜方案的项目里验「不浮拆镜头卡」、seed 的正文 43 字而阈值是 60 字。
- 等待条件绑真状态源（按钮态 / `data-*` / store），不绑文本快照或固定 sleep。
- 断言写成环境无关的不变量（如「任意两行的模型+厂商组合不重复」），别钉死行数——本机自带数据会和 seed 叠加。
- 走真模型必须有对照组：同一输入在改动前后各跑一次。
- **分段走查每段先断言「我到了这儿」再截图**，并在收尾查「各段截图两两不同」——字节相同的两张 = 中间那步没发生。`dark-journey` 就是这么被抓出来的：三张 102303 字节的同款空库页，一路报绿。**截图是产出，不是判据。**
- **走查要开项目就自己种**（`tests/ux/fixtures/journey-project-fixture.mjs`），别指望隔离 profile 里有东西——空库里没有卡片可点，修多少遍定位器都点不出来。
- **新加门岗必须做负向验证**：故意写一处违规，确认它报红。本轮门岗第一版就漏报（规则只看同一行，而真实写法跨行），是负向测试抓出来的。**没有负向验证的门岗 = 下一个假绿。**

**出处**：调查数据与门岗设计见 `docs/plan/2026-08-18-walkthrough-harness-hardening.md`；门岗实现 `scripts/check-walkthroughs.mjs`（`RULES` 数组），断言层 `tests/ux/_assert.mjs`。

**相关**：[expect-absent-passes-too-early](expect-absent-passes-too-early.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[gates-green-does-not-mean-walkthrough-ran](gates-green-does-not-mean-walkthrough-ran.md)
