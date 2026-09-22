# Agent 面板会话输出渲染审计 · 2026-09-09

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：历史审计已完成；本文件与原始证据由 B2e 按用户任务书迁入。下文记录的是修复前状态，不代表 B2e 的最终行为。

## 先查别人

- 已有依赖：原始发布包类型 `docs/plan/agent-panel-markdown-evidence/streamdown-2.6.0-index.d.ts.txt:526`，核对 props / code / cjk。
- 仓库已有：`src/workbench/common/NomiMarkdown.tsx:1` 是共享入口；下文审计逐项记录修复前六出口绕过机制。
- 生态已有：[AI Elements Message](https://elements.ai-sdk.dev/components/message) 与 [Streamdown 官方接法](https://streamdown.ai/docs/getting-started)；直接采用完整内核，保留 Nomi 领域积木。

## 1. 先查顶尖产品：直接采用什么

**建议整体替换 `NomiMarkdown` 的渲染内核为 Streamdown 2.6.0 + `@streamdown/code` + `@streamdown/cjk`，保留 Nomi token 皮肤与领域积木。** 不再自己维护代码文本提取、复制、高亮、流式 Markdown 分块。它支持 React 18 和 Tailwind 3，Apache-2.0 许可证允许本项目采用；此次只提出修法，没有安装这些依赖或改生产代码。

真正的摩擦是：用户看同一段内容，在最终回答里是表格，停止后或展开工具收据却变成符号串；点“复制代码”还复制不到代码。只换内核解决不了绕过内核的出口，因此后续修复必须同时统一“需要 Markdown 的正文出口”。

### 1.1 顶尖产品公开支持面与可复用栈

核验日期 2026-09-09。以下仅限官方明确声明；**未知不等于不支持**。闭源产品没有公开 renderer 依赖清单，不能凭长相断言用了 Shiki / highlight.js / react-markdown。此次没有登录这些产品或读取用户会话，产品端以官方资料为证，真实对话截图全部来自 Nomi。

| 对象 | 官方可确认的支持面 | 不能据此推断的东西 | 一手来源 |
|---|---|---|---|
| Vercel AI Elements Message / Streamdown | Message 的富文本使用 Streamdown；流式、不闭合 Markdown、GFM；code 插件提供 Shiki 高亮；可选 CJK、数学、Mermaid；代码/表格复制与下载控件 | 不等于任一闭源产品使用同栈；安装整个 AI Elements 也不是必要条件 | [Streamdown README](https://github.com/vercel/streamdown/blob/main/packages/streamdown/README.md)、[Message](https://elements.ai-sdk.dev/components/message) |
| react-markdown + remark-gfm + rehype | React AST 渲染；GFM 表格/任务列表/删除线/自动链接/脚注；rehype 扩展高亮、数学、净化 | react-markdown 自身没有流式修复、代码复制、高亮或折叠 UI | [react-markdown](https://github.com/remarkjs/react-markdown)、[remark-gfm](https://github.com/remarkjs/remark-gfm)、[rehype-highlight](https://github.com/rehypejs/rehype-highlight) |
| ChatGPT 当前会话 | 官方 release notes：交互 code blocks、图示/mini-app 预览、split-screen；长 writing blocks 全屏、目录、下载；保留标题/粗体/链接/列表 | 图示不等于 fenced Mermaid；未找到普通气泡完整 GFM/脚注/数学宏兼容矩阵或内部栈 | [官方 release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| Claude Desktop / Claude Artifacts | Artifacts 官方列 Markdown 文档、代码、SVG、图示/流程图、React；copy/download，独立窗口 | Artifacts 支持不能冒充桌面普通气泡的完整语法承诺；普通回复的脚注/任务列表/数学与库实现未证实 | [Artifacts 官方帮助](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them) |
| Cursor Agent | 官方 changelog 有 Markdown parsing 修正；Agent overview 明示图片在聊天中 inline；独立 Agent to-dos | 编辑器 Markdown preview、Agent to-dos 不等于聊天 GFM checkbox 支持；完整语法及栈未知 | [Agent](https://cursor.com/docs/agent/overview)、[1.3](https://cursor.com/changelog/1-3)、[1.2](https://cursor.com/changelog/1-2) |
| Claude Code | 响应代码块 syntax coloring；`/btw` 可复制 raw Markdown；展开 transcript 工具输出 | 终端排版不能作为 Electron DOM 表格/图片/数学兼容证据；高亮库未公开确认 | [interactive mode](https://code.claude.com/docs/en/interactive-mode) |

ChatGPT 的产品形态不能照抄旧资料：当前官方 notes 的 2026-05-28 条目明确写作/代码功能进入 chat 的 writing/code blocks，GPT-5.5 Instant/Thinking 不再提供原 Canvas。完整产品引用与未知边界见 [product-sources.md](agent-panel-markdown-evidence/product-sources.md)。

### 1.2 Context7 与现役版本/API 实查

通过仓库 `.mcp.json` 指定的 `https://mcp.context7.com/mcp` 实际调用 `tools/list`、`resolve-library-id`、`query-docs`；解析得到 `/vercel/streamdown`、`/remarkjs/react-markdown`、`/shikijs/shiki`。原始响应在证据目录 `context7-resolve-*.txt`、`context7-query-*.txt`，不是凭记忆填 API。

Context7 没有为以上结果提供可靠 npm 最新版本列表，因此**版本/发布时间另以 npm registry 的 `dist-tags.latest` 交叉验证**；保存 [npm-current.json](agent-panel-markdown-evidence/npm-current.json)。并下载 Streamdown **2.6.0 发布包**的类型声明核对实际可用 API，避免官网 main 比发布包更新：[index.d.ts](agent-panel-markdown-evidence/streamdown-2.6.0-index.d.ts.txt)。

| 包 | 当前 latest / 发布时间 | 关键 API 与兼容性 | 许可证 |
|---|---|---|---|
| streamdown | 2.6.0 / 2026-08-24 | `Streamdown`、`plugins`、`isAnimating`、`mode`、`parseIncompleteMarkdown`、`controls`、`codeBlockMaxHeight`、`components`；peer React/DOM `^18 \|\| ^19` | Apache-2.0 |
| @streamdown/code | 1.1.1 / 2026-03-17 | `code` 插件；发布依赖 **Shiki ^3.19.0**，不能把它宣传成已经用了 Shiki 4 | Apache-2.0 |
| @streamdown/cjk | 1.0.3 / 2026-03-17 | CJK 邻接标点的 emphasis / strikethrough 插件；不是中文列宽或标点悬挂排版引擎 | Apache-2.0 |
| react-markdown / remark-gfm | 10.1.0 / 4.0.1（2025-03-07 / 02-10） | `remarkPlugins`、`rehypePlugins`、`urlTransform`、`remarkRehypeOptions`；Nomi 当前已是这两个版本 | MIT |
| shiki | 4.4.3 / 2026-08-10 | `createHighlighter`、`codeToHtml`；高亮器应长驻复用；另有 `@shikijs/stream` 的 `CodeToTokenTransformStream` | MIT |
| highlight.js / rehype-highlight | 11.12.0 / 7.0.2 | `rehype-highlight` 经 lowlight 使用 highlight.js；适合已有 unified 管线，高亮之外的流式分块/复制/折叠仍要另外解决 | BSD-3-Clause / MIT |
| @streamdown/math / katex | 1.0.2 / 0.18.7 | 插件依赖 KaTeX ^0.16.27，独立 latest 不等于该插件解析版本；可选 `remark-math` + `rehype-katex` | Apache-2.0 / MIT |
| @streamdown/mermaid / mermaid | 1.0.2 / 11.17.2 | 可选 Mermaid 插件，图示控件与配置 API；本次不建议开启 | Apache-2.0 / MIT |
| rehype-sanitize | 6.0.0 | HAST allowlist 净化；与图片/外链允许策略不是同一件事 | MIT |

[安装文档](https://streamdown.ai/docs/getting-started)明确分别给出 Tailwind 4 `@source` 与 **Tailwind 3 `content` 扫描**。Nomi 当前 `react 18.3.1`、Tailwind `3.4.19`、Mantine `8.3.18`、AI SDK `4.3.19`；不要用 09-06 定稿里的旧 Mantine 版本说明当今天的事实。Streamdown 可独立使用，输入已有的 `text` 与 `streaming`，无须为 renderer 替换 lane/模型 SDK。

**流式高亮的区别**：Streamdown 自己负责 Markdown 分块/未闭合处理，code 插件懒加载语法并缓存高亮；当前源码 `HighlightedCodeBlockBody` 随代码更新调用插件 `highlight`，不应声称它等于 Shiki 4 token-stream 增量算法。直接用 Shiki 时则需要复用 highlighter，不能每个 token 新建一份。highlight.js 是可行高亮备选，但它本身同样不是流式 Markdown UI。采用 Streamdown 可以少维护这一整条组合链。

### 1.3 能力 × 产品/现状/直接采用

| 能力 | 顶尖产品公开支持？ | NomiMarkdown / 当前出口 | 差距 | 直接采用 |
|---|---|---|---|---|
| 标题、粗体、行内代码、链接 | ChatGPT / Cursor 有官方 Markdown/富文本证据 | 最终助手正文可用；标题 H1–H3 在 v4 降级为粗体小字 | 中断和过程出口绕开；中文邻接强调漏渲染 | Streamdown 核心 + CJK；所有助手状态共用入口 |
| GFM 表格 | 开源 Streamdown / remark-gfm 明确支持；四家闭源无完整 GFM 保证 | 正文实测为 `<table>`，数值右对齐有效；工具输出为裸 pipe 文本 | 内容类型在出口丢失；窄表列宽可读性有限 | 核心表格 + token 样式，采用自带复制/全屏能力时按控件层级收纳 |
| 三层列表 | 开源 CommonMark 支持；ChatGPT 声明 lists | 正文真实三层 DOM 与缩进正常 | 中断/过程/审批退回文本 | 核心列表，无自写解析 |
| 任务列表 | Streamdown / remark-gfm 明确 | 正文 6 个 disabled checkbox 正常；子级只缩进 4px | 层级难辨；不能等同可执行计划 | 核心语法 + token 缩进；可执行计划仍走介入槽 |
| 脚注 | remark-gfm/Streamdown GFM 栈支持 | 脚注文本/编号已出现；内部引用仍加外链箭头并开新窗口 | 内外链接未分流；多消息脚注 ID 需回归 | 共享 link adapter + 每消息 ID/锚点策略，解析交给库 |
| 代码等宽/围栏 | 顶尖产品有 code blocks | 带/不带语言都进 `<pre><code>`，不是“没等宽” | 无高亮；复制错误；12 行折叠失效；无语言代码多套行内样式 | `@streamdown/code` + 官方 `CodeBlock` / `CodeBlockCopyButton` |
| 长代码复制/折叠/滚动 | ChatGPT code blocks、Claude Artifacts copy；闭源具体阈值未知 | 复制 `[object Object]`；19 行全文摊开 | 自写代码容器破坏源文本契约 | 官方复制与 `codeBlockMaxHeight`；保留 Nomi 的 12 行展开/收起薄控制层 |
| 不闭合流式 Markdown | Streamdown 为此设计 | react-markdown 对累计全文重解析；无 remend | 缺少开箱即用流式基础设施；本轮不作帧率结论 | `mode="streaming"` / `isAnimating`；按既定设计设 `parseIncompleteMarkdown={false}` |
| 中文强调/标点 | CJK 插件明确解决相邻标点解析 | `这是**「重点」**的句子`、`~~「删除」~~` 裸露 | CommonMark delimiter 规则与中文用户预期不同，不是 GFM 根本未接 | `@streamdown/cjk`；不另写 regex 补丁 |
| 数学（KaTeX） | 开源方案明确；产品的数学能力不等于语法保证 | 不支持渲染 | **09-06 定稿明确不做，不列 bug** | 现阶段不装 math；产品方向改变再启插件 |
| Mermaid | 开源插件明确；闭源 diagram 不能推出 fenced Mermaid | 当普通代码块显示 | **定稿明确不做，不列 bug** | 现阶段不装 mermaid |
| 图片 | Cursor inline、Claude Artifacts 明确 | v4 输出 alt chip，不加载图片；不会自动创建任务卡 | chip 丢了 URL，也无打开/定位动作 | 媒体引用交 Nomi 现有资产/任务身份；renderer 只放已绑定 chip |
| 链接/图片安全 | Streamdown 有 sanitize + harden；闭源策略未公开确认 | react-markdown 默认 URL 过滤；无 raw HTML 插件；Electron 只放行 http(s) 外链；v4 图片不请求 | 换库不能默认扩大协议/远程图片面 | 保留 Electron 边界、显式 hardening/图片策略与 custom link/image components |
| 八镜长文 | ChatGPT writing blocks/Claude Artifacts 给独立阅读面 | 正文已按面板 60% 折叠、可展开滚到第 8 镜 | 裁在句子中部；“还有 94 行”其实是像素估算 | 保留宿主高度约束；长创作成果引用文稿/分镜对象，勿再造编辑器 |

### 1.4 替换边界与真正取舍

| 方案 | 用户看到什么 | 代价 / 判断 |
|---|---|---|
| **推荐：Streamdown 内核 + code/CJK，保留 token 薄皮肤** | 代码能正确复制和高亮，中文强调正常；所有语义相同正文一致渲染 | 需要一次皮肤与安全适配；换完删除旧 ReactMarkdown 管线及坏的 `AgentV4Code`，不长期双跑 |
| 保留 react-markdown，补高亮/CJK/复制/流式组装 | 也能修到相近效果 | 容易把开源库已经提供的行为重新拼一遍，长期维护成本较高；只有整体替换实际兼容验证失败才重新评估 |

Streamdown 默认行为不完全等于获批 v4：

- `parseIncompleteMarkdown` 默认 true；v4 第 9 条是“流式不预测闭合”，采用时显式 false，除非之后专门改这一产品决定。底层分块/缓存、GFM、代码插件仍可复用。
- 长代码默认 `400px` 封顶并纵向滚动，**不是“超过 12 行出现展开按钮”**。使用官方高度 API 和源代码字符串实现 Nomi 的薄交互；不重写高亮与复制。
- code/table controls、行号、下载、全屏并非全开越好。Nomi 只保留获批动作、Tabler icon、i18n 和 token，不整包复制 shadcn 色板。
- [官方安全文档](https://streamdown.ai/docs/security)的 harden 默认图片/链接前缀宽松，不能靠“安全默认”四字代替 Nomi 策略。自定义 `rehypePlugins` 时还可能替换默认净化链，应明确保留 sanitize/harden，禁止 Markdown 任意 HTML/远程媒体悄悄扩面。
- Apache-2.0 可用于本仓 AGPL-3.0-only；如 vendor 官方组件，保留版权/许可证与适用 NOTICE。不是许可障碍，也无需自研替代。

### 1.5 R29 四列表（现状，不把建议冒充已接入）

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| react-markdown AST → React、components、URL transform；[官方 API](https://github.com/remarkjs/react-markdown#api) | `NomiMarkdown.tsx:116` ReactMarkdown；`:91` remarkGfm | `:36` token 标签映射，领域皮肤合理 | 助手中断 `AgentPanelV4Message.tsx:92` 脱离共享 renderer |
| remark-gfm 表格/脚注/列表；[规范](https://github.github.com/gfm/) | `NomiMarkdown.tsx:41` 列表、`:65` 表格、`:74` checkbox | 表格 wrapper、任务缩进、脚注链接皮肤 | 工具 `AgentPanelV4Receipt.tsx:107` 和审批 `AgentPanelV4Cards.tsx:223` 只收 string，不复用语法 |
| Streamdown 流式分块、remend、GFM、安全、控件；[README](https://github.com/vercel/streamdown/blob/main/packages/streamdown/README.md) | **未使用 Streamdown** | `NomiMarkdown.tsx:80` 自写代码复制/行数；`AgentPanelV4Markdown.tsx:37` 自写高度估算 | 源文本在代码容器变成 ReactNode 再 `String()`；内容与身份边界被拆散 |
| Streamdown CodeBlock 接受 `code: string`，官方复制上下文；[代码容器](https://github.com/vercel/streamdown/blob/main/packages/streamdown/lib/code-block/index.tsx) | 无；当前没有高亮插件 | font-mono + 背景仿代码块，复制器自写 | `language-*` 被当成“是否代码块”的判断，语言元信息与块结构混为一谈 |
| AI Elements MessageResponse 的 Streamdown 富文本；[官方 Message](https://elements.ai-sdk.dev/components/message) | 本地 `vendor/aiElementsPrimitives.tsx:16` Message / `:37` Response / Actions 外壳 | 自己的 streaming 光标 `:52` 与 8 积木外观 | 官方富文本能力未带入，MessageResponse 实际只渲 children；不能据 `data-ai-element` 宣称已复用其 renderer |
| Nomi 自有任务/审批领域状态 | `laneViewModel.ts:258` 助手、`:250` task、`useAgentPanelV4Data.ts:192` 介入投影 | 任务卡、审批、预算与资产绑定：这是领域职责 | 把所有富文本文段降成 label/summary 会丢类型；反向把所有 JSON 变 Markdown 也会错 |

后续实施前逐字段裁决需登记 framework boundaries；此文是只读审计与采用建议，**没有把未来接入登记为完成**。最小参考实现对照：模型流/lane（保留）、消息 parts（保留）、Markdown 分块（用库）、AST（用库）、高亮（用 code 插件）、复制（用库）、皮肤（Nomi）、折叠/滚动（产品约束薄适配）、媒体/链接（Nomi 桥接）。

## 2. 审计身份、范围与真实取证方式

基线：`4e96ccb92b1f09c40cb8bd664e4a23542e2b7a75`，detached 在用户指定的 `origin/feat/agent-lane-stage4-switch-20260908`。目录仅 `/Users/aoqimin/Desktop/Nomi-agent-markdown`。

按要求开工先执行 `git rev-parse HEAD`、`git status --short`（干净）、`pnpm install --frozen-lockfile --prefer-offline`（通过）。未刷新/切换分支、未 commit/push；只写报告/证据/AM-LAST。此任务不跑与审计无关的雷达，不读取真实项目库。

`pnpm build` 从这个 checkout 生成 Electron/renderer 构建并通过。使用既有 `createRuntimeWalk` / `launchNomiApp`：隔离 `user-data/settings/projects/capability`，新建空白项目，真实 composer 发送 → loopback OpenAI-compatible SSE → pi lane → IPC → v4 → 屏幕；不是设计实验室种消息、不是替换 DOM，也没有注入业务 store。只有远端模型由确定性回复替代。

工具场景是在隔离文稿输入合成 Markdown，再由真实 `read_full_text` 返回它；审批场景是真实 `append_to_end` 工具 + 每步问，截图后通过“不要/确认不要”取消。左侧文稿里出现源标记是**主动输入的合成素材**，本次缺陷判定只看右侧 Agent 面板。每个格式开启独立 lane。

窗口宽 **1440 CSS px**；macOS 可用屏幕约束后 DOM 读回 viewport 为 **1440×840**（捕获时 PNG 高度为 840 或 842，见 manifest），截图使用 `scale: 'css'`，全部正式 PNG 宽 1440。实际面板宽 339px、内容宽 313px，这就是当前真实布局，不人为撑宽冒充 390 样张。亮/暗通过隔离 profile 的主题偏好重新载入，四个主题属性走生产初始化。

正式主取证 20 次文本请求，边界补测 6×2=12 次，**32 次 localhost 文本请求、图片/视频付费调用 0、总费用 0**。加上前期脚本定位/重载导航重试的 22 次，整次审计累计 54 次本地 fixture 请求，仍为零付费。没有把 instrument 重试算成产品缺陷。

主取证 [runtime-report.json](agent-panel-markdown-evidence/runtime-report.json) 与边界 [edge-runtime-reports.json](agent-panel-markdown-evidence/edge-runtime-reports.json) 均 passed、unexpected=[]。这里的 passed 只表示真实路径取证完成，**不代表产品缺陷已修复**。正文多数为单个 SSE 内容块；补测 hold 验证真实流式/停止，未做 token 级性能压测，也不声称测过付费模型自然输出质量。

## 3. 所有会话文本出口清单

下列文件均相对 `src/workbench/ai/v4/`，其他目录写全路径。静态“可复发”不冒充现场已复现；第 4 节有截图的才是视觉实证。

| 出口 | 走 NomiMarkdown / 纯文本 / 自己拼 | 位置与现状 | 审计裁决 |
|---|---|---|---|
| 助手完成/流式正文 | **NomiMarkdown** | `AgentPanelV4Message.tsx:95` → `AgentPanelV4Markdown.tsx:48` → common renderer | 主体 GFM 工作；高亮/复制/CJK 需改 |
| 助手中断正文 | **纯文本** `<p>` | `AgentPanelV4Message.tsx:92` | 同段停止后丢表格和换行，实证 D2 |
| 缺参数提问 | **NomiMarkdown + 自己拼选项** | `AgentPanelV4Message.tsx` 的 `V4Suggestion` / `V4OptionChips` | 提问正文复用正确；选项是交互标签，不宜塞块级 Markdown |
| 用户气泡正文 / 附件 chip | **纯文本 + 自己拼** | `AgentPanelV4Message.tsx:64`、`BubbleChip` | 输入原文与引用标签不是助手富文本；纯文本有合理语义，不一律替换 |
| 思考行 | **纯文本** label/meta | `AgentPanelV4Message.tsx` 的 `V4Thinking`；lane thinking → meta | 暂无 Markdown 排版承诺；长 reasoning 塞单行的风险另列，不作已复现 |
| 过程折叠说明 | **纯文本** `<p whitespace-pre-wrap>` | `AgentPanelV4Receipt.tsx` 的 `V4Process`；`agentPanelV4Collapse.ts` 把助手段转成 segments | 折叠前是助手正文，展开后应仍 Markdown；实证 D5 |
| 工具收据行 / 分组行 | **自己拼 + 纯文本** | `AgentPanelV4Receipt.tsx:28`、`V4ToolGroup` | 标签/状态/短摘要应保持一行；不要把整表塞行头 |
| 工具收据展开输入/输出 | **纯文本** `<pre>` | `AgentPanelV4Receipt.tsx:107` `ReceiptBlock`；`laneViewModel.ts:291` 输出字符串 | 输入 JSON/原始日志可保留 pre；用户可读 Markdown 输出需类型化分流，实证 D3 |
| 审批/反问/凭证正文 | **自己拼 + 纯文本** | `agentPanelV4Intervention.ts:129` 拼 summary；`AgentPanelV4Cards.tsx:223` `<p>` | 内容先 normalize+截断，再渲染已救不回列表；实证 D4 |
| 计划卡条目 label | **自己拼 checkbox + 纯文本** | `AgentPanelV4Cards.tsx:241`、`:253`、`:258` | 勾选是领域状态；标题应是短标签/行内富文本，不直接塞整段列表 |
| 计划卡条目 detail | **纯文本** `<pre break-all>` | `AgentPanelV4Cards.tsx:256`；`agentPanelV4Intervention.ts:162` 同字段可来自 technical 或 shot.description | 技术详情与创作说明共用 detail；应区分技术 pre / prose Markdown。静态风险，本轮未造计划审批截图 |
| 任务卡 | **自己拼** title/status/params/progress/candidates，excerpt 纯文本两行截断 | `AgentPanelV4Cards.tsx:72`、`:88`、`:91`；`laneViewModel.ts:188` | 真任务卡不是 Markdown 猜出来的；标题/参数应标准化，详述交正文/对象详情；本轮静态审计 |
| 错误报告 / 错误条 | **纯文本** `<span>` | `AgentPanelV4Receipt.tsx` `V4ErrorBar`；`laneViewModel.ts:246` | 一句可行动原因是合理默认；如后续有 Markdown 诊断详情应展开渲染，不能混入单行 label。静态审计 |
| 压缩摘要（pi compaction） | **当前无可见文本出口** | `electron/shared/agentLane/laneProjection.ts:235` 跳过非 message；`:113` 仅用于 usage 失效判定 | 不应写成“摘要走 NomiMarkdown”或伪造截图。若产品决定展示，使用助手文本的折叠态；宿主 notes 在 `laneViewModel.ts:235` 也不直接占行 |
| composer 引用 chip | **自己拼 + 纯文本** | `AgentPanelV4Composer.tsx:33`、`:52` `max-w-[150px] truncate` | 保持可移除的身份标签；不渲整个 Markdown。引用显示名应去掉源标记，详细预览归对象自身 |
| composer 输入/模型/权限/技能菜单 | **原生 textarea + 自己拼标签** | `AgentPanelV4Composer.tsx:159`、`:205` 等 | 属输入与控制面，不是助手回复 renderer |
| 队列、旧会话提示、上下文环/坞 | **自己拼 + 纯文本** | `AgentPanelV4Cards.tsx` V4Queue；Panel `:195`、`:299`；Context/Dock | 只显示任务身份、状态、数值；不自动扩成富文本正文 |

**类根因**：共享解析器不是唯一问题。展示合同只用 `string`，没有区分“Markdown 正文 / 一行标签 / JSON 或技术源码”；不同状态/积木自己选 `<p>` 或 `<pre>`，同类内容就会在别的入口再坏。最早修复边界是“lane/领域数据 → 展示语义”的投影，其后所有 prose 都调用同一个 renderer；不能先破坏换行再交给它，也不能凭字符串有 `|` 就猜成表格。

## 4. 真实截图与逐张人眼复核

28 张正式截图已逐张通过 `view_image` Read；没有用 DOM 数量替代看图。每组都是独立打开的 1440 宽完整 Electron 视口；以下同时记录正常与异常。

| 场景 | 亮色 | 暗色 | 逐图判断（两种主题分别看过） |
|---|---|---|---|
| GFM 中文表格 | [01 light](agent-panel-markdown-evidence/01-table-light.png) | [01 dark](agent-panel-markdown-evidence/01-table-dark.png) | 真表格、边框/表头可见，3 数据行；数值列右对齐正确。中文场景列窄成两字一行，但没有裸 pipe 或整表溢出；暗色边框弱但能辨。 |
| 中文注释代码 | [02 light](agent-panel-markdown-evidence/02-code-light.png) | [02 dark](agent-panel-markdown-evidence/02-code-dark.png) | 背景围栏和等宽均有；19 行全部摊开、无高亮、无代码折叠按钮。两主题点击复制实际都是 `[object Object]`。 |
| 三层嵌套列表 | [03 light](agent-panel-markdown-evidence/03-nested-light.png) | [03 dark](agent-panel-markdown-evidence/03-nested-dark.png) | 1 个 ol、5 个 ul；数字层与两层圆点逐级缩进，行文可读，没有缩进错误。 |
| 任务列表 | [04 light](agent-panel-markdown-evidence/04-tasks-light.png) | [04 dark](agent-panel-markdown-evidence/04-tasks-dark.png) | 6 个 checkbox 显示勾选/未勾选，非裸 `[x]`；子任务只右移约 4px，容易误认为同级。disabled 的灰色本身不是 bug。 |
| 粗体/行内代码/链接/脚注 | [05 light](agent-panel-markdown-evidence/05-inline-light.png) | [05 dark](agent-panel-markdown-evidence/05-inline-dark.png) | 普通粗体、行内代码、链接都正常；中文相邻 `**「重点」**` 与 `~~「删除」~~` 裸露；内部链接/脚注也带 ↗。未见确定的中文闭标点悬出边界。 |
| 八镜长文默认态 | [06 light](agent-panel-markdown-evidence/06-storyboard-light.png) | [06 dark](agent-panel-markdown-evidence/06-storyboard-dark.png) | 标题降级、段落与列表清楚；确有“还有 94 行·展开”，不是无折叠。裁切落在镜头 2 描述中途，有半行硬切感。 |
| 八镜长文展开至尾 | [06 expanded light](agent-panel-markdown-evidence/06-storyboard-expanded-light.png) | [06 expanded dark](agent-panel-markdown-evidence/06-storyboard-expanded-dark.png) | 能滚到镜头 8 和交付检查，有收起按钮与滚动条；没有“长文无法阅读”的缺陷。 |
| 工具 Markdown 输出 | [07 light](agent-panel-markdown-evidence/07-receipt-light.png) | [07 dark](agent-panel-markdown-evidence/07-receipt-dark.png) | 展开收据输出中 `##`、pipe、`**`、反引号全部按源码显示；表格没有成表格，列表是字符；这里是真工具返回。 |
| 审批列表正文 | [08 light](agent-panel-markdown-evidence/08-approval-light.png) | [08 dark](agent-panel-markdown-evidence/08-approval-dark.png) | 三个镜头压在“1 条内容 · …”摘要中，`- **镜头一**` 等裸露，换行丢失；两主题一致。 |
| 无语言围栏 | [09 light](agent-panel-markdown-evidence/09-no-language-light.png) | [09 dark](agent-panel-markdown-evidence/09-no-language-dark.png) | 仍是代码块且保留空格；内部第一/末行又套了 inline code padding/background，不能误报“没围栏”。 |
| 图片/数学/Mermaid 边界 | [10 light](agent-panel-markdown-evidence/10-image-math-light.png) | [10 dark](agent-panel-markdown-evidence/10-image-math-dark.png) | 图片变“窗边白瓷杯”chip，没有图片或任务卡；公式保留 `$`，Mermaid 保留代码。后两项符合已拍板范围；图片 chip 无入口是另一个可用性问题。 |
| 流式停止前 | [11 before light](agent-panel-markdown-evidence/11-before-stop-light.png) | [11 before dark](agent-panel-markdown-evidence/11-before-stop-dark.png) | 真表格、序号列表都在；光标却出现在上方“正在检查”后，未跟最后列表项。 |
| 同条回复停止后 | [11 after light](agent-panel-markdown-evidence/11-after-stop-light.png) | [11 after dark](agent-panel-markdown-evidence/11-after-stop-dark.png) | 点击真实停止按钮后，原表格/列表挤成普通段落，Markdown 符号裸露；不是不同模型回复。 |
| 折叠过程展开 | [12 light](agent-panel-markdown-evidence/12-process-light.png) | [12 dark](agent-panel-markdown-evidence/12-process-dark.png) | 真实两次读取形成“尝试了 2 次”；展开后粗体、表格标记裸露，最终回答另行正常显示。 |

DOM/剪贴板读回见 [observations.json](agent-panel-markdown-evidence/RAW-CAPTURES.md)、[edge-observations.json](agent-panel-markdown-evidence/RAW-CAPTURES.md)。尺寸与 SHA-256 见 [screenshot-manifest.json](agent-panel-markdown-evidence/screenshot-manifest.json)。复制不是截图能证明的，因此附实际 `expected/actual/match`；长文外壳折叠高度约 443px（738×0.6），加按钮后 466px，展开全文外壳约 2332px。

## 5. 缺陷表：症状 → 根因 → 修法

P1 = 内容或既定动作错误，优先修；P2 = 可读性/反馈/细节。没有证据支持 P0 安全事故。路径相对仓库根，`V4/` 表示 `src/workbench/ai/v4/`，`MD` 表示 `src/workbench/common/NomiMarkdown.tsx`。

| ID / 级别 | 截图证据 | 出口与症状 | 根因 file:line | 修法 | 所属 |
|---|---|---|---|---|---|
| D1 / P1 | [亮](agent-panel-markdown-evidence/02-code-light.png) / [暗](agent-panel-markdown-evidence/02-code-dark.png) | 复制代码得到 `[object Object]`，19 行代码无 12 行折叠 | `MD:82` 对 ReactNode `String()`，`:83` 再据此数行，`:84` 复制同一错误字符串 | 换官方 CodeBlock/CopyButton，让 `code:string` 为复制与行数唯一输入；12 行薄壳只消费源文本，不从 React element 反提取 | NomiMarkdown |
| D2 / P1 | [亮](agent-panel-markdown-evidence/11-after-stop-light.png) / [暗](agent-panel-markdown-evidence/11-after-stop-dark.png) | 点停止后正确表格/列表退回符号串 | `V4/AgentPanelV4Message.tsx:92` 中断分支改用 `<p>`，还折叠空白 | 中断/完成/流式共用 Markdown renderer，状态只改变色调/操作，不改变内容语义 | 出口自身 |
| D3 / P1 | [亮](agent-panel-markdown-evidence/07-receipt-light.png) / [暗](agent-panel-markdown-evidence/07-receipt-dark.png) | 工具返回 Markdown，却只显示原始标记 | `V4/AgentPanelV4Receipt.tsx:107` 所有值一律 `<pre>`；`src/workbench/ai/lane/laneViewModel.ts:291` output 仅 string | 在共享展示投影区分 prose Markdown 与 JSON/日志；Markdown 输出调同一 renderer，输入 JSON 保留代码展示；原始输出可作详情，不另造 parser | 出口 + 展示语义边界 |
| D4 / P1 | [亮](agent-panel-markdown-evidence/08-approval-light.png) / [暗](agent-panel-markdown-evidence/08-approval-dark.png) | 审批三条镜头列表压成一句，粗体标记裸露 | `V4/agentPanelV4Intervention.ts:88` `replace(/\s+/g,' ')`、`:90` 源码截 60 字；`:146` 拼 summary；`V4/AgentPanelV4Cards.tsx:223` 纯 p | “动作摘要”和“待批准内容”分开；保留正文换行→共享 Markdown；高度约束用可展开预览，不在源字符串中途截断。仅包 `<NomiMarkdown>` 不足以修复 | 出口/最早投影层 |
| D5 / P1 | [亮](agent-panel-markdown-evidence/12-process-light.png) / [暗](agent-panel-markdown-evidence/12-process-dark.png) | 助手过程段一旦进入折叠组，展开后不渲 Markdown | `V4/AgentPanelV4Receipt.tsx` 的 `V4Process`（`:191`）直接 `<p>{segment}</p>` | 过程收起态维持一行，展开的每个原始助手段走共享 renderer；技术工具输出另走原始通道 | 出口自身 |
| D6 / P1 | [亮](agent-panel-markdown-evidence/05-inline-light.png) / [暗](agent-panel-markdown-evidence/05-inline-dark.png) | 中文相邻标点内粗体/删除线裸露 | `MD:91` 仅 remarkGfm，没有 CJK delimiter 兼容；不是漏传 remark-gfm | 用 `@streamdown/cjk`（或现成 remark CJK 插件），含中文「」/引号/删除线与中英文混排回归 | NomiMarkdown 内核 |
| D7 / P2 | [亮](agent-panel-markdown-evidence/02-code-light.png) / [暗](agent-panel-markdown-evidence/02-code-dark.png) | 有等宽代码块，无语法高亮 | `MD:55` 只加 language class；`:116` 无高亮 plugin | 使用 `@streamdown/code` 的 Shiki 语法层；按需加载、暗亮 token 主题，不自写 keyword regex | NomiMarkdown |
| D8 / P2 | [亮](agent-panel-markdown-evidence/05-inline-light.png) / [暗](agent-panel-markdown-evidence/05-inline-dark.png) | 内链/脚注都标外链 ↗，目标设置 `_blank` | `MD:47` 未按 href 类型分流；`electron/main.ts:310` 新窗只允许 http(s) | 锚点本页滚动、外链走既有桥接、对象链接用已有能力；不替内部脚注开外窗。截图证实错误标识/target；本次未点击外部链接 | NomiMarkdown 链接适配 |
| D9 / P2 | [亮](agent-panel-markdown-evidence/04-tasks-light.png) / [暗](agent-panel-markdown-evidence/04-tasks-dark.png) | 嵌套任务看起来接近同级 | `MD:43` 所有 task-list 都 `pl-1`，仅 4px；普通列表是 `pl-5` | 保留 disabled checkbox，根列表与嵌套层分别给 token 缩进；不是换成可操作任务系统 | NomiMarkdown 皮肤 |
| D10 / P2 | [亮](agent-panel-markdown-evidence/10-image-math-light.png) / [暗](agent-panel-markdown-evidence/10-image-math-dark.png) | Markdown 图片只剩无动作 alt chip，找不到图片 | `MD:61` img 解构只取 alt，`:62` 无 src/目标身份/点击；不会因此触发任务投影 | 不擅自创建假任务卡；识别已有资产/任务身份并提供引用入口；无身份的远程图显式按产品策略处理，勿静默丢 URL 或自动下载 | NomiMarkdown + 媒体出口 |
| D11 / P2 | [亮](agent-panel-markdown-evidence/09-no-language-light.png) / [暗](agent-panel-markdown-evidence/09-no-language-dark.png) | 无语言围栏内部又套 inline code 皮肤 | `MD:53` 把有无 `language-*` 当块/行内判据 | 使用库提供的结构判断/代码块组件；无语言、未知语言都仍是 block，保留 monospace 与原空格 | NomiMarkdown |
| D12 / P2 | [亮](agent-panel-markdown-evidence/06-storyboard-light.png) / [暗](agent-panel-markdown-evidence/06-storyboard-dark.png) | 长文折叠切在句子/半行中，“94 行”不是可靠行数 | `V4/AgentPanelV4Markdown.tsx:40` 写死 lineHeight=20；`:47` 任意像素 overflow-hidden | 保留 60% 产品阈值；不要宣称精确剩余行数，使用“展开全文”；按完整可见行/块边界或清晰截断提示，宽度变化重新测量 | 出口外壳 |
| D13 / P2 | [亮](agent-panel-markdown-evidence/11-before-stop-light.png) / [暗](agent-panel-markdown-evidence/11-before-stop-dark.png) | 流式光标停在上方标题段，而非最后一个列表项 | `V4/vendor/aiElementsPrimitives.tsx:52` 后代 `p:last-of-type`，不能代表最后渲染块 | 优先采用 renderer 的 caret/块状态扩展；薄皮肤定位真正尾块，表格/代码/列表结尾都要验证，勿自写另一套流式状态 | 出口流式皮肤 |

D3/D4：09-06 定稿本来把收据详情画成 input/output pre、审批限制为短摘要；所以这是**本次用户明确提出“Markdown 应渲染”后需要调整的展示合同**，并非声称实现违反了当时每一条样张。D1/D2 则是既定动作/同段内容的明显缺陷。D6 属相对中文产品预期的兼容缺口，不指控 CommonMark 解析器不符合规范。

### 5.1 静态发现与未复现边界（不混进截图缺陷数）

| 项 | 证据与风险 | 后续处理 |
|---|---|---|
| 计划 detail 混技术与文案 | `AgentPanelV4Cards.tsx:256` pre + break-all；`agentPanelV4Intervention.ts:162` 可接 technical 或 description | 用领域来源区分语义；文案 detail 渲 Markdown、技术详情代码化。尚未以计划卡真机截图验证 |
| 任务 excerpt / error / chip 可能露标记 | 纯 string 标签与两行截断 | 对短标签做 AST → 文本摘要（用现成 AST 工具），正文走统一渲染；不要在 chip 塞整表。未造假任务/错误卡作视觉证明 |
| 压缩摘要不可见 | laneProjection 跳过 compaction；没有明确用户可见摘要入口 | 本次不伪造“压缩 Markdown 没渲染”缺陷；若要展示，另定输出合同与折叠入口 |
| 多消息脚注 ID、H4–H6、链接打开、窄宽变化 | 当前 custom headings 只覆盖 H1–H3；默认脚注前缀没有 message scope；高度 effect 只依赖 text/fold | 列入换核回归，不在未实测时写成已失败 |
| 非 v4 图片 | `MD:63` `<img alt={alt}/>` 同样没有 src | 共享组件静态连带风险；本任务没有审文件预览，不扩大成文件预览已真机复现 |
| 中文表格列宽 | 01 的 table/container 均 313px，列宽受内容压缩；有横向 overflow wrapper 不代表一定产生滚动 | 作为可读性优化：列最小可读宽度/内容换行/按需横滚，避免硬编码中文字符数；不是“表格未成表格” |

## 6. 输出形式：八积木如何承载结构化内容

对照 [09-06 v4 定稿](../design/2026-09-06-agent-panel-v4.md)：用户气泡、助手文本、一行收据、任务卡、介入槽、队列行、收起坞、composer。**Markdown 是积木内部的呈现能力，不能代替审批/任务状态；也不需要新增第九种卡。**

| 内容 / 用户当时的任务 | 当前真实形态 | 应用的积木 / 原因 |
|---|---|---|
| “帮我比较三个模型” | 模型回 pipe 表时，助手文本里就是表格（01）；不会自动变任务卡 | **助手文本中的 GFM 表格**。横向比较列比长段说明省力；库提供 table，不为模型对比再造卡/解析器 |
| “解释 duration / aspect ratio 参数” | 助手可回列表/表格；工具结果当前 pre（07） | **助手文本的列表/两列表**；若已是某次真实生成的参数，放该**任务卡 params**。讲知识与执行配置不混淆 |
| “先写一份八镜分镜方案供我看” | 06 是长 Markdown，自动 60% 折叠，可滚到镜头 8 | **助手文本**给简短概要与可读表/分镜条目；详细创作成果落文稿/分镜对象，再给引用入口。长文本本身不是任务，也不强行卡化 |
| “按这八镜去修改/创建，先让我确认” | 具备计划来源时进入 V4Intervention.plan，checkbox 与 details 自己拼；普通 append 当前仅 summary（08） | **介入槽的 Plan**，条目由真实提案生成，checked 是真批准子集；每项文案 detail 可 Markdown。不能仅凭助手写了 `- [ ]` 就当授权 |
| “生成八镜视频” | 实际 `ProductionRun` note/facts 才由 lane 投影成 task | **任务卡**承载状态、进度、预算、缩略图与采用；其间工具操作用**一行收据**。没有 runId 不伪造任务 |
| 工具读到了含 Markdown 的文稿/检索结果 | 一行收据 + pre | **一行收据**仍不展开；展开后按语义显示正文 Markdown，JSON/日志代码化，不新建并行结果面板 |
| 可恢复错误/诊断 | 现为 ErrorBar 一句话 | 保留**收据/任务卡错误态**的一句原因与动作；若有长诊断，展开后用共享 Markdown。错误不是新积木 |
| 引用一段方案继续讨论 | composer chip 是纯文本截断标签 | **composer 引用 chip**只标对象/选中范围，点击回原文；长文不塞 chip、不再加一个编辑器 |

核心取舍：**能看懂的说明直接渲染；需要执行、批准、采用的东西必须有真实业务身份。** 用户不应该从一大段文字里猜“这只是建议还是已经开始做”，也不应为了复制一段代码去理解我们的组件结构。

## 7. 修复顺序与验收建议（本次不实施）

1. **先定展示语义与一致入口**：完成/中断/过程的助手正文不再各选 renderer；工具 output / 审批 content 保留 Markdown 源文与换行，labels/JSON 单独按原义呈现。D2–D5 的防线建在最早投影边界，覆盖计划 detail、任务 excerpt 的同类入口。
2. **整体采用 Streamdown + code/CJK**：删旧 ReactMarkdown 内核与 `AgentV4Code`，修 D1/D6/D7/D11；保留 Nomi 皮肤/链接/图片策略。不能同时维护“新旧两个 renderer”供不同模型选择。复制必须验证中文字节/缩进/尾行，12 行与 13 行边界需真实点击。
3. **收口产品皮肤**：D8 内外链、D9 任务缩进、D10 图片引用入口、D12 折叠提示、D13 真尾块光标；表格中文宽列纳入同一 token 样张，不写定长中文列宽补丁。
4. **复跑本报告的真实任务作为回归**：全部 28 张暗亮图逐项对账；额外覆盖表格/代码/强调的 token 分片未闭合、长代码横/纵滚动、复制与展开/收起、跨消息脚注与导航、窗口变窄、审批拒绝/确认业务不变。loopback 能证渲染和接线，不能单独证明真实模型自然生成质量；生产 Agent 契约若有改动，再按 R30 加工具写对率/回合成功率。
5. **等 lane 切换合入后另开修复 PR**：从真实最新基线按根因流程实施，风险分层验证。此审计没有 commit/push、没有修生产代码、没有把“审计完成”叫成“问题已解决”。

回放命令（会新建独立临时 profile，零付费）：

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm build
node docs/plan/agent-panel-markdown-evidence/audit.walk.mjs
node docs/plan/agent-panel-markdown-evidence/edge.walk.mjs
```

证据可由 `payloads.json`、两个 harness、主/边界 report 和 observations 复查。截图后所启动 Electron/fixture 均已关闭；只保留隔离 profile 作为审计原始记录。回滚本次交付只需删除新增报告、证据目录和 `AM-LAST.md`，无生产行为变更。
