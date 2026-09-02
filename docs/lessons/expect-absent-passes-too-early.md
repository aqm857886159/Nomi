# `expectAbsent` 会通过得太早：它证的是「此刻没有」，不是「始终没出现」

> 📎 教训 · 首次记录 2026-08-26 · 状态：✅ 已固化（`expectAbsent` 已加 800ms 保持窗口 `holdAbsent`；截图统一走 `screenshotSettled`，见 `tests/ux/_assert.mjs`）
> **触发场景**：一条「不存在 / 已清干净」的走查断言报绿，但你没亲眼看过裁剪放大的截图；或截图里飘着半透明的「取消 / 确认」按钮；或翻主题、toast 之类带动画的元素刚变化就截图。

**结论**：`toHaveCount(0)` 的期望值就是 0，现场此刻恰好也是 0 → **第一次采样就通过**，timeout 一秒都用不上。异步 200ms 后才挂上来的东西一路绿。断言「不存在」必须**持续成立一个窗口**才算数；取证前必须等动画落地。

## 洞在哪

`tests/ux/_assert.mjs` 的 `expectAbsent` 旧实现最后一步是：

```js
await expect(locator, …).toHaveCount(0, { timeout })
```

Playwright 的 web-first 断言是**重试到条件成立**。期望值就是 0，而当下计数本来就是 0 —— 第一次采样就通过。所以它证明的是「**此刻**不存在」，不是「**始终**没出现」。

`provenBy` / `proveProbe` 那道闸挡的是**探针瞎了**（在不可能出现的现场断言没有坏东西），**挡不住采样太早**。两种假绿长得一模一样，别以为有基线就安全了。当晚本仓 51 处调用点全在这个洞上。

## 为什么确认弹窗特别容易踩

`src/design/confirmDialog.tsx:70` 的 `ConfirmDialogHost` 是**一个常驻 Mantine Modal**，靠 `opened={Boolean(active)}` 开关，**不是每个弹窗一棵树**。于是关闭时 `active→null`：

- `data-confirm-dialog-surface` 这类属性**瞬间消失** → 断言立刻绿；
- 但 Modal 的**退场动画还在画**，`div.mantine-Modal-inner` 仍然 `opacity:1 / visible`，铺满 `[0,0,1440,846]`；
- 且此时按钮文案**回落到默认值** `runtime.design.cancel/confirm` = 「取消」「确认」。

最后这条是识别特征：截图里飘着一对**「取消 / 确认」**幽灵按钮 + 一个 ×，而真卡的按钮是「取消 / **生成**」——**文案对不上就说明那是退场中的另一张卡**，不是你要验的这张。

## 怎么用

- **判**：截图缩略图看不见幽灵（半透明 + 缩到 720px 就没了）。**必须裁剪放大**再看：
  `im.crop(box).resize((w*4, h*4), Image.LANCZOS)` —— 当晚就是靠这一步抓到执行体连报两轮「已清干净」其实没清。
- **别用**「`div.fixed.inset-0` 消失了」当判据：`mantine-Modal-inner` 既不是 `inset-0` 也不透明，这道门**结构上就看不见它**，白绿两轮。
- **修的方向是「构造上不可能」而不是「等久一点」**：截图 / 断言前先等 `.mantine-Modal-inner, .mantine-Modal-overlay` **从 DOM 里彻底消失**，让两张卡根本不共存；再加一道「卡外仍可见的 fixed/absolute 节点」兜底扫描。

## 同一族的其他两次（都是「动画没落地就截图」）

- **翻主题**：只写 `data-mantine-color-scheme` 一个属性不够——生产走 `src/theme/colorScheme.ts:54` 的 `applyNomiColorScheme`，**一共写 4 个属性**；且要等 `--nomi-transition-fast`（约 140ms）。少等就拍到按钮标签糊成灰块。
- **toast 滑入**：同一条走查同一条命令，一轮拍到 toast 被视口右缘**切掉一半**，另一轮拍到完整的——**同码同命令、证据不同**，说明截图证据本身是非确定的。

这三次不是三个 bug，是一个：**动画未落地就取证**。

## 已固化成什么

`tests/ux/_assert.mjs` 现在：

- `expectAbsent` 改成两段式——第一段仍用重试断言等降到 0（真的一直在就照常耗到 timeout 报红，快速失败语义没变），第二段 `holdAbsent` 以 `ABSENCE_SAMPLE_MS = 50` 的间隔连采 `ABSENCE_HOLD_MS = 800`，其间冒出来一次就报红。800ms 是按「React 提交 + 一帧动画 + Mantine 弹层挂载」实测定的（鬼影出现在关卡后约 350ms）。**别把窗口调小来让它变绿**——报红的是被测物晚到了，不是尺子太严。
- `screenshotSettled(target)` 统一了「截图前等视觉安定」，Page 和 Locator 都收；**失败路径的 `*-FAIL.png` 不要用它**，那时 app 可能已卡住，等安定只会把现场盖掉。
- `applyColorSchemeForShot(win, scheme)` 按生产路径翻齐 4 个属性再等安定。

**出处**：`docs/plan/2026-08-26-walkthrough-framework-repair.md`；实现见 `tests/ux/_assert.mjs`（`ABSENCE_HOLD_MS` / `holdAbsent` / `screenshotSettled` / `applyColorSchemeForShot`）。

**相关**：[gates-green-does-not-mean-walkthrough-ran](gates-green-does-not-mean-walkthrough-ran.md)、[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[walkthrough-computed-color-asserts](walkthrough-computed-color-asserts.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)
