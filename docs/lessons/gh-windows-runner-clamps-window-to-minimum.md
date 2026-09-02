# GitHub Windows runner 把窗口夹到下限

> 📎 教训 · 首次记录 2026-08-26 · 状态：现行
> **触发场景**：一个布局类走查「只有 Windows 红」、Linux 和 mac 都绿；或你正准备把它归因为平台差异 / 加一个 Windows-only 的 workaround。

**结论**：GH `windows-latest` runner 的显示尺寸把窗口夹死在 `minWidth/minHeight`，**win32 走查恒定在「最小窗口」布局下跑**。「只有 Windows 红」的头号原因不是平台，是**窗口窄**——mac/Linux 把窗口缩到下限一样复现。

## 机制

走查 harness（`evals/lib/journeyRunner.mjs` 的 `resizeForEvidence`）对所有平台都 `setBounds({ width: 1680, height: 1050 })`，但 GH `windows-latest` runner 夹住了它：

- 2026-08-26 实测 win32 上 `stage {top: 88, right: 1100, bottom: 719, left: 60}`，反推窗口内容 ≈ **1100×720** —— 恰好是 `electron/main.ts` 里 BrowserWindow 的 `minWidth`/`minHeight`；
- Linux 的 `xvfb-run -a` 则给足 **1680×1050**。

后果：**win32 恒定在最小窗口布局下跑，Linux 恒定在宽松布局下跑。** 任何「垂直/水平空间紧才犯」的布局 bug 都会表现成「只有 Windows 红」。

## 排查「Windows-only 布局失败」的顺序

1. 先看走查证据里的 **stage 矩形**，反推窗口尺寸；贴着 1100×720 就按「最小窗口」问题查，**别先怀疑平台差异**。
2. 在 mac/Linux 上把窗口缩到 1100×720 复现——比等 20 分钟 2x 计费的 Windows runner 快得多。
3. 平台差异只是**叠加项**：win32 `frame: false` + 自绘 windowbar（`WorkbenchShell.tsx`，`h-8` = 32px，mac/Linux 走原生 chrome 不渲染）会让同样 720 的内容高只剩 631 的 stage，再挤掉 32px。

## 推论

把复现条件（窄窗口）**直接做进走查断言**，比补一个 Windows job 更根治——这样 Linux CI 就能拦住整类问题。已按此加了 j5 的 `composer-usable-at-min-window` 里程碑；注意它在 win32 CI 上是**退化的**（那台机器本来就在下限），**覆盖价值在 Linux/mac**。

**出处**：`evals/lib/journeyRunner.mjs`（`resizeForEvidence`）、`electron/main.ts`（BrowserWindow `minWidth`/`minHeight`）、`src/.../WorkbenchShell.tsx`。

**相关**：[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[gates-green-does-not-mean-walkthrough-ran](gates-green-does-not-mean-walkthrough-ran.md)、[harness-catch-launders-bugs-into-verdicts](harness-catch-launders-bugs-into-verdicts.md)
