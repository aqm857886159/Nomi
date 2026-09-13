# 顶尖产品一手来源核验

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

检索日期：2026-09-09。只读公开官网；使用 HTTP 和 web-access CDP 读取，无付费对话、未登录产品、未读取用户会话。此文档的「未知」表示本次未找到一手语法/API 保证，不等于不支持。闭源产品不能从外观推出所用 Markdown/高亮库。

## 产品支持证据

| 产品与真实承载面 | 官网明确支持 | 本次不能证明 | 一手 URL |
|---|---|---|---|
| ChatGPT 普通会话 / writing blocks / code blocks | 2026-02-19：Interactive Code Blocks 可行内编辑、会话内预览 diagrams / mini apps、split-screen review；2026-02-27：Code Blocks 图表可导出为图片。2026-06-08：回答中可有交互 bar/line/pie/scatter charts；长文 writing blocks 可全屏、有目录/下载。2026-08-07：从 Google Docs 或其他 ChatGPT 会话粘贴后保留 headings、bold、links、lists，写入和发送后均保留。 | 未找到普通回复 GFM 全兼容承诺；任务列表、脚注、LaTeX 分隔符、Mermaid 语法版本、长代码折叠规则、外链/图片安全策略和使用的库均未知。图示预览不能推断一定是 Mermaid。 | https://help.openai.com/en/articles/6825453-chatgpt-release-notes |
| ChatGPT 历史 Canvas（与普通会话区分） | 官方 2024-10-03 发布为独立写作/编码工作区；但当前 release notes 2026-05-28 明确：GPT-5.5 Instant/Thinking 不再提供 Canvas，写作和编码功能直接进入会话的 writing/code blocks；付费旧模型暂留。 | 不能把 2024 Canvas 页面当作当下所有模型共同的会话契约。原 Canvas 帮助页 9930697 已返回「page doesn't exist」，不作有效来源。 | https://openai.com/index/introducing-canvas/ ；https://help.openai.com/en/articles/6825453-chatgpt-release-notes |
| Claude（产品 Artifacts；不能冒充桌面普通气泡） | 官方枚举 Documents (Markdown or plain text)、code snippets、single-page HTML、SVG、diagrams/flowcharts、interactive React components；支持独立 artifact window、代码查看、copy、download、版本切换；Markdown 文档支持选中文本就地修改。 | 未找到 Claude Desktop 普通会话独立的完整语法兼容矩阵；Artifact 的 diagram 能力不能推出普通 Markdown fenced mermaid 自动渲染；任务列表/脚注/长代码折叠/高亮库/URL 安全策略未知。 | https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them |
| Claude 数学能力 | 官方只明确可处理数学方程与计算。 | 该页没有 LaTeX / KaTeX 渲染承诺，不能拿模型数学能力当作渲染库证据。 | https://support.claude.com/en/articles/10366421-how-does-claude-handle-mathematical-equations-and-calculations |
| Cursor Agent 会话 | 官方 Agent overview 明确生成图片 shown inline in chat；1.3.4 changelog 明写 fixed markdown parsing，可确认存在 Markdown 解析；1.2 引入 Agent to-dos（独立计划状态，非 GFM 任务列表证明）。 | 未在此次一手材料中定位表格/三级列表/脚注/KaTeX/Mermaid 的明确支持面或 renderer 栈；不据论坛猜内部库，也不把编辑器 Markdown preview 当 Agent 会话。 | https://cursor.com/docs/agent/overview ；https://cursor.com/changelog/1-3 ；https://cursor.com/changelog/1-2 |
| Claude Code（终端，不是 Claude Desktop） | interactive-mode 官方文档：/theme 内 Ctrl+T 控制 Claude responses 的 code blocks syntax coloring；/btw 的 c 将回答以 raw Markdown 复制，避免鼠标选中终端 hard-wrapped 文本；Ctrl+O transcript 可展开工具输出。 | 文档未在此承诺 DOM 表格、图片、数学、Mermaid 渲染；终端样式不能作为桌面 Web 渲染验收标杆；代码高亮内部实现未知。内建 task list 也不能当作 GFM checkbox 语法支持。 | https://code.claude.com/docs/en/interactive-mode |

## 能力比较时可直接引用的判定

| 能力 | 顶尖产品一手证据结论 |
|---|---|
| Markdown / headings / emphasis / links / lists | Cursor 明确 Markdown parsing；ChatGPT 明确保留 headings/bold/links/lists。不能扩大成完整 CommonMark/GFM 合规认证。 |
| GFM tables / checkbox / footnote | 这轮公开产品资料没有找到完整语法保证；应由开源组件规格 + Nomi 真机夹具证明，不编造「四家全支持」。ChatGPT 数据分析 expandable tables 是结构化表格能力，不等同 GFM pipe-table 支持声明。 |
| code / syntax color / copy | ChatGPT interactive code block；Claude Artifacts copy/download；Claude Code 响应代码 syntax coloring 有明确一手证据。没有一家官网在本次页面披露 Shiki 或 highlight.js。 |
| math | Claude 数学页只谈计算；ChatGPT 交互学习是产品能力而非 LaTeX parser spec。兼容分隔符/宏与所用 KaTeX 应从拟采用库证明。 |
| Mermaid | ChatGPT 与 Claude 确有 diagram 产品形态，未找到这轮页面的 Mermaid 语法合同；不要标记为已验证 Mermaid。 |
| image / external link | Cursor 明确 inline image；ChatGPT 明确保留 link。图片网络隐私/外链允许协议/sanitization 策略本轮未知；Nomi 自行订最小安全边界。 |
| long content | ChatGPT 长 writing blocks 有 full-screen/TOC/download；Claude 大型可复用内容入 artifact window；Claude Code transcript 可展开。结论是给长内容独立承载/导航，不是强制所有长回答自动折叠。 |

## 关键原文摘录（已读官网正文）

- OpenAI release notes，2026-02-19： “Write and edit text in-line”; “Preview diagrams and mini apps directly in chat”; “Review code in split-screen views”.
- OpenAI release notes，2026-05-28： “Writing and coding functionality is now supported directly in chat responses through writing blocks and code blocks.”
- OpenAI release notes，2026-06-08： “Conversations longer than five responses can now include a table of contents”; “Longer writing can now open in a focused full-screen editor.”
- Claude Artifacts： “Documents (Markdown or plain text)”; “Diagrams and flowcharts”; “Copy content to your clipboard, including the code behind an artifact”.
- Cursor 1.3： “1.3.4: Fixed markdown parsing”.
- Cursor Agent overview： “Images are saved to your project's assets/ folder by default and shown inline in chat.”
- Claude Code interactive mode： “Controls whether code in Claude’s responses uses syntax coloring”; “Copy the answer to your clipboard as raw Markdown”.

## 对 Nomi 的采用结论

这些闭源产品提供的是体验参照，不是可复用 renderer 依赖清单。买不造的可执行对象应是 Streamdown / AI Elements 或 react-markdown 插件生态；选择由其官方版本/API/许可证、React 18 与 Tailwind 3 兼容性、流式不闭合输入夹具、现有 Nomi 媒体/链接桥接契约决定。保持 Nomi token 皮肤，不抄一套通用 parser/highlighter。普通说明仍用 Markdown；可执行计划、审批、工具回执必须保留各自状态语义，不能一律降格成长文。
