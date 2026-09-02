# 修过期走查先打探针，别读源码猜选择器

> 📎 教训 · 首次记录 2026-08-18 · 状态：现行
> **触发场景**：`tests/ux/**` 里某条走查跑不动、断言永远等不到；或你正准备靠读源码（或让子 agent 汇总）来推断选择器该写什么。

**结论**：先写一次性探针脚本把**真实 DOM** 打出来（起隔离 app → 走到那一屏 → `evaluate` dump aria-label / role / class 列表），再动断言。用完删掉探针文件。

## 为什么会踩

读源码 + 让 subagent 汇总选择器会给出**似是而非**的结果——2026-08-18 修 `archetype-modebar` 时，汇总说的「参数面板是 Popover / 比例是 select」全错，探针一跑就现原形。

更要命的是：这类走查过期的往往**不只是选择器，断言的前提也过期了**（Seedance 从 3 模式变 4 模式且默认模式改了、「Fast」从独立模型变成变体）。选择器改对了断言照样永远等不到，只有看真实 DOM 才发现得了。

## 怎么用

- 探针跑通后再写断言；写完做**可证伪性验证**——故意变异 2-3 处（把期望值改错 / 断言一个确实存在的东西不存在），确认都报红退出 1，才算不是假绿。
- 用完删掉探针文件。

## 已验证可用的画布 composer 锚点（2026-08-18）

- 工具条加节点用 `.generation-canvas-v2-toolbar button[data-node-kind="video"]`（**结构锚点，不随 i18n 变**；aria-label「添加视频节点」会随语言变）。
- 模型 / 变体是 `NomiSelect`（Mantine Combobox）：点 `[aria-label="模型"]` / `[aria-label="变体"]` 触发，再从 **`[role="option"]:visible`** 挑（`:visible` 不能省）。
- 模式条 `[role="group"][aria-label="生成方式"] button`，选中态看 `aria-pressed="true"`。
- 参数面板 portal 到 body：`[role="group"][aria-label="生成参数面板"]`；标量参数是 `[role="radiogroup"][aria-label="清晰度"]`，**不是 `<select>`**。

## 三个踩过的坑

1. **素材选择器里有两个 `input[type=file]`**，只有 `[aria-label="上传本地文件"]` 那个管用；用 `.first()` 会选到没 label 的那个，**静默什么都不发生**。
2. ~~打 `@` 前必须有空格~~ —— **这条是真 bug，2026-08-18 已修**（`allowedPrefixes: null`，PR #101）：上游 tiptap 默认 `[' ']` 在中文里等于把功能关掉（中文不打空格，连逗号后都不弹）。现在任何位置打 `@` 都弹。面板锚点 `[data-mention-list="true"] [data-mention-item]`；另外**点参考 tile 本身也会插 chip**，那才是可发现的主路径。
3. **新建 worktree 没有 `node_modules`**，`pnpm run build` 会失败并提示 `node_modules missing`，先 `pnpm install`（warm store 下约 5 秒）。**别想着 symlink 主仓的**：主仓 `node_modules` 里的包全是指向某个 sibling worktree 的 `node_modules/.pnpm/...` 的相对软链，而那个 worktree 早删了——整条链是断的（`readlink -f node_modules/vitest` 解不出来），主仓自己也跑不了 vitest。2026-08-18 在这上面绕了一圈。

**出处**：`tests/ux/archetype-modebar.walk.mjs` 修复过程；PR #101（tiptap `allowedPrefixes`）。

**相关**：[walkthrough-assertions-need-a-real-signal](walkthrough-assertions-need-a-real-signal.md)、[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[gates-green-does-not-mean-walkthrough-ran](gates-green-does-not-mean-walkthrough-ran.md)
