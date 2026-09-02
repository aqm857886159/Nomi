# 查重别按报错串 grep——不抛的那份正好隐身，而它才是真 bug

> 📎 教训 · 首次记录 2026-08-25 · 状态：现行
> **触发场景**：要收编某个 helper 的所有私造副本、准备加棘轮禁止再私造；或者两次不同方式的搜索给出的数量对不上。

**结论**：找某个 helper 的全部副本时，**别用它抛的错误串当 grep 锚点**。抛错串只命中「行为正常的副本」；退化到不抛 / 不报的那份反而搜不到，而那份通常才是真 bug。要按**签名 / 结构**搜：`grep "function <name>"` 或 `grep "const <name> ="`。

**为什么会踩**：2026-08-25 收编 `waitFor` 时踩到。按 `throw new Error('waitFor timed out')` grep 得到 10 处，实际有 11 份——第 11 份在 `electron/productionRun/productionRunDriver.test.ts`，循环等完直接返回、**没有那行 throw**，所以超时静默放行、8 个等待全是摆设。它正因为「少了那一行」而躲过了 grep：**你搜的那个特征，恰好是坏掉的那份缺少的东西。**

**怎么用**：

- 按签名 / 结构搜，再逐个比对实现差异（谁少了 `throw`、谁少了 deadline）。
- 两次搜索数量对不上，**差额就是线索**，别当 grep 噪音随手抹平。
- 收完加一条棘轮断言禁止再私造，并给棘轮做**阳性对照**确认它真会红（同类做法见 [走查断言必须有真信号](walkthrough-assertions-need-a-real-signal.md)）。
- 顺带一条：说「基线是 97」「常量 X 在 Y 文件里」这类前提，动手前先实测一遍——这次 lint 基线其实已是 98、被引用的常量压根不存在。

**出处**：2026-08-25 `waitFor` 收编。相关：[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)、[grep 静默跳过含 NUL 字节的文件](grep-silently-skips-files-with-nul-bytes.md)。
