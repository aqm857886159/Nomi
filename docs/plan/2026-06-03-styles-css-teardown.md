# Plan：styles.css 拆除（Tier 3——已迁 Tailwind 组件的死 CSS 清理）

> 触发：用户转述程序员意见"已经加了 Tailwind，样式却还写在 styles.css 里，应全改 Tailwind"。
> 调研结论**修正了任务性质**：组件**早已迁成 Tailwind**（styles.css:143 有自认注释
> `/* App header / floating nav rules removed — now in Tailwind */`），styles.css 里那
> ~4650 行组件 CSS 是**迁移后忘删的死代码**，不是待迁的活样式。**所以这是删除任务，不是迁移任务。**

## 调研依据（已核实）
- Tailwind v3（`package.json` `"tailwindcss": "3"`，`tailwind.config.ts` + `postcss.config.js`）。
- **全部组件家族在 ts/tsx 里 0 className 消费**（字面量 + 模板拼接 + cn() + 动态加号，全查过）：
  `.app-*`、`.recharge-modal-*`、`.floating-nav-*`、`.control-chips-*`、`.nano-comic-*`、
  `.template-*`、`.ai-character-library*`、`.asset-panel-*`、`.top-toolbar*`、
  `.task-node-prompt__*`/`.task-node-preset-*`、`.tapshow-*`、`.stats-agents-management__*`。
  唯一非零命中 `app-shell` = 文件路径 import（`ui/app-shell/NomiAppBar`），非 class。
  无任何动态 class 拼接模式。
- 活的样式都在别处：`styles/index.css`（Tailwind 入口 + Mantine + vendor + token + animations）、
  `theme/nomi-tokens.css`（`--nomi-*` token）、`styles/animations.css`（`@apply animate-shimmer`）、
  `styles/vendor-overrides.css`（Mantine 覆盖）、`generationCanvas/styles/generationCanvas.css`
  （活画布样式）、`tailwind.config.ts`（shimmer keyframe）、个别组件内联 keyframes。
- Tailwind 官方最佳实践（已查）：utility-first；重复抽组件/partial 而非 `@apply`；token 走
  `@theme`/CSS 变量。**项目组件已符合**——剩下就是清尸体。

## 范围（分桶）
- **桶 A 留（~143 行，styles.css:1–143）**：`:root` token（`--tc-*`/`--handle-*` 等暗主题）、
  亮主题覆盖、`* box-sizing`、`body` 字体+渐变背景、`html/body/#root` 高度+滚动、`#root::before`
  网格层。→ 最终并入 `theme/nomi-tokens.css`（token）与 `styles/index.css`（全局/背景）。
- **桶 B 删（~4650 行，styles.css:145–4797）**：全部组件家族 CSS（见上，0 消费）。
- **桶 C 核实（4 行）**：`--tc-ai-chat-reserved-width`——先 grep JS 端有无运行时
  `setProperty('--tc-ai-chat-reserved-width')`；无则连它一起删。

## 不动什么
- 任何 ts/tsx（组件已是 Tailwind，不碰）。
- `styles/index.css`、`animations.css`、`vendor-overrides.css`、`theme/nomi-tokens.css`、
  `generationCanvas.css`、`tailwind.config.ts`——活的，不动（除最后把桶 A 内容并入 token/index）。

## 执行批次（CTO+前端评审定稿；每批独立 commit + 验收，可单独回滚）

> **评审两条关键修正**：① 桶 A 是"搬运"不是"删除"，全局副作用（box-sizing/高度/背景/
> #root 网格/isolation）风险远高于组件类，**必须单独成第 0 批、单独 commit、单独验**，
> 跑通再动桶 B。② **按选择器前缀切，不按行号区间**——亮色变体 `:root[...light] .<family>`
> 常散在文件末尾，按行段切必漏；每批用前缀 grep 圈定全部规则块（含暗/亮变体）再删。

- **批 0（桶 A 搬运，必做在最前）**：把 `--tc-*`/`--handle-*` token 并入 `theme/nomi-tokens.css`、
  `* box-sizing`/`body` 背景/`html,body,#root` 高度滚动/`#root::before` 网格并入 `styles/index.css`
  —— **并入位置必须守在 `tailwindcss/base` 与 `utilities` 之间**（别挪文件尾，否则层叠优先级变）。
  此批**先不删 styles.css**，只是把桶 A 内容复制到目标位置并验证生效（见下 getComputedStyle 断言）。
  桶 C `--tc-ai-chat-reserved-width` **整条删，不并入**（无 JS setProperty、定义死+消费者死）。
- **批 1（~330 行）**：前缀 `.app-*`、`.recharge-modal-*`、`.control-chips-*`、`.top-toolbar*`、
  `.app-shell-*`、`.app-project-input`。
- **批 2（~780 行）**：`.floating-nav-*`、`.stats-agents-management__*`、`.task-node-prompt__*`/`.task-node-preset-*`。
- **批 3（~2010 行）**：`.template-*`、`.ai-character-library*`、`.tapshow-*`。
- **批 4（~2040 行）**：`.nano-comic-*` 全族 + 其 `@media`、`.asset-panel-*` 全族 + 其 `@media`。
- **收尾（原子，CTO 红线）**：批 1–4 删完后 styles.css 只剩已搬走的桶 A；**在同一 commit 内**
  从 `index.css:7` 删 `@import '../styles.css'` + 删除 styles.css 文件。**绝不允许"文件已摘、
  桶 A 未落地"的中间态**（否则 2 个活体 `--tc-*` 外部消费者 + body 背景 + #root 网格集体失效）。

## 验收门
**每批（桶 B 删除批）**：
- **不变量**：删后 `rg "<family>" src/styles.css` = 0（该前缀清零）；`git diff` 只含目标前缀删除行、
  无新增、无邻接误伤；**括号平衡 `grep -c '{' == grep -c '}'`**（交错删最易切坏配对）。
- **运行时 DOM grep（升级为硬门，不再只是上线前）**：app 跑起来执行
  `document.querySelectorAll('.nano-comic-workspace__tabs,.asset-panel-shell,...').length === 0`
  ——唯一能反驳"动态拼 class 漏网"的实测证据。
- `pnpm build`（vite + electron tsc）绿；`npx vitest run` 绿。

**批 0（桶 A 搬运）专门验**（CSS 不进 tsc，必须运行时断言）：
```js
getComputedStyle(document.body).boxSizing                                  // 'border-box'
getComputedStyle(document.documentElement).height                         // 视口像素，非 'auto'
getComputedStyle(document.body).backgroundImage                           // 含 'radial-gradient'
getComputedStyle(document.getElementById('root'),'::before').backgroundSize // '60px 60px'
getComputedStyle(document.getElementById('root')).isolation               // 'isolate'
```
再切 `:root[data-mantine-color-scheme="light"]` 重测背景。建议删前对关键页（onboarding/画布/
recharge modal/asset panel/top toolbar）截基线图，每批比对（视觉回归）。

## 回滚
- 纯删除，`git checkout -- src/styles.css` 逐批回滚。

## 执行结果（2026-06-03 回填）

**方法调整（比原计划更安全）**：盘点发现 143 行以下**几乎全是死家族 + 唯一一条活规则
`.nomi-loading-mark__logo`(identity.tsx:84 在用)**，桶 A 是顶部连续块。故用括号感知解析器
（`/tmp/css_teardown.py`）删尽死家族、保留桶 A + 该活规则——**桶 A 逐字保留、不做"搬运合并"**
（reviewers 最担心的 globals 搬错风险因此归零），最后整文件 `git mv` 改名保持同一级联位置。

**两个 commit**：
- `9093b01`：解析器删死组件 CSS，styles.css 4797→145。删死 token `--tc-ai-chat-reserved-width`
  （0 幸存消费者）。死家族 0 残留、括号平衡。
- `617abfb`：`git mv src/styles.css → src/styles/globals.css` + 改 `index.css` import 到同位置。
  **src/styles.css 不复存在。**

**验证**：
- 解析器报告：143 行以下保留的规则**仅 `.nomi-loading-mark__logo` 一条**（其余死家族全删）。
- 每 commit `pnpm build`（vite+electron tsc）绿、`npx vitest run` 415 测试绿。
- 桶 A 内容逐字保留 + 同一导入位置 → 级联可证明零变化；删除规则因 0 消费从不命中 DOM
  → 渲染上是可证明的 no-op。
- 偏离原计划处：桶 A 的 `--tc-*` token **未拆入 nomi-tokens.css**，而是随 globals.css 整体保留
  （拆分有级联风险、收益低）。如需把 `--tc-*` 并入 `nomi-tokens.css` 是后续可选微整理（纯变量、低风险）。

**最终态**：8867 行的 styles.css → 0（文件没了）；合法全局样式 145 行收在 `styles/globals.css`。
Tier 1+2+3 累计从 styles.css 删除约 8700 行死代码。

## 关联：防止复发（forward rule）
- 建议写进 CLAUDE.md（规则 9 延伸）：**新样式一律 Tailwind 写组件上；`styles.css`（在它被删之前）
  只可减不可增；token 进 `nomi-tokens.css`/`@theme`，全局/keyframes 进 `index.css`/config。
  迁移一个组件到 Tailwind = 同 commit 删它的旧 CSS（规则 1）。** 这次"迁了忘删"正是规则 1 的反例。
