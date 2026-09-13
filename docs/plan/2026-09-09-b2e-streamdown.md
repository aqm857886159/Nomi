# B2e · Agent 会话统一 Markdown 内核

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现并通过本地验收，PR 交付待评审。用户任务书已批准 Streamdown + code + cjk、沿用 Nomi 皮肤及领域积木；本方案落实该决定。

## 范围与验收

在 feat/agent-panel-form-20260909 继续 B2c/B2d；preflight HEAD 5cd919389，origin/main d3fa25888，基线为祖先。冻结 electron/agentLane、src/workbench/ai/lane、reactFlow。保留批准/拒绝/权限、回答不折等语义。共享 NomiMarkdown 替换内核；收据、过程、审批、计划、任务、错误正文收敛；提示词详情复用。技能库待合入时沿用这个 owner，不新建渲染器。

输入到输出的不变量：Markdown 字符串保留换行和全文，仅由 Streamdown 解析；生命周期状态不改变正文类型；技术 input 保留 pre；业务身份/按钮不由 Markdown 推导。12 行折叠只限用户输入与过程；回答及其中代码不折，代码横向滚动。删除旧 ReactMarkdown/AgentV4Code/自写光标，不留 fallback。

## 先查别人 · R5/R6/R29

现役 npm：streamdown 2.6.0、@streamdown/code 1.1.1、@streamdown/cjk 1.0.3（2026-09-09 实查）。Context7 resolve/query 与 npm 发布包交叉核对，原始记录放 evidence。官方近邻 [AI Elements Message](https://elements.ai-sdk.dev/components/message) 已直接用 Streamdown；Nomi 购买相同正文能力，保留创作工作台的八积木。

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| [核心/GFM/流式/组件映射](https://streamdown.ai/docs/getting-started) | NomiMarkdown 的唯一 Streamdown | 仅 token 组件映射，非解析器 | 无 |
| [code/Shiki/源码复制](https://streamdown.ai/docs/plugins/code) | plugins.code，原生代码控件 | 无代码提取或复制逻辑 | 无，code/pre 不覆盖 |
| [CJK delimiter](https://streamdown.ai/docs/plugins/cjk) | plugins.cjk | 无正则修复 | 无 |
| [caret/流式状态](https://streamdown.ai/docs/configuration) | caret/isAnimating | 宿主只给真实 streaming | 无 |
| [链接、sanitize](https://github.com/vercel/streamdown) | 默认净化，页内/HTTP 链接皮肤 | 图片显式链接，禁止自动远程加载；Electron 开链接边界沿用 | 自定义 a/img 是本地工作台隐私约束 |

### 参考实现逐层对照（九层）

| 层 | 它怎么做 | 我们怎么做 | 判定 |
|---|---|---|---|
| 配置 | README plugins/components | NomiMarkdown | 一致 |
| 模型 | Message 接受已生成文本 | 面板 projection（冻结） | 有意不同：沿用现有 lane |
| 工具 | Message 不执行工具 | receipt 只展示 | 一致 |
| 控制流 | isAnimating/mode | 真实 assistant status | 一致 |
| 会话 | renderer 不持久化 | 持久化仍归 lane | 一致 |
| 提示词 | renderer 不生产提示词 | 本次只展示提示词库内容 | 一致 |
| 扩展 | code/cjk/math/mermaid | code+cjk | 有意不同：09-06 不装数学/Mermaid |
| 安全 | sanitize/harden/linkSafety | sanitize + Nomi 外链/图片适配 | 有意不同：不自动加载远程图片 |
| 观测与测试 | 上游解析/组件测试 | 13 项夹具 + 六出口结构防线 + Electron 双主题 | 一致，增加领域回归 |

### 六角色复核

CTO：共享 owner，删旧内核。设计：token 皮肤、恢复标题层级，回答不折。PM：复制必须回读字节、停止不变源码。前端：不覆盖 code/pre，稳定插件引用。后端：不改 lane/执行授权。真实用户：收据与审批可直接读懂，不再读符号串。

## 验证和回滚

D1–D13 每项具名测试先红后绿；已有 B2a/c/d 回归不变；结构测试禁止指定模型正文字段直接 JSX 输出。Electron 真实会话路径覆盖表格/代码/列表/长文/审批/收据，双主题截图逐张复核，复制读系统剪贴板。完整 pnpm gates exit 0 后才 commit/push 同一分支并追加既有 PR；无绕过 hook。回滚用 revert 本次提交（保留先前分支语义），无需数据迁移。审计原图保留为 before，不覆盖。

若没想到补在哪个阶段前：没有未裁决层；安全及跨消息脚注在接线前明确。

## 实施与走查收据

- 删除直接 react-markdown / remark-gfm 依赖和 AgentV4Code；GFM 由 Streamdown 自带，代码提取/复制/highlight 走 code 插件，CJK 使用官方插件。未装 math/Mermaid。
- 实际现役工具名已是 nomi_document_read/edit；历史审计回放使用旧别名。B2e harness 已更新到现役工具，生产 lane 未改。读文稿结果为 JSON text envelope，projectToolOutput 解出正文，其他元数据保留技术 pre，不凭 Markdown 标记嗅探类型。
- 17 条内核/出口回归覆盖 D1–D13、六出口 AST 防线、跨消息脚注、真实 JSON 包装。初始旧实现 14/14 红；面板扩展回归 195/195 绿（其中 17 条新内核回归）。
- 真 Electron + 生产 UI/IPC/工具 + loopback 模型：表格、带/不带语言代码、三层列表、GFM 任务、中文强调/删除线、脚注、八镜长文、真实读文稿收据、真实待批追加/拒绝、流式停止、过程明细、12 行展开/收起，亮暗各走一遍。模型端点为夹具，不冒充真实供应商；本次不改 Agent/工具契约，付费调用 0。
- 代码复制在系统剪贴板回读 766 字符，中文、缩进、最后换行精确相等，双主题均 match=true。使用 expect.poll 等待异步写入，不读上一份剪贴板假判失败。
- 所有回答及其中代码/表格均不折。用户输入超过 12 个源码行时默认显示首 12 行；过程展开体超过 12 个排版行高度时渐隐提示并给展开按钮，不虚报“剩余多少行”。
- 截图人眼核对：表格为真实表头/数据格；列表缩进分明；CJK 标记消失；H1/H2/H3 使用不同 token；代码高亮保留中文，复制按钮位于独立头栏，不盖内容。暗色内层代码边框补上 Nomi token，避免 Tailwind3 默认继承文字色成为白框。
- 脚注使用每实例前缀隔离；自动引用及显式旧锚点跳转只滚动文档，不改 HashRouter 路由。长回答实际滚动到第八镜与最后检查句，双主题截图确认无折叠。短过程不加渐隐，超过 12 行才出现淡出与展开。
- 历史审计 28 图保持为 before，B2e 新增 36 图另存 b2e-streamdown-evidence，未覆盖历史图。发布包声明归档为 .d.ts.txt，保持上游原文，不把研究原件当项目 TS 编译单元。
- PR #683（B2c/B2d）已由外部合并；本任务分支快进到实际 merge ad95ab47e 后继续。B2e 新 PR 仍使用用户指定同一分支。
- 技能库 #685 尚未合入时，已只读核对 Nomi-skill-ui/src/workbench/skillLibrary/SkillDetail.tsx:31 直接调用 NomiMarkdown；提示词库本次也改同 owner，无第二个内核。
- 走查边界：停止时宿主原有“Agent 暂时不可用”提示仍可见，内容本身不降级；该提示位于本任务冻结的 lane/host 生命周期，未将它记为 renderer 已修项。无效 Markdown 不自行改写成另一份作者文档；数学/Mermaid 按既定范围维持原文/代码。

完整 gates 已在 ad95ab47e 基线上 exit 0：76 项 contracts 阻断项全部通过，Vitest 1324 文件 / 12246 测试通过（2 skipped），runtime 306/306，janitor 13/13，其他运行时/统计检查通过，Vite/Electron 构建通过。日志 /tmp/b2e-gates2.log。推送前 fetch 得到 main 77b8d4c07（#684 画布标签），已无冲突快进；与本任务暂存文件无交集，冻结区没有任务改动。整合后第二次完整 gates 同样 exit 0（/tmp/b2e-gates-integrated.log）：76 项 contracts、12246 条 Vitest、306 条 runtime 与构建全部通过；仅文档 advisory 和构建 chunk size 提醒，无阻断项。

交付证据归档：原始抓取网页/DOM/日志采用 raw-captures.tar.gz 无损保存，逐文件 SHA-256 清单可校验。源码、测试、审计报告与截图仍直接展示。提交钩子 150 KB 文本上限阻断了原始 1.77 MB 采集 diff，因此仅压缩原始采集证据，不压缩任何实现或测试。
