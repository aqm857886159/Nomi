# 设计卡：⌘J / 点开小球后光标进 Agent 输入框——聚焦只经输入框的主人

改动名：Agent 输入框的聚焦改由主人提供 + 「按输入框的实现找它再聚焦」门岗
线/负责人：I-agent-composer-focus（Mac，Claude）· 分支 `fix/agent-composer-focus`
类别：[其他]（路径推出「新界面」：改了 `src/design/searchInput.tsx`，只给搜索框加 ref 转发，样子与元素不变）
来源：独立验收 L-acc-opus-20261023 验 #1299 时顺带发现；main `ea724ce51` 上同样存在
复盘：[docs/engineering/direction-checks/2026-10-27-focus-by-tag-lookup.md](../engineering/direction-checks/2026-10-27-focus-by-tag-lookup.md)
根因合同：[docs/fixes/2026-10-27-agent-composer-focus.root-cause.json](../fixes/2026-10-27-agent-composer-focus.root-cause.json)

### 功能分类
- [x] 新界面 / 改交互（路径推出：改了 `src/**/*.tsx` 与 `src/design/`；不增删元素、不改布局和文案，拍板图例外 `pure-bugfix`）
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为（路径推出：`src/workbench/ai/`；只改输入框怎么拿到焦点，不改 Agent 的意图、工具、提示词）
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能（路径推出；不新增交互，见 ★7）

## 0. 现场（在 origin/main `ea724ce51` 上核实）

- `src/ui/app-shell/shell/ShellAgentHost.tsx` 的 `focusComposerSoon` 用 `document.querySelector('#project-agent-resident textarea')` 找输入框，20 帧找不到就什么也不做。五处调用：Mod+J、点小球、小球右键「浮窗」「停靠」、面板头部「小球 · 浮窗 · 停靠」三选一。
- `ed086ea3e`（10-12）把 Agent 输入框换成共享 `PromptEditor`（TipTap，`contenteditable`）。`inputRef` 的类型从 `HTMLTextAreaElement` 改成了 `HTMLElement`，带类型的调用者都跟着改了；字符串选择器类型系统看不见，五扇门同时静默失效。
- `tests/ux/shell-redesign.walk.mjs` check-shortcuts 按 `activeElement.tagName === 'TEXTAREA'` 判，从那天起每晚红；夜跑整体红 117 / 329（issue #1121），这一条淹在里面。
- 全仓「按输入框的实现找它再聚焦」普查（AST，src 1638 个文件）：4 处按标签名（上面这处、素材库找参考的关键词框、设置页深链、自定义模型能力表单），2 处按 `[contenteditable]`（分镜表、分镜行，两文件都是方向检查热点）。

## ★1 用户怎么用

当创作者在项目里想跟 Agent 说一句话时，我想按 ⌘J（或点右下角小球、切到浮窗 / 停靠）就能直接打字，以便不用再去点一下输入框。

1. 画布 / 创作 / 分镜 / 预览任一页，Agent 收成小球。
2. 按 ⌘J（Windows / Linux：Ctrl+J）→ 面板按这一页的默认形态打开（生成页浮窗，其余停靠）。
3. 光标已经在输入框里（句末），直接打字，字落进 Agent 输入框。
4. 已经在输入框里打着字时再按 ⌘J：光标和已打的字都不动。
5. 点小球、小球右键「浮窗」「停靠」、面板头部三选一切到浮窗或停靠：同样光标进输入框。
6. 空态起手句（点一句）：句子填进框、光标在句末（原有行为，改走同一扇门）。

同一扇门顺带收的三处同类：素材库「找参考」点「改」「换个词」后光标回关键词框；设置页从别处跳到某一节时焦点落在那一节第一个能 Tab 到的控件；自定义模型能力表单保存失败时焦点落在第一个出错字段。

**不做**：不改快捷键与三形态本身；面板头部「⋯」菜单里的形态项本来不聚焦，照旧；分镜表 / 分镜行那两处 `[contenteditable]` 查找不动（两个文件都是 14 天第 3–4 个 fix 的热点，改要另做方向检查，先冻结在门岗名单里只减不增，见复盘 §6）。
**已知坑**：小球形态下面板挂在 `hidden` 容器里，按下那一帧聚焦必然落空，要等面板挪到可见处；等的这半秒里用户点了别处，不能事后抢回焦点。

真实任务（真 Electron 生产构建、隔离 profile，零花费）：① 画布页小球 → ⌘J → 直接打一句话；② 已在输入框里打了字再按 ⌘J；③ 点小球打开浮窗 → 直接打字。

指标（目标 → 信号 → 指标）：
- 主指标：从小球打开 Agent 的五扇入口里，打开后焦点在 Agent 输入框、打的字进了输入框的比例。基线 0/5（五扇门共用的 `focusComposerSoon` 全部落空）→ 目标 5/5。量具：`tests/ux/shell-redesign.walk.mjs`（check-shortcuts 量 ⌘J，canvas-agent 量点小球；zh / en 真跑）；另三扇（右键浮窗 / 停靠、头部三选一）与这两扇调同一个 `requestResidentComposerFocus`，真窗口逐扇的数：未验证：缺量具（走查只覆盖两扇）。
- 质量指标：打开后打的字全部落进输入框（不丢字、不落到画布）。量具：走查里打字后用 `composerText()` 读回原句。
- 护栏：已在输入框里时再按 ⌘J，文字与焦点不变（走查 + `src/workbench/ai/residentComposerFocus.test.tsx`）；src 里按输入框实现找它再聚焦的写法只减不增（`scripts/focus-by-tag-lookup.test.mjs` 普查：名单外 0 处）。

### ★1b 连带界面

- 素材库「找参考」：「改」「换个词」之后光标回关键词框（行为不变，换实现：`DesignSearchInput` 转发 ref）。
- 设置页深链（automation / ai-models / tikhub-connector 三节）：焦点从「这一节里第一个 `button, input, [tabindex]`」改成「这一节第一个 Tab 得到的控件」——跳过禁用、隐藏、`tabindex=-1`，认得 textarea / select / 富文本 / 链接。以前第一个是禁用钮时焦点等于没落下。
- 自定义模型能力表单（保存时校验失败）：焦点落在第一个出错字段里第一个 Tab 得到的控件（字段本身就是控件时就是它），同上。
- 没有新文案、没有新元素；Agent 回执、通知、任务列表不涉及。

## ★2 谁说了算

- 「把光标放进常驻 Agent 输入框」：唯一 owner 是输入框的主人 `ProjectAgentResidentShell`（手里有编辑器实例 `mentions.editorRef`）。请求入口 `requestResidentComposerFocus`、主人取用 `useResidentComposerFocusRequest`，都在 `src/workbench/ai/residentComposerFocus.ts`。请求方：`ShellAgentHost`（⌘J / 小球 / 右键 / 三选一）、`ProjectAgentResidentShell`（空态起手句，替掉原来的 token + effect）。同一份事实存 1 份（一个请求序号）；寿命 `project`（切项目清回 null，`declareStoreLifetime`）。
- 关键词框归 `DesignSearchInput`（它渲染那个 `<input>`，ref 转给它）；「一个区域里第一个能聚焦的控件」归 tabbable 库。
- 不靠「东西不见了 / 状态变了」猜意图：请求是显式调用。
- 门表：修前 `node scripts/door-map.mjs focusComposerSoon` → 1 扇（ShellAgentHost，5 处调用）；修后 `node scripts/door-map.mjs requestResidentComposerFocus useResidentComposerFocusRequest`（结果贴在根因合同 `doors`）。

## ★3 一致与复用

- 复用 `src/workbench/generationCanvas/nodes/nodePromptFocus.ts` 的形状：「请求留在一份小状态里，主人编辑器就绪时来取」。不改它、不合并：它的取用方 `NodeGenerationComposer.tsx` 是 14 天第 4 个 fix 的热点；两份请求各属自己的主人（画布某张卡的提示词 / 常驻 Agent 输入框），寿命与取用时机都不同。本卡多一条它没有的：聚焦要真落进编辑器才算（ProseMirror `view.hasFocus()`），否则下一帧再试，试满 30 帧丢掉并记一条日志。
- 设计系统给交互元素转发 ref 用 `forwardRef`（`src/design/actions.tsx` 五处）→ `DesignSearchInput` 同样转到 `<input>`。
- 「区域里第一个能 Tab 到的控件」= tabbable 6.5.0（已在依赖树里：@mantine/core → @floating-ui/react → tabbable 6.5.0），声明为直接依赖；不自写 tabbable 查询（`src/design/AnchoredPopover.tsx` 焦点管理同一条口径）。
- 门岗：ESLint 内置 `no-restricted-syntax` 以独立规则 id `focus-owner/*` 注册（同 `ui-money/*`、`playwright-wait/*` 的做法），不自写扫描器；走查侧扩 `check:walkthroughs` 已有的 `composer-input-read` 规则，不新开第二条。
- 走查读写输入框只经 `tests/ux/agent-runtime-walk-support.mjs`（`composerText` 旁边加 `expectComposerFocused`），不再手抄选择器。

## ★4 全状态

- 小球 → ⌘J：面板打开，光标在输入框句末。
- 停靠 / 浮窗已开、焦点在别处（画布、文稿）→ ⌘J：光标进输入框句末。
- 已在输入框里 → ⌘J：什么都不变。
- Agent 在跑：输入框照常能聚焦（占位「可继续输入，将排队发送」不变）。
- 有反问卡在等答案（输入框降一档）：照常聚焦，聚焦后框复原（原有逻辑）。
- 面板没挂出来（项目还在打开）：约半秒内聚焦不上就放弃，记 renderer 日志 `resident-composer-focus-expired`，之后不抢焦点；界面不提示。
- 连按：后一次顶掉前一次，最后一次生效。切项目：没取走的请求清掉。
- 能力不可用：不适用：聚焦不需要模型或外部资源。
- 文案：无新增，不涉及 i18n。

## 5 中途表

不适用：只改焦点落点，不花钱、不落盘、不长跑。停 / 关窗 / 断网 / 重启 / 连点只影响一个还没取走的请求：关窗随窗口销毁、重启后没有请求、断网无关、连点以最后一次为准；花费一律不涉及，没有回执。

## 6 外部数据与失败

外部来源只有 tabbable（规范：[focus-trap/tabbable README](https://github.com/focus-trap/tabbable#readme)，6.5.0）· 我们的偏差：无，用默认 `displayCheck: 'full'` · 失败时：返回空数组 → 不聚焦，和以前找不到时一样，不报错。

## ★7 性能

不适用：不新增用户操作。⌘J 多一次 store 写，之后至多 30 帧、每帧一次 `hasFocus()`，成功即停；tabbable 只在设置页深链、能力表单校验失败时各跑一次，只扫那一节 / 那一个字段。没有场景能量出差别，不登记 perf 场景。

## 8 真实条件

- 真 Electron 生产构建 + 隔离 profile：`shell-redesign.walk.mjs` zh / en 两轨（check-shortcuts、canvas-agent），截图自己 Read 过。
- macOS ⌘：走查按 `ControlOrMeta+J`，Mac 上就是 ⌘J（宿主同时认 metaKey / ctrlKey）。
- Windows：unverified（同一份宿主代码，按 Ctrl+J）。
- 英文界面：en 轨。最小窗口：unverified（不涉及布局）。干净安装 / 真付费：不涉及。键盘全程：⌘J 打开 + 直接打字（走查）。

## 拍板图清单

不适用：`pure-bugfix`（不改布局、元素、文案，只修聚焦落点）。

## ★9 验收与回滚

验收清单（实现线自验、验收线只核这份；「先红」= 在旧代码上先跑红）：

- **A 报告的那一格（真窗口，`tests/ux/shell-redesign.walk.mjs`）**
  - A1（先红）check-shortcuts：小球 → `ControlOrMeta+J` → 焦点在 `[data-v4-block="composer"] [data-v4-control="input"]` 上且 `isContentEditable`；接着打一句话，`composerText()` 读回原句。zh / en 两轨，截图 `check-mod-j-*.png` 亲眼看。
  - A2 已打了字再按 ⌘J：读回的文字不变、焦点仍在输入框。
  - A3 canvas-agent：点小球打开浮窗，焦点同样在输入框，打字读得回。
- **B 主人一侧（`src/workbench/ai/residentComposerFocus.test.tsx`）**
  - B1 请求 → 主人 `focus()` 返回 true → 请求清掉、`focus` 只调一次。
  - B2 前几帧返回 false（面板还在 hidden 容器）→ 每帧再试，成功那帧停。
  - B3 试满 30 帧不成 → 请求清掉、记一条 `resident-composer-focus-expired`，之后不再调 `focus`。
  - B4 新请求顶掉旧请求：旧的那轮停，新的从头计帧。
  - B5 主人还没就绪（`focus` 为 null）时请求留着，就绪后取。
  - B6 切项目（`releaseProject`）清掉请求。
- **C 门岗（`scripts/focus-by-tag-lookup.test.mjs`）**
  - C1（先红）修之前的 `ShellAgentHost.tsx` 原文必红。
  - C2 红：链式 `x.querySelector('input')?.focus()`；变量 `const t = document.querySelector('#a textarea'); t?.focus()`；三元；`as` / `!`；模板字符串；`querySelectorAll('input')[0].focus()`；`closest('textarea')?.focus()`；`select`；「换个选择器接着猜」的 `'#project-agent-resident [contenteditable="true"]'`、`.ProseMirror`。
  - C3 绿：按主人声明的属性找（`[data-v4-control="input"]`、`[data-model-settings-autofocus]`）；类名 / id 里带 input 字样（`.input-row`、`#input`）；事件判类（`if (target.closest('input, textarea')) return`）；ref 聚焦；tabbable。
  - C4 普查：src 每个文件的命中数等于名单（只有分镜表、分镜行各 1 处），名单外 0 处。
  - C5 接线：仓库 ESLint 配置在名单外的真实路径上报 `focus-owner/no-restricted-syntax`，测试文件不报，名单里的两个文件不报。
- **D 走查门岗（`scripts/check-walkthroughs.node-test.mjs`）**：新规则 `focus-by-input-tag`（判定住 `scripts/lib/composerInputReads.mjs`，与 `composer-input-read` 同一处）抓走查里任何按标签名判焦点 / 判输入框的写法（`tagName === 'TEXTAREA'`、`instanceof HTMLInputElement`、`activeElement.matches('textarea')`）——不只 Agent 面板，全仓现存 0 处；`expectComposerFocused`、`toBeFocused()`、按主人锚点判不误伤；修前的 shell-redesign 那一行必红。
- **E 同类三处**：E1 `DesignSearchInput` 的 ref 落在 `<input>` 上（类型检查 + 组件测）；E2 设置页深链、E3 能力表单出错字段改用 tabbable，tabbable 跳过禁用 / 隐藏（组件测）。
- **F 通用**：改到的 vitest（经锁）、ESLint、typecheck、`check:store-lifetime`、`check:walkthroughs`、`check:root-cause-contracts`、`check:escape-ledger`、`pnpm run gates`，每条记退出码。

反例（实现后真做、做完还原，记「反例 → 结果 → 证据」）：

| 反例 | 必须红的 |
|---|---|
| R1 ShellAgentHost 改回按 `textarea` 找 | C4 普查（名单外 1 处）、A1 |
| R2 换个选择器接着猜：`#project-agent-resident [contenteditable="true"]` | C4 普查 |
| R3 主人的 `focus` 不核 `hasFocus()`，调了就返回 true | B2 |
| R4 去掉帧预算 | B3 |
| R5 ⌘J 不发请求 | A1 |
| R6 走查改回按 `TEXTAREA` 判焦点 | D |

同一类还会从哪些入口、形状、边界回来：
- 入口：任何「打开某个面板后把光标交给它」的新调用者——请求 API 是唯一的路，按实现找会被门岗拦。
- 形状：门岗认链式、变量、三元、强转、模板字符串、下标；有意接受的缺口：`closest()` 结果先存变量再聚焦、选择器先放进变量再传、经别的函数间接返回（静态看不出），写在 `scripts/focus-by-tag-lookup.mjs` 文件头。
- 边界：分镜表 / 分镜行两处 `[contenteditable]` 查找冻结在名单里，迁走要碰热点文件，交协调另排。
- 版本：输入框再换形态（比如换编辑器库），聚焦逻辑跟编辑器实例在同一个主人里，类型会跟着变。

回滚：revert 实现提交即可（tabbable 依赖随之删掉）；不改数据格式、不落盘。
