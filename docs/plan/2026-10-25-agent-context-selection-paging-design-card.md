# Agent 上下文选区分页设计卡（#1263-r3）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：AgentContextSnapshot 投影与 `read_selection` 分页读口  
线/负责人：修复线  
类别：[其他][Agent 行为][大数据量 / 长列表][新增功能 / 性能]

## ★0 先查别人

- [MCP Pagination 规范](https://modelcontextprotocol.io/specification/latest/server/utilities/pagination)：服务端用不透明 cursor，页大小由服务端决定；有结果时可给 `nextCursor`，缺省即结束；客户端只能原样回传 cursor，不能解析或改写；坏 cursor 应按 Invalid params 报错。**确认的决定**：`read_selection` 不暴露页码或 pageSize，模型只回传上页 `nextCursor`；最后一页省略 `nextCursor`；游标绑定发送时快照和 `kind` 过滤，坏游标 fail-closed。**有意不同**：内部桌面 lane 没有 MCP JSON-RPC 层，因此错误码用 lane 的机器可读 `selection_cursor_invalid`，不伪装成 `-32602`；cursor 不能跨消息/重启，因为它指向本条消息随附的不可变快照，这是选区语义的领域约束。
- [Anthropic 的工具设计文章](https://www.anthropic.com/engineering/writing-tools-for-agents)：工具应少而边界清晰；返回高信号字段；用分页、范围、过滤或截断控制 token；截断和参数错误都要给下一步；描述、schema、示例要明确；用至少 20 条真实用户任务做评估并记录工具调用、错误和 token。**改变的决定**：只增加一个职责单一的 `read_selection`，返回已有投影行形状、`total` 和可继续的 cursor；错误分别说明「无快照」或「cursor 不属于本消息」及可执行下一步；量具补 20 条自然说法并把“调了新动词 / 调了 `look_at_canvas` / 都没调”分档。
- [pi 工具参考实现与本地源码**逐层**：[一致性报告](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md#工具)、[上下文层](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md#上下文)、`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js`、`truncate.js`、`examples/extensions/truncated-tool.ts`。内置 `read` 明确写出 `offset/limit`，用 2000 行 / 50KB 上限，截断时告诉模型下一 offset；扩展示例把截断元数据放 `details`，正文告诉模型如何继续。**改变的决定**：沿用“结果有硬上限 + 正文带 continuation + details 保留结构化事实”的分层；我们的页以 6000 字符预算适配发送时快照，使用 opaque `nextCursor` 而不是文件行 offset，因为只能读取同一条消息的句柄，不能暴露文件系统路径。
- [OpenAI Agents SDK 的官方 context / tool 结果资料](https://openai.github.io/openai-agents-python/context/、https://openai.github.io/openai-agents-python/ref/extensions/tool_output_trimmer/)：应用本地 context 只给工具代码，不自动送给模型；工具结果可在模型调用前按最近回合和工具名裁剪，模型可见结果与本地元数据分离。**确认的决定**：完整 `contextSnapshot` 留在 Host 当前输入对象，`read_selection` 执行时从已消费消息 context 取同一对象；模型只能通过工具看到分页后的行，不能从实时 UI 状态重建；`details` 与模型可见 JSON 分离。

### R5.4 pi 参考实现逐层对照

| 层 | pi 参考做法 | 本次实现 | 判定 |
|---|---|---|---|
| 工具 | 声明 name/description/schema/execute，读工具写清 offset/limit 与继续方式 | `VERB_DECLARATIONS` 唯一声明，`read_selection` 的 does/useWhen/notWhen/params/examples 与严格 schema | 一致 |
| 转录渲染 | tool call 与 tool result 按 id 配对；结果正文与 details 分离 | 沿用 lane 的 tool-call/tool-result；正文为一页 JSON，details 同页结构 | 一致 |
| 会话 | 会话持久化消息与工具结果；游标可继续 | 只允许同一条当前输入消息继续；不把 cursor 持久化或跨消息复用 | 有意不同：选区快照是发送瞬间事实，跨消息继续会读错用户选区 |
| 上下文 | compaction 在回合内量上下文；大工具结果可 trim | 投影先在 6000 字符内列全，否则零句柄并给账；每页仍受同一输出上限 | 有意不同：快照句柄需要完整/分页可恢复，不能只保留摘要 |
| 模型与花费 | 读工具本身不花费；工具输出计入上下文 | 只读、无外部调用；页大小由 Host 约束 | 一致 |
| 控制流 | tool execute 可中断；错误让模型可自纠 | 失败抛结构化 lane 错误，下一步要求无 cursor 重读或换正确 cursor | 一致 |
| 扩展 API | 自定义工具通过注册 API 加入工具面 | 只从 `VERB_DECLARATIONS` 投影，内部 profile 才装配到 desktop lane | 一致 |
| 观测与测试 | 结果截断有 details，评估看工具调用与错误 | 量具分三类工具路径；20+ 用户句子；分页单测、变异、perf 场景 | 一致 |
| 安全 | 读工具遵守 cwd / 权限边界，失败不猜 | 只读当前 Host 输入的冻结快照；无快照/坏 cursor 不读实时状态、不猜 | 有意不同：领域数据不是文件，边界是消息快照身份 |

“没想到”清单：空。读完上述文档和本地参考实现后，新增设计没有发现还需要另建的会话、文件或 MCP 暴露面。

### R5.5 标准对齐

| 规范链接 | 我们的偏差 | 偏差理由（只认领域约束） |
|---|---|---|
| MCP Pagination：opaque cursor | cursor 由本地实现编码并在 Host 内校验 | 模型只接触并原样回传；校验必须知道它是否属于当前消息快照，不能把跨消息 cursor 当有效 |
| MCP Pagination：server 决定 page size | 不提供 pageSize 参数，按 6000 字符预算动态决定页大小 | 句柄标题、定位器长度不一，固定条数无法保证现有模型输出上限 |
| MCP Pagination：缺 `nextCursor` 表示结束 | 保持不变 | 无领域偏差 |
| MCP Pagination：坏 cursor Invalid params | lane 错误码为 `selection_cursor_invalid`，而非 JSON-RPC `-32602` | 该动词只进 desktop internal profile，没有 MCP dispatcher；仍提供机器可读错误和可执行下一步 |
| MCP Pagination：不跨会话保存 cursor | 不持久化 cursor，只接受当前已消费消息的 cursor | 快照是发送瞬间的选区，跨消息/重启会把新旧选区混为一谈 |
| pi `read`：offset/limit + continuation | 使用 opaque cursor + 可选 kind 过滤 | 句柄不是文件行；`kind` 是用户选区的领域过滤，offset 会暴露并固定实现细节 |
| pi：50KB/2000 行工具结果上限 | 页面预算收紧到 6000 字符 | 本项目发送时快照已有 6000 字符硬预算，必须让投影和读页共享 KV/cache 边界 |

## ★1 用户怎么用

当创作者框选一批节点、片段或文稿锚点后发送请求，我想让 Agent 处理**发送那一刻**的整批选区；如果上下文块写了 `omitted > 0`，Agent 调 `read_selection`，从头或用上页 `nextCursor` 继续读，直到最后一页没有 `nextCursor`，再按快照句柄做事。步骤：

1. 用户在画布 / 时间轴 / 文稿上选择对象。
2. 输入真实请求并发送；Host 冻结并附上这一刻的 `contextSnapshot`。
3. 投影能列全就列全；放不下则列 0 行，给 `total`、`omittedByKind` 和固定 `omittedNote`。
4. Agent 看到 omitted 后调用 `read_selection({})`，之后先用常驻 `nomi_request_tools({group:"context"})` 解锁 context 组（若 `read_selection` 尚未列出），再原样回传每页 `nextCursor`。
5. 需要时用 `kind` 过滤，但仍从头开始；每页按原快照顺序、不重不漏。
6. 读完后再调用领域读/写动词；发送后 UI 选择改变不影响这次快照。

不做：不改快照生产方、版本号、实时 `look_at_canvas`、输入框 chip；不把快照暴露到 MCP 或其它没有消息快照的面；不猜坏 cursor 或缺失快照。已知坑：模型可能忽略 omitted；真模型付费抽样由协调执行，零花费演练只证明步骤可走。

真实任务与 ≥20 句量具输入（写入 `tests/ux/look-at-canvas-selection-real.*`）：

1. “把我选中的这些镜头都改成夜景。”
2. “逐个说出我刚才框选的镜头标题。”
3. “我选中的视频里，哪些是夜景？”
4. “给这批片段统一加字幕。”
5. “只处理我选中的画布节点。”
6. “把选中的镜头按顺序列出来。”
7. “这次发送时我到底选了多少个？”
8. “把选区里的视频和图片分开说。”
9. “只告诉我选中的前三个标题。”（只读少数的反例）
10. “看当前画布，不看发送时选区。”（应走 `look_at_canvas` 的反例）
11. “时间轴上我勾的片段总时长是多少？”
12. “把文稿选中的段落拆成镜头。”
13. “我刚才 @ 的参考分别是什么？”
14. “先不要改，确认这批选区里有没有音频。”
15. “按我发送那一刻的选择生成一个清单。”
16. “我发送后又换了选择，仍按刚才那一批回答。”
17. “读完所有选中的片段，再告诉我最短的一个。”
18. “只读画布选区，不要读实时画布。”
19. “选区太大时告诉我总数和还没读到的部分。”
20. “继续读取上一页的选区。”
21. “这条消息没有选区时不要猜，告诉我怎么继续。”
22. “游标失效时从第一页重新读。”

主指标：静默缺失率 = 0（投影账本 + census）；分页完整率 = 100%（分页单测与 census）；Agent 工具路径分布分别记录 `read_selection`、`look_at_canvas`、无读工具三档（量具 `tests/ux/look-at-canvas-selection-real.*`）；真模型回答正确率待协调付费抽样。护栏：投影 / 每页 ≤6000 字符、JSON 合法、同一快照投影文本稳定、坏 cursor/缺快照不读实时状态（vitest）。

## ★1b 连带界面

模型可见：投影账的固定英文 `omittedNote`、`omittedByKind` 中的 `read_selection`、分页 JSON 的 `total/handles/nextCursor`。工具失败正文必须同时包含机器码对应的可执行下一步：无快照 → 从 desktop Agent 重新发送；坏 cursor → 不带 cursor 重新读第一页；未列出工具 → 先请求 context 组。渲染层只读 `projectAgentContextSnapshot` 的事实，chip 仍不在本 PR 范围。

## ★2 谁说了算

概念 `agent.context-snapshot-projection` 的 owner 仍是 `electron/shared/agentContextSnapshot.ts:projectAgentContextSnapshot`；新增同一 owner 文件里的 `readAgentContextSnapshotPage` 作为快照读口。唯一事实是 Host 当前已消费输入的 `contextSnapshot` 对象；`laneDesktopTools` 通过 `input.context().contextSnapshot` 读取，不能从实时 renderer/UI 推导。投影、分页和测试共享 `compactHandle` 行形状；没有第二份快照。门表由 `node scripts/door-map.mjs` 生成并在报告登记，新增 lane 注册门与声明/注册表门；只允许 desktop internal profile；为守住现有 12 工具 / 10000 token 门槛，read_selection 延迟在 `context` 组，由常驻 `nomi_request_tools` 解锁。

## ★3 一致与复用

复用 `compactText`、`compactLocator`、`compactHandle`、`PROJECTION_LADDER`、6000 字符上限和 lane 的 `bindLaneTool` / `LaneDomainFailure`。不复用 `look_at_canvas`、`read_timeline` 或 `look_at_media`：它们读实时领域状态，不知道本条消息的选区，这是本次修复的领域边界。删掉 `LIVE_READ_TOOLS` 与无读工具最长前缀分支；不留第二套投影编码器。新能力只登记在 `agent.context.read` 合同，工具定义仍由 `VERB_DECLARATIONS` 单一注册表投影。

## ★4 全状态

- 空快照：投影为空；模型不应调用 `read_selection`，直接说明没有选区。
- 能列全：投影列全，无 `omitted`；`read_selection` 首页可从头读，最后页无 `nextCursor`。
- 放不下：投影列 0 行，`total/listed/omitted/omittedByKind/omittedNote` 齐全；模型按 cursor 逐页读。
- 过滤：`kind` 只返回该类并按原顺序计 `total`。
- 错误：无快照返回 `selection_snapshot_unavailable` 并说明从桌面 Agent 重发；坏或跨快照 cursor 返回 `selection_cursor_invalid` 并要求无 cursor 重读。
- 取消中：工具被 abort 时沿用 lane 的取消语义，不写猜测结果；下一次用户消息重新从头读取。
- 过期：旧消息 cursor 在新消息上视为 invalid；不把实时 UI 选择当替代品。
- 能力不可用：没有桌面消息快照的面不暴露工具；模型收到的 omitted 账只能来自 desktop lane。context 组未解锁时先请求该组，不把未列出误判成能力缺失。

## ★7 性能

新增操作是“投影一次”和“读一页”。最坏规模：5000 个句柄，字段含长标题、重复选择定位器、混合 kind。预算：投影 p95 ≤100ms；首个 `read_selection` 页 p95 ≤100ms；每页输出 ≤6000 字符；总过程按页推进，不建立第二份大快照。登记 `agent-context-selection-paging-5000`，量具 `tests/perf/agent-context-selection-paging-bench.mjs`，统一跑 `pnpm run perf:scenarios -- --id agent-context-selection-paging-5000 --update-baseline`（协调在安静窗口写入基线）。

## ★9 验收与回滚

验收清单（动手前锁定）：

- 投影 1/12/16/24 全列；40/256 零句柄，`total = listed + omitted`，按类计数和 `read_selection` 对，note 固定不含数字。
- 分页画布 300、时间轴 120、混选文稿 1 + 画布 40 + 时间轴 3：所有页拼接与快照一致；`kind` 过滤只出该类；cursor 不重、不漏、不跨快照。
- 错误：坏 cursor、跨快照 cursor、无快照均为机器可读且给下一步；不读实时状态。
- KV 稳定：同一对象投影两次逐字相同。
- 生产构造器测试；`node scripts/door-map.mjs read_selection` 门表闭合。
- `check:model-schema`、`check:mcp-tool-refs`、`check:walkthrough-tool-args` 通过；只进 internal profile，MCP 面无此工具；context 组解锁后仍不超过现有预算。
- 量具 ≥20 条自然 prompt，分 `read_selection` / `look_at_canvas` / 无读工具；零花费演练通过，真模型 `unverified` 由协调抽样。
- 变异：git archive 副本退回第 2 轮“类→工具 + 无读工具最长前缀”，分页 / 40 或 256 全部性断言必须红；记录失败格数。
- perf 场景 5000 句柄跑 ≥5 次，p95 在预算内，原始结果入仓。

反例 → 结果 → 证据：

| 反例 | 结果 | 量具 |
|---|---|---|
| 40/256 画布句柄 | 一个不列，ledger 指向 `read_selection` | snapshot tests + census |
| 120 时间轴片段 | 一个不列，分页全量按顺序 | snapshot paging test |
| 40 画布 + 3 时间轴 + 文稿 | 一页或多页拼回原快照 | mixed paging test |
| `kind=timelineClip` | 只出 120 时间轴句柄 | paging test |
| 坏 / 跨快照 cursor | 结构化错误，不猜 | error test |
| 无快照 | `selection_snapshot_unavailable` + desktop resend path | error test + lane test |
| 发送后 UI 改选区 | 仍读原消息快照 | active context integration test |
| 超长标题 / locator | 页仍 ≤6000 字符，行形不变 | pathological test + perf |
| 20+ 真实 prompt | 三类路径分档，不能只看一次工具调用 | selection walk evidence |

回滚：revert 本 PR 提交；快照格式和存量转录不变，投影与 read page 均同步纯函数/当前 lane context 重算，无数据迁移。

## r4 门岗复现与预算处置方案（先于代码变更）

合并 `origin/main` 后在本树复现：`check:model-schema` 报全部组常驻 31 个工具、约 10003 token；逐工具账中 `read_selection` 为 67 token，`stage_shot` 为 3377 token。`origin/main` 同样三道门岗全绿，22 个 internal 动词、30 个工具、约 9961 token，`stage_shot` 为 3404 token。因此超限不是 main 自带：本 PR 新增 `read_selection` 是直接增量；本 PR 又把 `stage_shot` 的四个描述槽压成短句，虽然少了 27 token，却同时删除了 `arrange_canvas` 与 `make_artifact` 的互斥裁决，造成另外两道门岗各一处硬红。恢复 main 描述后，预算预计为约 10030 token，不能靠删描述解决。

门岗规定的候选处置是把 `coding` 组拆成两个子组：只读 `read/grep/find/ls` 与写入 `edit/write/bash`，并按需分别解锁。要真正让完整组合回到 10000 以下，不能只改标签（当前 B1c 仍把所有组 schema 常驻并计入完整组合）；还必须改变 residency / 解锁策略，使两个子组不再同时进入同一模型可见组合。代价是某些任务回合看不到另一半 coding 工具，模型需再次请求另一个子组，工具菜单与 prompt/KV-cache 前缀也会改变。此处命中任务书停点，先交协调选择：

1. **拆 coding 并接受可见面变化（推荐由协调拍板）**：实现 read/write 两个组，调整一次只亮一个子组；预算可降回阈值，但需要补齐工具可见性、顺序、授权和真实任务评测。
2. **不拆组，暂缓 `read_selection` 的模型面变更**：保持 B1c 和现有 coding 组不变，回滚本 PR 的新增动词及其恢复链路；预算与三道门岗恢复，但原始静默截断问题继续存在，不能作为 #1263 的完成方案。
3. **保持所有 schema 常驻并另找减量**：只允许删掉或合并领域能力；本任务明确禁止删描述凑数，且 `read_selection` 是独立恢复边界，当前没有不改变语义的减量证据。

在协调选项前不改生产预算 / residency 代码；本节单独提交，后续代码提交必须以拍板方案为前提。

## 用户 10-25 拍板：先不上翻页工具

用户决定先不把 `read_selection` 作为模型可见工具，也不改变工具分组按需加载的预算策略。原因是 r4 恢复 `stage_shot` 完整描述后，完整模型面约 10030 token，超过门岗规定的 10000；按门岗拆 coding read/write 会改变同一回合的模型可见面、解锁顺序和 prompt/KV-cache 前缀，不能在本轮只改标签凑绿。

当前行为：发送时快照仍按 6000 字符预算从前往后尽量列出句柄；如果还有句柄未列出，文本保留 `total`、`listed`、`omitted` 和 `omittedByKind`，并明说这些句柄仍在当前选区。模型要处理全部句柄时，请用户缩小选区，或分批选中再发送；不会静默把省略的句柄当成不存在。原 `read_selection` 注册、执行、测试和演练链路同提交删除。

翻页能力等“工具分组按需加载”拍板并实现后再加回：先确定 residency / 解锁策略和模型可见面，再重新做工具说明、门岗签名、真实任务评测与独立验收；在此之前不保留隐藏开关或备用注册。
