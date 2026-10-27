# 方向检查：按输入框的实现找它再聚焦（2026-10-27）

> 触发：`node scripts/fix-churn.mjs src/ui/onboarding/ModelCapabilityEditor.tsx` 命中「目录 `src/ui/onboarding/` 14 天 7 个 fix（同一概念）」，文件本身没命中；本刀在那里的改法是**换**（手写的标签列表 → tabbable），不新增分支——按 CLAUDE.md P1 例外，由协调会话代批、事后报用户。
> 设计卡：[docs/plan/2026-10-27-agent-composer-focus.md](../../plan/2026-10-27-agent-composer-focus.md)；根因合同：[docs/fixes/2026-10-27-agent-composer-focus.root-cause.json](../../fixes/2026-10-27-agent-composer-focus.root-cause.json)。

### 0. 一句话根因

想把光标交给别人的输入框时，调用方按输入框**当时的实现**（标签名 `textarea` / `input`，或编辑器的 `[contenteditable]`）去页面里找它；实现一换，找不到就什么也不做，类型系统看不见字符串选择器，没有任何东西会红。

### 1. 归类表

| 处 | 直接原因 | 类 |
|---|---|---|
| ⌘J / 点小球 / 右键浮窗·停靠 / 头部三选一（`ShellAgentHost.focusComposerSoon`） | 找 `#project-agent-resident textarea`；10-12 输入框换成 PromptEditor 后页里没有 textarea，五扇门静默失效 15 天 | 按标签名找别人的输入框 |
| 素材库找参考「改 / 换个词」（`FindReferencePanel.focusKeyword`） | 包一层 div 再 `querySelector('input')`；`DesignSearchInput` 一换形态就失效 | 同上 |
| 设置页深链（`SettingsDialog`） | 手写 `button, input, [tabindex]` 当「第一个能聚焦的控件」：会挑到禁用钮（focus 无效）、`tabindex=-1`，认不得 textarea / select / 富文本 | 手写 tabbable 查询 |
| 设置页深链（`SettingsDialog`，真跑 tikhub 走查后补） | 只在对话框自己状态变的那一刻试一次；那一节归懒加载的「模型」页渲染，那时还不在（实测晚 20–340ms），焦点一直留在对话框后面，main 上从来没落进去过 | 请求方挑时刻聚焦一次、没人核落没落上（⌘J 那条的另一面：`focusComposerSoon` 也是试 20 帧不核结果） |
| 自定义模型能力表单（`ModelCapabilityEditor.focusFirstError`） | 手写 `input, textarea, button`，同上 | 手写 tabbable 查询 |
| 分镜表定位到某镜 / 分镜行 Enter（`StoryboardShotTable`、`StoryboardShotRow`） | 找 `[data-prompt-box] [contenteditable="true"]` 进 PromptEditor 内部 | 按编辑器实现找别人的输入框（现在能用） |

### 2. 为什么会一直出现

聚焦是跨组件的动作，但「怎么聚焦这个输入框」没有归它的主人：请求方自己去 DOM 里猜。猜的依据是实现细节，实现细节归另一个组件，改它的人看不见这些字符串。失败是静默的（`null` 守卫 + 有限重试吞掉），唯一会红的是一条按 `TEXTAREA` 判的走查——而夜跑整体红 117 / 329，这一条没人看见。

三条体验铁律：⑫ 点了=以为的——按 ⌘J 以为能直接打字，实际焦点在 BODY；这里的证据是 shell-redesign 走查的真键盘断言（读回打的字），不新增铁律检查文件。⑩ ⑪ 不适用（不涉及参数与选型）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 「修」⌘J 的人把选择器换成 `#project-agent-resident [contenteditable]`，下次编辑器只读态或换库时再静默失效 | `scripts/focus-by-tag-lookup.test.mjs` 红例 C2 |
| 设计系统搜索框改成带清除钮的复合控件，「换个词」回不到关键词框 | 普查：src 里按标签名找输入框再聚焦的处数 |
| 设置页某一节第一个控件是禁用钮时深链进来没有焦点 | tabbable 跳过禁用（tabbable 自己的测试）；真窗口：`tests/ux/tikhub-connector.walk.mjs` 深链后断言焦点在那一节的控件上 |

### 4. 靶子独立性检查

- 尺子：门岗与走查都由本线写，但反例 R1–R6 在旧代码 / 还原写法上逐条跑红，修前的 `ShellAgentHost.tsx` 原文做成夹具必红；原走查是 10-08 别的线写的，它判的「焦点在输入框」本身没错，错的是按标签名判，本卡改成按 composer 自己声明的锚点 + 读回打的字。
- 没有「修对了反而掉分」的先例。

### 5. P0：这些是我们独有的吗？现成方案有哪些

- 「把光标交给某个输入框」：React 的 ref / 编辑器实例的 `commands.focus` 就是现成的；我们独有的只有「常驻 Agent 面板在小球形态时挂在 hidden 容器里」这一条时序，所以请求要留着等主人。
- 「区域里第一个能 Tab 到的控件」：通用能力，现成的是 [tabbable](https://github.com/focus-trap/tabbable)（6.5.0 已在依赖树：@mantine/core → @floating-ui/react），Radix FocusScope 与 floating-ui 内部都用它；仓库口径「不自写 tabbable 查询」（`src/design/AnchoredPopover.tsx`）。
- 门岗：ESLint 内置 `no-restricted-syntax`（独立规则 id `focus-owner/no-restricted-syntax`），不自写扫描器。走查侧「不按标签名判焦点」同一个规则 id 另开一个块（`tests/ux/**`、`evals/**`），**不往自写门岗族 `gate-family`（`scripts/check-*.mjs`，状态 under-review）里加新规则**：门岗族 10-22 的方向（`docs/audit/2026-10-22-gate-family-direction.md`，用户批了 G1）就是写法类规则进 ESLint，这两片目录 10-22 起已经在 ESLint 里；本刀不改 `check-walkthroughs.mjs`，它现存的 `composer-input-read` 等规则何时搬进 ESLint 归门岗族那条线（`gate-family` 的 reviewBy 2026-10-31）。

### 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 输入框归主人：常驻 Agent 输入框由持有编辑器的 `ProjectAgentResidentShell` 接请求；搜索框转发 ref；「第一个能聚焦的控件」用 tabbable 6.5.0；ESLint 内置规则拦按实现找输入框再聚焦 | 1 个新模块 + 1 个直接依赖（树里已有）+ 1 条规则 | 低：tabbable 默认 `displayCheck: 'full'` 在 Chromium 里与浏览器行为一致 | ✅ |
| 补 | 选择器换成 `[contenteditable]` / `[data-v4-control="input"]` 接着找 | 一行 | 高：就是本次的形状，下次换实现再静默失效 | |
| 重写（限一个模块） | 把 nodePromptFocus 合并成通用「聚焦请求」，所有编辑器都经它 | 要改 `NodeGenerationComposer.tsx`（14 天第 4 个 fix 的热点）、分镜两处（热点） | 中：碰三个热点文件，要用户拍板 | |
| 删 | 去掉 ⌘J 聚焦 | 无 | 用户要再点一下输入框，功能退化 | |

设置深链的那一面（只试一次、不核结果）照 ⌘J 那条的办法收：对话框每帧试到焦点真的进了那一节为止（`src/workbench/settings/settingsSectionFocus.ts`，焦点已在对话框里就不抢、约 2 秒放弃）；落在哪个控件由那一节自己声明（`data-settings-section-focus`，同 `data-model-settings-autofocus`），没声明才取 tabbable 第一个——TikHub 那一节第一个能 Tab 到的是「去拿 Key」外链，没配 key 被带来的人要的是 Key 输入框。这一面静态看不出，门岗不拦，靠两处主人一侧的帧重试和走查核真焦点兜（根因合同 residual_risks）。

残余：分镜表 / 分镜行两处 `[contenteditable]` 查找现在能用，但属同一类；两个文件都是热点（14 天第 3–4 个 fix），本刀不碰，冻结在 `scripts/focus-by-tag-lookup.mjs` 的名单里（只减不增，普查按处数卡死），迁成「行自己持有的编辑器实例」交协调另排。

### 7. 用户要权衡的核心

没有要用户拍板的取舍：推荐项是接入现成方案，且只在热点目录的非热点文件里做「换」。要知会的是分镜那两处被冻结、没迁。

## 特征测试清单

- 修前的 `ShellAgentHost.tsx` 原文：`scripts/fixtures/focus-by-tag-lookup/ShellAgentHost.before.tsx.txt`（门岗必红）。
- 修前的走查断言（`tagName === 'TEXTAREA'`）：`scripts/focus-by-tag-lookup.test.mjs` 走查侧那一句原文必红。
- 能力表单、设置页的「第一个控件」行为由 tabbable 自己的测试覆盖。tabbable 默认 `displayCheck: 'full'` 要真实布局，jsdom 不支持，本仓库的 node 测试环境做不了组件测，所以不补：设置页深链在真 Electron 的 `tests/ux/tikhub-connector.walk.mjs` 里断言光标在 TikHub 那一节的 Key 输入框里；能力表单出错字段 未验证：没有走查进得了能力表单的校验失败态。
- 设置深链的帧重试：`src/workbench/settings/settingsSectionFocus.test.ts`（6 条；只试一次 / 不核结果 / 焦点已在对话框里照样抢三个写法反例各红对应那条）。
