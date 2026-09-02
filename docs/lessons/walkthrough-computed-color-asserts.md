# 断言计算色：别比字面串、翻主题先等 transition

> 📎 教训 · 首次记录 2026-08-24 · 状态：✅ 已固化（`tests/ux/_assert.mjs` 已提供 `readComputedColorChannels` 解析数值通道、`applyColorSchemeForShot` 翻齐 4 个属性并等安定）
> **触发场景**：走查里出现 `getComputedStyle(...).backgroundColor === 'rgb(255, 255, 255)'` 这类字面比较；或一条颜色断言反复报红而 app 看起来完全正常；或翻暗色后立刻读色 / 截图。

**结论**：颜色断言不要比字面串——Chromium 会回 `oklch(...)`；也不要在 transition 跑着的时候读——会拿到插值帧。要么断解析后的数值通道，要么语义断。

## 两个坑（2026-08-24 token 作用域走查连踩，同一条断言红了两次，app 都是对的）

1. **别拿字面 rgb 串比**：Chromium 对 oklch 定义的颜色，`getComputedStyle().backgroundColor` 直接回 `oklch(1 0 0)`，不是 `rgb(255, 255, 255)`。

2. **transition 抢读**：翻暗色后立刻读，`transition-colors`（Nomi `--nomi-transition-fast` = 140ms）正在插值，读到 `oklab(1 0 0)` 中间帧——它和浅色值**字符串不等**，`!==` 断言会侥幸假绿。翻主题后先等（约 400ms）再读色 / 截图。

## 怎么用

颜色断言二选一：

- 断**自定义属性的解析值**（`getPropertyValue('--x')` 回规范串，不过 transition，**最稳**）；
- 或**语义断**：枚举白的合法序列化 `oklch(1 0 0) | oklab(1 0 0) | rgb(255, 255, 255) | color(srgb 1 1 1)`，或断「非 transparent 且不在白集合」。

**别断唯一字面。**

现在直接用 `tests/ux/_assert.mjs` 的：

- `readComputedColorChannels(locator, property)` —— 读回 `{ raw, channels }`，比数值不比串；
- `applyColorSchemeForShot(win, scheme)` —— 按生产路径（`src/theme/colorScheme.ts:54` 的 `applyNomiColorScheme`）翻齐 4 个属性，翻完自动等 `waitForVisualQuiescence`。手写 `setAttribute('data-mantine-color-scheme', x)` 只翻了 4 个里的 1 个 = 半翻的主题，拍出来的「暗色证据」不是用户会看到的那一屏。

**出处**：样例走查 `tests/ux/workbench-token-root-scope.walk.mjs`；helper 见 `tests/ux/_assert.mjs`；生产翻主题路径 `src/theme/colorScheme.ts:54`。

**相关**：[expect-absent-passes-too-early](expect-absent-passes-too-early.md)（同属「动画未落地就取证」一族）、[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)
