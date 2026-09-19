# B1 lane 上下文契约 · 先查别人（2026-09-09）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：B1 九条已按六簇提交；B1-finish 获准本地合并 main，完整 gates 与推送待验证。

公开官方页面已实际读取；网页副本在 `/tmp/nomi-b1-public-research/`。未规定表示本次查到的一手材料没有该精确规则，不能标成产品已有行为，也不能算「有意不同」。API/Apps SDK 证据明确标明，不能偷换成封闭产品内部实现。

## 先查别人
- CC-I https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works （已通过独立后台 tab 读取）
- CC-M https://code.claude.com/docs/en/mcp （同上）
- CX-F https://developers.openai.com/codex/cli/features （已读取；CLI supports “Steer the active turn”）
- CX-S https://developers.openai.com/codex/agent-approvals-security （已读取；明确 approval policy / permission profiles / execution outcomes）
- CX-T https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs （raw 已读取）
- CU-A https://cursor.com/docs/agent/overview （已读取）
- CU-M https://cursor.com/docs/context/mcp （已读取）
- GPT-A https://help.openai.com/en/articles/11752874-chatgpt-agent （独立后台 tab 已读取）
- GPT-R https://developers.openai.com/apps-sdk/reference （已读取；是 ChatGPT Apps SDK，不代表普通聊天内部实现）
- OA-F https://developers.openai.com/api/docs/guides/function-calling （已读取；是 API 最佳实践）
- OA-S https://developers.openai.com/api/docs/guides/steering （已读取；是 Responses API，不偷换成 Codex CLI）

## 九条 × 五产品证据表

| 条目 | Claude Code | Codex CLI | Cursor | ChatGPT  pi SDK（实际安装 @earendil-works） |
|---|---|---|---|---|---|
| C19 可用工具告知 | [CC-M](https://code.claude.com/docs/en/mcp)：ToolSearch 按需加载；`alwaysLoad:true` 的 MCP server tools 在 session start 常驻。没有三段文字规定。 | [CX-T](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs)：tool search handler 返回发现工具；[CX-F](https://developers.openai.com/codex/cli/features)：先 inspect available MCP tools。没有三段文字规定。 | [CU-A](https://cursor.com/docs/agent/overview) Tools、[CU-M](https://cursor.com/docs/context/mcp) Using MCP：Agent 按相关性调用可用工具；可禁用 server。没有三段文字规定。 | [GPT-A](https://help.openai.com/en/articles/11752874-chatgpt-agent) App controls：只能访问 workspace enabled apps；[GPT-R](https://developers.openai.com/apps-sdk/reference) 工具 title/description/schema；没有三段文字规定。  pi-coding-agent/dist/core/system-prompt.js:41–48：实际 tools 生成菜单；laneNativeAssembly 沿用 active tools。 |
| C26 合法参数示例与纠错 | [CC-M](https://code.claude.com/docs/en/mcp) 暴露工具 schema；本次材料未规定 validation error 必附示例。 | [CX-T](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs) 使用 schema 描述工具；[OA-F](https://developers.openai.com/api/docs/guides/function-calling)（API 参考）建议参数描述与示例。CLI 错误附最小示例未规定。 | [CU-M](https://cursor.com/docs/context/mcp) 可展开调用参数；错误回示例未规定。 | [OA-F](https://developers.openai.com/api/docs/guides/function-calling)（API 参考）建议详细 function/parameter descriptions 与 examples、结构化参数；ChatGPT 产品错误附例未规定。  pi-agent-core/dist/harness/execution/tools.js:19–36：prepare 后 AJV，不合法返回 tool error；描述示例属于宿主。 |
| C27 审批可见性 | [CC-M](https://code.claude.com/docs/en/mcp)：第三方 MCP 工具按权限处理；本次材料未规定模型文本必须声明 undoable。 | [CX-S](https://developers.openai.com/codex/agent-approvals-security)：策略/沙盒与审批边界明确，批准后再执行；模型文案尾句未规定。 | [CU-M](https://cursor.com/docs/context/mcp) Tool approval：默认 MCP tools 执行前确认，可点箭头查看 arguments。 | [GPT-A](https://help.openai.com/en/articles/11752874-chatgpt-agent)：high-impact actions 用户确认；[GPT-R](https://developers.openai.com/apps-sdk/reference) annotations 描述工具读写/破坏属性供模型理解。无“所有直接动作都可撤销”保证。  pi-agent-core/dist/harness/hooks.js:40：before_tool 拦截；审批由扩展/宿主负责（docs/extensions.md permission 示例）。 |
| C28 宿主能力过滤 | [CC-M](https://code.claude.com/docs/en/mcp) tool search/deferred/alwaysLoad 区分可用工具；支持性模型才可 tool_reference。具体某工具 action enum 裁剪未规定。 | [CX-T](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs) discovery 只返回可调用工具；特定宿主 enum 裁剪未规定。 | [CU-M](https://cursor.com/docs/context/mcp)：disabled servers won't load or appear in chat。具体 action enum 裁剪未规定。 | [GPT-A](https://help.openai.com/en/articles/11752874-chatgpt-agent)：disabled workspace apps 不可使用；[GPT-R](https://developers.openai.com/apps-sdk/reference) visibility 控制工具用途。具体 action enum 裁剪未规定。  pi-agent-core/dist/harness/execution/tools.js:21：工具必须存在于本次可用集合；enum 属于公开 schema。 |
| C29 摘要默认/渐进上下文 | [CC-M](https://code.claude.com/docs/en/mcp)：工具按需发现以避免 schema 挤占上下文；alwaysLoad 应仅少数工具。业务 context 4 KB/head 截断未规定。 | [CX-T](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs) 工具按搜索加载；4 KB 和保头未规定。 | [CU-A](https://cursor.com/docs/agent/overview)：codebase/web search 获取相关信息；具体 4 KB/full scope 未规定。 | [GPT-R](https://developers.openai.com/apps-sdk/reference) content/structuredContent 与隐藏 `_meta` 分离；默认 4 KB/保头未规定。  pi-coding-agent/dist/core/tools/truncate.js:44–81：truncateHead 超长首行回空；原稿已存在，Nomi 必须保留部分首行。 |
| C42 运行中消息 | [CC-I](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)：Enter 将消息列在输入框上方；若 tool calls 运行，结束后同一 turn 送达；Esc 中断并立刻发送已排消息。即安全边界 steer 语义，不是等整项任务。 | [CX-F](https://developers.openai.com/codex/cli/features) 明确 active turn steer，但本次 CLI 页面未给 Enter/Tab 的精确映射；[OA-S](https://developers.openai.com/api/docs/guides/steering) API 另有 steer accepted/pending/failed 协议，不能当 CLI 快捷键证据。 | [CU-A](https://cursor.com/docs/agent/overview)：新 Web Agents Send now 或 Enter twice 在下一 tool call 送达，Tab 排到 turn 后；CLI Enter 安全边界 steer，再 Enter interrupt。旧 editor 段落仍写 Enter queue、Cmd/Ctrl+Enter immediate；须区分宿主。 | [GPT-A](https://help.openai.com/en/articles/11752874-chatgpt-agent)：可 guided or interrupted mid-task，必要时暂停求确认。该官方文档不支持“一律只能停止后发”的断言；普通 ChatGPT composer 的精确发消息行为未核实。  pi-agent-core/dist/harness/runtime/drive/boundary.js:29–48：steer 优先，followUp 在无 trigger 才消费；沿用原生队列。 |
| C43 内部 id 正文分离 | 本次公开材料未规定隐藏所有内部 id；[CC-M](https://code.claude.com/docs/en/mcp) 工具结构化协议仍需标识。 | [CX-T](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/tool_search.rs) 内部工具/调用身份属于协议；未规定所有正文 id 隐藏。 | [CU-M](https://cursor.com/docs/context/mcp) arguments 可见，未规定隐藏所有内部 id。 | [GPT-R](https://developers.openai.com/apps-sdk/reference)：content/structuredContent 面向模型与组件；`_meta` 仅组件可见且不进 transcript。最接近“正文讲结果、内部映射结构化”模式；没有规定 Nomi 的 details 字段。  pi-agent-core/dist/harness/runtime/drive/tools.js:284–291：content/details 分开；details 是宿主数据，后续编辑由 read 获取当前引用。 |
| C45 不给 Agent 全局预算 | [CC-M](https://code.claude.com/docs/en/mcp) 有 context-window 占用阈值，不是金额预算；无把用户文字金额变成硬上限依据。 | [CX-S](https://developers.openai.com/codex/agent-approvals-security) 执行权限与审批显式；本次未发现把文稿金额当硬上限的规则。 | [CU-A](https://cursor.com/docs/agent/overview) 明说 tool calls 次数无上限（不是金额授权）；文稿金额不是预算的精确规则未规定。 | [GPT-A](https://help.openai.com/en/articles/11752874-chatgpt-agent) 官方列套餐消息/credits 限制，属于账户事实；没有从文稿数字推断金额上限的依据。  pi-coding-agent/README.md:156：状态栏显示真实 usage/cost；未规定业务全局金额上限注入。 |
| C47 按问题简洁答复 | [CC-I](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works) 支持可调 effort/模式，本次未发现只读 ≤3 行硬规定。 | 本次材料未发现统一 ≤3 行硬规定。 | [CU-A](https://cursor.com/docs/agent/overview) 未规定统一 ≤3 行。 | [GPT-R](https://developers.openai.com/apps-sdk/reference) widgetDescription 减少 redundant assistant narration；统一 ≤3 行未规定。  pi-coding-agent/dist/core/system-prompt.js:78：Be concise in your responses；没有字数硬闸。 |

## C42 原文（必须纠正任务书预设）

Claude Code：
> Type a message and press Enter while Claude is working. Claude Code queues the message instead of interrupting the turn, and lists the queued entries above the input box until it sends them.
> if you queue a message while Claude is running tool calls, Claude Code passes it to Claude as soon as those tool calls finish, within the same turn.
> Press Esc to interrupt the turn instead. Claude Code keeps what you queued and sends it right away.

Cursor 新 Agent 窗口：
> The message is delivered at the agent's next tool call instead of cutting off work mid-action, which preserves in-flight work and keeps the agent on task.
> Press Tab to queue the message for after the turn instead.

Cursor CLI：
> pressing Enter while the agent works steers the active run at a safe boundary, and pressing Enter again interrupts the turn.

ChatGPT agent：
> Agent mode ... can be guided or interrupted mid-task.
因此“ChatGPT 停止后发”仅能作为用户指定对照场景，不能写为已核实全产品限制。

## 推荐通用规则

默认将运行中普通用户消息作为 next safe boundary steering；仅用户明确选择次级队列手势才 follow-up。审批待决时取消当前未授权动作并立刻使用户新消息可见（Nomi 审批领域约束，邻居原理一致；未核实邻居逐事件实现）。不能声称所有厂商默认键位完全相同。

工具契约应同时给模型真实可调用范围、最小合法输入和真实审批后果；展示结果的正文与内部索引结构化分离；按需加载上下文，超长首行也保留信息；费用只引用真实报价与目录，不能从创作文稿推断预算。这些可标“与已证实公开原则一致；具体实现为本产品参数化”，不要把缺乏产品细则说成“有意不同”。

## 我们的规则与裁决

所有 pi 路径相对 `node_modules/@earendil-works/`。任务书旧包名 `@mariozechner` 在当前依赖树不存在，不虚构路径。公开文档未规定的精确字句，不当作竞品事实。

| 簇 | 我们的通用规则 | 裁决 | 根因一句 / owner / 红绿夹具 |
|---|---|---|---|
| C19 | 明示常驻、当前新增、退休三段，常驻始终可调 | 一致：实际工具集可发现 | 菜单把增量冒充全集；native assembly；真实 harness 切组→读常驻 |
| C26 | 合法 candidate 示例由同一常量供描述和校验失败消息使用 | 一致：schema+可行动错误 | 严格校验未提供纠错形状；模型消息出口；真人首失败实参重放 |
| C27 | 每回合从现役审批判据投影当前操作权限，实际 auto grant 成功才附可撤销收据 | 一致：权限与执行后果显式 | 决定未投影；审批 gate/host；切策略、写入、失败/只读不谎报撤销 |
| C28 | lane schema 只列宿主实现的 operations，外部 MCP 保留 preview | 一致：只广告可执行能力 | 描述与能力不匹配；canonical schema factory；模型 enum+外部解析 |
| C29 | context 默认 taskKind 摘要≤4KB，显式 scope full；超长首行保留 UTF-8 头 | 有意不同：视频目录约246KB单行，上游整行截断会消除所有可用上下文；原稿已有不能再复制输出文件 | 无界 JSON×整行截断；lane context/output；246KB与中文长首行 |
| C42 | 普通消息默认下一安全边界 steer，先记录用户原话再解除审批；follow-up 仅显式次级手势 | 一致：采用三产品与 pi 的安全边界 steer，不自建队列 | 宿主运行态分派和审批唤醒脱节；host+composer intent；转录用户 entry 在下一 assistant 前 |
| C43 | 写收据正文讲结果，id 在 details；后续改动先读当前对象，以标题向用户表述 | 一致：content 与内部结构分离 | 机器引用混正文；canvas receipts+prompt；正文无内部 id、details 保留 |
| C45 | 不投影全局金额预算；原稿保留原样但不作授权；费用只引用报价卡/目录单价，不知则提交时显示报价 | 一致：权限来自宿主显式事实，文稿不是系统权限 | 原稿金额被提升为权限；desktop input+prompt；¥8文稿不变、设置上限无注入 |
| C47 | 回答长度随问题，只读/收尾≤3行、不复述清单；用真实样本观察 | 一致：concise，长度是领域提示而非字数门岗 | 缺少输出密度引导；system prompt；提示词夹具+R30 |

有意不同共 1 条（小于 2）；其他为公开原则一致的领域参数化，不声称竞品逐字采用本规则。

## 边界与交付

沿用当前工作树改动，不改 storyboard schema 和 B3 数据层，不接报价卡、不改设置页（B4），不打包。无需新增架构或协议；复用 pi hook/队列与现役 JSON Schema。九条修在模型契约投影层，不改供应商分支。
每簇红→绿保存在 `agent-lane-b1-evidence/`。旧红日志保留；C45 新裁决另跑 red。正常 gates/hook 后只推现有分支、不新建 PR。回滚为本批 scoped commit 的 revert，不迁移历史数据。
当前 `HEAD...origin/main` 为 77/66，任务书禁并 main；完整 gates 新鲜基线闸可能阻断，必须如实保留，不伪造 CI=true、不改门岗。

C42 次级入口：运行时 Alt+Enter 明确 follow-up，普通 Enter/发送为 steer；空闲仍新回合。不加文字按钮，不改布局。按设计系统 §1.5.2，快捷键是加速器不占控件层级。沿现有 textarea→resident submit→actions.send→laneClient.say 单链传递。

## B1-finish 本地并线裁决（2026-09-09）

用户本轮明确授权在原分支合并 main，取代上文旧任务的“不合 main”。接手 HEAD `298ef6055`；B1 六簇为 `62281739c` / `828cdf28c` / `c784e3916` / `e5d28cc56` / `06fcd8812` / `5f2c43b52`。并入 `origin/main` = `2baa00d5e6edb146f8dfe9dc48aca8f766c09444`，merge-base = `7f6d224bb86ba2da4fb350670aa1df9c2002eed4`；不根据两点删除视图恢复旧运行时。

| 冲突文件 | 取舍与保留的不变量 |
|---|---|
| `docs/lessons/INDEX.md` | 两条新教训均保留，各指向原文件。 |
| `scripts/vocabularies-baseline.json` | 合并独立新增登记；SoundStage 同一 owner 在两边不同位置重复新增，仅保留原有一条；保留 stage4 已收敛的 timeout owner 与 debtCap 71，不恢复已退役 owner。 |
| `tests/ux/g1/c0-plan-sample-budget.mjs` | 复用同一报价/预留入口，显式 planOnly 保持 ¥2，mixed 保持上游 ¥3；保留上游有限正数/输出上限/失败不退预留校验及 Request headers/signal 转发。 |
| `tests/ux/g1/c0-real-main.mjs` | 保留上游凭据保护、transport evidence 与统一 dispatch wrapper；planOnly 优先进入只准文本的预算边界，不能因 mixed 标记进入合成或真实媒体分支。 |
| `tests/ux/g1/c0-real-scheduler.mjs` | 保留 planOnly 参数、累计实验账本、模型档位计数与原生转录评分；合入 mixed、credential watch、生命周期证据与视频等待报价；planOnly 不受 mixed 环境变量扩大权限。阶段 02 等待沿用上游 stationTimeout，未恢复退役 agent 事件读取器。 |
| `tests/ux/g1/c0-short-film.walk.mjs` | 保留 plan-only/output-dir/模型参数及阶段 02 后结束的分支；合入上游 planner terminal 等待、视频 waitForVideos、导出完成信号、凭据阻塞处理。 |

自动合并复核：`c0-real-budget.node-test.mjs` 中 mixed 夹具被 Git 混入 planOnly 键，移除该错误组合；另加明确 planOnly 回归，验证 ¥2 上限与同时出现 mixed 标记时仍拒绝媒体。上游原有 mixed 测试保持 ¥3 与合成媒体行为。生产 B1 九条代码无并线冲突、未改语义。

验证：零额度预算/dispatch、mixed、视频等待与合成夹具初轮 32/32；新增 planOnly 回归后 33/33 通过。完整 gates 收据见本工作树 `.tmp/b1-finish/`；未重新打包，未新增真实模型调用。

## 并线 13bd6a73a

范围：原分支合入 #680，不恢复已删运行时，不打包、不新增 PR。回滚使用 merge revert，不改历史数据。验收为指定 ai/v4、ai/lane、resident 测试与完整 gates，再正常 hooks 推送。

| 冲突 | 裁决 |
|---|---|
| agentPanelV4Projection.ts | 保持删除；实际上游差异是撤销能力判据及 token 格式化，迁到 laneViewModel / useAgentPanelV4Data；镜头标题/模型档位时长画幅已自动合入 residentExceptionProjections→shotPresentation，继续由现役介入槽消费。 |
| agentPanelV4Projection.test.ts | 保持删除；新增 lane 层机制回归承接 token、撤销与 lane 待决→镜头审批链，保留 resident 的 C05 两类输入测试。 |
| residentToolDisplay.ts | 同时保留主线分镜计划名称与 #680 operation 工具名称，计划写入判据先于通用 create_canvas_nodes。 |
| AgentPanelV4Cards.tsx | 保留主线技术详情渐进展开；镜头参数副行按 #680 常显，技术详情与副行分别承载；保留 #680 队列取消图标与可访问名称、重复行 index key。 |

根因分类 recurring：旧运行时删除后，上游展示不变量可能落在退役投影而漏入现役链。已分别检查 lane 收据、lane 待决审批和用量宿主入口，沿现役共享 owner 移植；更新 #680 v3 合同路径，不引入依赖或协议变化。

并线验证补充：完整测试暴露旧 `c0-plan-sample-budget.test.mjs` 夹具未随之前 main 合并声明报价输出上限与 `planOnly`；补齐事实字段及显式模式，仍验证原 ¥2 边界，不放宽生产校验。卡片技术详情回归改为 `technical`，并同时断言参数副行存在。
提交粒度：pre-commit 首次 staged diff 158331 bytes 超 150000 限额，正常拆出 lane 撤销/token 两文件后评审通过；未绕过 hook。

完整门岗第二项发现：stage4 迁移改变了 10 处 E2E 等待的语义指纹，并留下 14 条退役等待登记。根因是等待仍内嵌常量而未走 main 的共享 station budget；仅把这 10 处接到 `stationTimeout({ operations: 2 })`（仍为 30 秒安全上限，完成仍由原状态断言判断），删除失效登记，不新增债、不扩大超时。

交付粒度调整：pre-push 对每个尚未远达的 merge 使用 dense combined diff；原 `453c300b1` 为 182065 bytes、本次 `56a20db14` 为 224596 bytes，均超过 150000，单纯按原 merge SHA 分批仍无法过闸。保留本地 tip 备份和六簇 B1 原提交，把两笔未推送 merge 的部分合并结果延到紧邻小提交，所有 commit/push 正常 hooks；最终以 tree SHA 相等验明文件内容未变，远端只快进。完成后重新跑完整 gates。

### 再并线 f708568df（#682）

第三轮 fresh-base 检出 main 前进，按任务书再次合入。`electron/i18n.ts` 同时保留 lane 旧记录说明和 main 凭据验证四条文案（中英均保留）；`availableModels.ts` 保留 lane 的 text/chat、image、imageEdit、video、image_to_video 五路目录，汇总后使用 main 的供应商偏好排序。沿现有共享 owner，不恢复旧运行时、不丢模型模式。
