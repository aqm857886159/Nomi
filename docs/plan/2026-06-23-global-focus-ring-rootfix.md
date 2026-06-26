# 全局焦点环根治（杀 macOS 系统橙 focus 环）

日期：2026-06-23
状态：已交付（五门全绿 + 真机样式实测）
负责：本会话

## 交付验证
真机 eval 样式实测（隔离实例）：`--nomi-focus`=`color-mix(in srgb,oklch(0.55 0.13 250) 42%,transparent)` 全局解析；`:focus-visible{outline:none}` 已进 CSS（全局杀系统橙）；`button:focus-visible…{outline:2px solid var(--nomi-focus);outline-offset:2px}` 已进。截图：点过的标签干净无橙环。删干净 `--workbench-focus` 死 token（tailwind.config 两处 + workbench.css 一处）+ 13 处散落 className。dangling-token 门通过（无悬空引用）。

## 1. 问题（根因）
浏览器 `:focus-visible` 默认 `outline:auto`，在 macOS 上**跟系统强调色**——用户把系统强调色设成橙/黄，所有未显式处理焦点的控件聚焦时就冒橙环。现状只零散治了：编辑器（workbench.css 的 `outline:none`）+ 13 处组件 className（`focus-visible:outline-2 outline-workbench-focus outline-offset-2`，散在 6 文件）。**漏一个就冒橙环 = 这正是问题本身**（症状层）。

## 2. 根治（P2：一条全局规则，没人需要记着加）
- **全局 token**：tailwind.config.ts 的 `addBase :root` 加 `--nomi-focus`（accent 42%，与现 `--workbench-focus` 同观感，用户已在技能库认过）。放这里=和其它 `--nomi-*` token 同源、全局 `:root`、portal 到 body 也生效（`--workbench-focus` 是 `.workbench-shell` scoped，portal 面板里失效，本就是隐患）。
- **全局 base 规则**：同 `addBase` 加 `:focus-visible{outline:none}`（全局杀系统橙）+ 交互元素（button/[role=button]/a/input/select/textarea/summary）`:focus-visible` 给 `2px solid var(--nomi-focus)` + offset 2px。
- 放 `addBase` 而非 `src/styles/`：尊重 R10「src/styles/ 只减不增」；config 驱动=单一真相源。

## 3. P1 删旧（加新必删旧，同 commit）
- 删 6 文件里 13 处 `outline-workbench-focus` className（含我刚加的 2 个 skillLibrary FOCUS_RING 常量）：CanvasAssistantPanel/SkillCard/WorkbenchEditor/SkillLibraryPanel/SelectionGeneratePopover/CreationAiPanel。
- 删干净后 `--workbench-focus` token + `outline-workbench-focus` tailwind 映射成死码 → 一并删（先 grep 确认无其它消费者）。
- 编辑器 `.ProseMirror:focus-visible{outline:none}` 保留（防御性具体覆盖，非并行实现；全局 `:focus-visible{outline:none}` 也覆盖它，编辑器非 button 不吃 ring）。

## 4. 文件
改：`tailwind.config.ts`（+token +base规则，-死token -死映射）、`src/workbench/workbench.css`（-死 --workbench-focus def）、6 个组件文件（-13 className）、`docs/design/nomi-design-system.md`（+§焦点约定）。

## 5. 验收（P3）
五门全绿 + 真机走查：AppBar 按钮 / 技能库 / 创作区面板键盘聚焦都显 accent 环、无橙环；编辑器聚焦仍无框；项目库页（workbench-shell 外）按钮也 accent 环（验全局生效）。截图人眼判断。

## 6. 回滚
全部集中在 config base 规则 + className 删除，回滚=恢复 13 className + 撤 config 两段。
