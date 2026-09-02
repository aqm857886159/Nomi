# gates 全绿 ≠ 走查真的跑过

> 📎 教训 · 首次记录 2026-08-26 · 状态：现行
> **触发场景**：有人拿「`pnpm run gates` 绿」当作走查跑通的证据；或交付里附了 `tests/ux/shots/` 的截图但没给字面退出码；或某条走查腿是「为了回归某 bug 新加的」。

**结论**：`check:walkthroughs` 只做**静态**扫描，从不启动 Electron。gates 全绿完全不能推出「走查跑通了」。**新加的走查腿必须亲自跑到 exit=0 才算交付**，报告里要有字面退出码。

## 机制

`check:walkthroughs` = `scripts/check-walkthroughs.mjs`，只做静态扫描（注册了没、断言形状对不对），**从不启动 Electron 跑那条走查**。走查是独立脚本，要单独 `node tests/ux/<name>.walk.mjs` 才真跑。

2026-08-26 实锤：一个 `pnpm run gates` exit=0 的 PR，走查手跑一遍 **exit=1**。

**放大这个洞的第二层**：`tests/ux/shots/` 里的旧截图**不会被自动清掉**。改完代码没重跑走查，盘里躺着的还是上一轮的 PNG，看起来「证据齐全」。当晚那三张的 mtime 比修复 commit **早 65 分钟**——不比时间戳根本看不出来。

## 判定法（便宜且决定性）

```bash
ls -la tests/ux/shots/<name>/     # 截图 mtime
git log -1 --format=%ci <fix-sha> # 修复时间
```

截图早于修复 = 这些截图证明的是**修复前**的状态，读了等于没读。

跑之前先 `rm -f tests/ux/shots/<name>/*.png`，跑完确认时间戳比 commit 新。

## 当晚的具体案例

为了回归「拖拽绕过采纳桥」这个 bug 专门加了一条拖拽腿，报告说加好了、gates 绿。实际那条腿**从没执行到过**——选择器就是错的：

- `tests/ux/adoption-bridge.walk.mjs` 用 `.filter({ hasText: '采纳桥镜头 2' })` 按**文本内容**找；
- 而 `src/workbench/preview/PreviewSourcePanel.tsx:77` 的 draggable 元素名字只在 **`aria-label` / `title`** 上（`t('previewSource.shots.itemHint')`），没有文本节点，永远匹配不到。

同一文件里过得去的腿 1 用的是 `getByRole('button', { name: /…/ })`（可及名）——**一份文件里两种选法，只有一种成立**。即「读源码猜选择器会错」的又一次复发。

## 推论（更狠的一条）

一条为了抓某 bug 而新加的走查腿，如果从没真跑过，它**既没抓到 bug、又让人以为抓到了**——比不加更糟。所以：新加走查腿必须亲自跑到 exit=0 才算交付，不接受「gates 绿」代替。

**出处**：`scripts/check-walkthroughs.mjs`、`tests/ux/adoption-bridge.walk.mjs`、`src/workbench/preview/PreviewSourcePanel.tsx:77`。

**相关**：[piped-test-runs-mask-exit-codes](piped-test-runs-mask-exit-codes.md)（退出码那一族）、[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)
