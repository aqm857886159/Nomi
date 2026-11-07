# 方向检查：打开 Agent 后焦点进不了输入框（协调代批 P1 例外）

日期：2026-11-07

- 本页由实现线 I-agent-persona 写。
- 协调按 P1 例外代批（2026-11-07）：只因目录口径命中，文件本身未命中，改法是换。
- 事后已报用户（由协调会话报）。

## 命中了什么

提交 `ShellAgentHost.tsx`、`agentFormStore.ts`、`AgentPanelV4Composer.tsx` 时，方向检查报：
- 目录 `src/ui/app-shell/shell/` 近 14 天已有 2 个 fix，这一刀是第 3 个；
- 目录 `src/workbench/ai/v4/` 近 14 天已有 9 个 fix，这一刀是第 10 个。

## 命中的是目录口径，不是文件本身

14 天内每个文件自己的 fix 提交数：

| 文件 | 14 天内 fix 数 | 那次 fix 是什么 |
|---|---|---|
| `ShellAgentHost.tsx` | 1 | 10-31 的 8854368e7（modal 下的输入），和焦点无关 |
| `agentFormStore.ts` | 0 | — |
| `AgentPanelV4Composer.tsx` | 0 | — |

目录里另外两次 fix 是：今天的小球焦点环 `!`（只动了 `AgentBallFace.tsx`），以及 v4 目录里其它文件的修补。没有一次是在反复修「打开后焦点进输入框」这件事。

## 改法是换，不是补

- 选择器从 `#project-agent-resident textarea` 换成输入框自己给编辑区的标记（`data-v4-control="input"`）。
- 这个标记由 `AgentPanelV4Composer` 从自己的属性推出，作为 `AGENT_COMPOSER_INPUT_SELECTOR` 导出。
- `ShellAgentHost` 里旧的内联查找在同一提交删掉，挪进 `agentFormStore.focusAgentComposerSoon`。
- 没有新增特例分支。唯一新加的是「找满 20 帧还找不到就出声」（`logRendererWarn`）：开发时进 DevTools，打包版只落日志。这一条是协调点名要的。

## 0. 一句话根因

一个模块按另一个模块的 DOM 细节（标签名 `textarea`）找东西，约定没人持有，找不到也不出声。另一个模块换了实现以后，这里一声不吭地失效了。

## 1. 归类

| bug | 直接原因 | 类 |
|---|---|---|
| 点小球、⌘J、右键「浮窗 / 停靠」、头部三形态切换这四种入口打开 Agent 后焦点不在输入框（10-12 起；「叫回」本来就只切形态、不聚焦，不在其中） | 10-12 的 ed086ea3e 把输入框从 textarea 换成 TipTap 可编辑区，外壳还在找 textarea，找满 20 帧悄悄放弃 | 跨模块 DOM 约定无主，失败无声 |

## 2. 为什么一直没被发现

- 走查其实抓到了：夜跑 11-06 的 `shell-redesign.walk.mjs` 退出码 1，原话「Ctrl+J 打开后焦点不在 Agent 输入框」。
- 但那晚夜跑 367 条里红了 142 条，这一条被淹掉了。
- PR 上只跑 `test-routing.json` 登记的花钱走查。`pathRules` 只把路径映射到证据类别，不映射到具体走查，所以改输入框那次不会触发外壳走查。
- 待办（协调单独排，不在本 PR 修）：夜跑 367 条里红 142 条，新红淹在老红里，没人能从里面看出「昨天还绿、今天红了」。
- 铁律 ⑫「点了=以为的」：点小球的用户预期是「开面板并能直接打字」。这条预期写在走查断言里，没写在 catalog 的预期表里。

## 3. 不改结构的话会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 输入框再换一次实现（或改了 `inputAttributes`），外壳又找不到 | 浏览器单测 `focusAgentComposer.browser.test.ts` 用旧的 textarea 找法跑是红的（11-07 实测） |
| 别的「按别人 DOM 找东西再 focus」的地方也会悄悄失效 | `grep -rn "querySelector.*focus()" src` 逐个看；本次没逐个查，记在 PR「已知限制」 |

## 4. 靶子独立性

走查断言原来认的是 `tagName === 'TEXTAREA'`，靶子本身也绑在旧实现上。这次改成认同一个定位口。浏览器单测挂的是生产输入框，不是替身。

## 5. P0

焦点管理不是领域能力，用的都是浏览器原生 `focus()`。约定只是一个属性选择器，没有自写机制。

## 6. 三条路

| 选项 | 做什么 | 代价 | 推荐 |
|---|---|---|---|
| 沿原方向修 | 只把 `textarea` 换成新的选择器字符串 | 约定还是没人持有，下次换实现照样悄悄失效 | 否 |
| 换一种做法 | 定位口归输入框持有 + 找不到出声 + 浏览器单测挂真输入框 | 多一行导出、一个单测 | **是（本次）** |
| 更彻底 | 用 store 计数请求，让输入框自己 `commands.focus('end')` | 要动 ProjectAgentResidentShell 和挂载时机，超出这条线的范围 | 以后再说 |

## 7. 用户要权衡的核心

没有要用户权衡的产品取舍。这件事只是把「点开就能打字」恢复成 10-12 之前的样子。

## 特征测试

- `src/ui/app-shell/shell/agentFormStore.test.ts`：晚几帧挂上就聚焦、不出声；等满找不到出一声带选择器名，不再请求帧。
- `src/ui/app-shell/shell/focusAgentComposer.browser.test.ts`：真浏览器、真输入框、外壳同一个找法。
- 走查：`tests/ux/shell-redesign.walk.mjs` 的 check-shortcuts，以及 `tests/ux/_agentPersonaWalk.mjs` 第 ③ 段。
