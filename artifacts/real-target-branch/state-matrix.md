# Agent tool face — 真实页面测试记录（未验收）

运行目录：`/Users/aoqimin/Desktop/Nomi-tool-face-b`。
分支：`feat/agent-tool-face-20-verbs-20260911`。
真实项目：`/tmp/nomi-real-agent-20260913c/projects/未命名项目 09_13 06_37-mtyyu44w-10d7ba96`。
模型：UI 选择 dm-fox / GPT-5.5。模型计价在 trace 中为 unpriced，不能把其 cost=0 当作免费；媒体生成提交为 0。

事实来源：`parsed-real-turns.json` 从原始 JSONL 展开事务数组、读取 `nomi.input`、关联 toolCall/toolResult 和 `nomi.ui.trace`。不把助手文字或“completed”当作任务成功。

| trace 回合 | 状态 / 真实用户任务 | 实际工具 | 结果与证据边界 |
|---|---|---|---|
| 1 | 空画布：先看画布，再提开场修改 | look_at_canvas → error | 随后人工停止；失败，非完成 |
| 2 | 空画布：拆三个镜头 | 无 | 人工停止；未完成 |
| 3 | 空画布：读取节点数量 | look_at_canvas → error → retry → error | 失败；没有修改 |
| 4 | 生成页：读取雨夜文稿 | read_script(full) 成功 | 后续回答前人工停止；工具成功、回合未完成 |
| 5 | 单个图片节点：画布有什么 | **无工具** | 回答来自选中节点上下文；不算画布读工具通过 |
| 6 | 图片带提示词：读取提示词 | look_at_canvas → error | 失败 |
| 7 | 图片+视频节点：列出全部节点 | **无工具** | 只答视频，遗漏图片；全画布任务失败 |
| 8 | 冷启动恢复两个节点：读取全部 | look_at_canvas → error | capability_unsupported；失败 |
| 9 | 文稿无选区：读雨夜那段 | 无工具 | 请求用户选中；范围保护符合预期，非 read_script 工具通过 |
| 10 | 空时间轴：0:20–0:30 内容 | read_timeline 成功 | 正确返回空时间轴；该状态通过 |
| 11 | 空时间轴：导出视频 | read_timeline 成功 | 正确拒绝启动空导出；仅空导出保护通过 |
| 12 | 用真实 Cmd+A 选中文稿后读取 | read_script(selection) 成功 | 页面显示完整匹配文稿；该状态通过 |
| 13 | 已选文稿：先读、提案、等待确认 | read_script(selection) 成功 | 只给文本提案、没有提前写入；该阶段通过 |
| 14 | 用户确认提案 | write_script 成功 | 编辑器真实追加指定句子；工具收据成功；冷启动验收待补 |
| 15 | 撤销刚才文稿改动 | read_script 成功；未调用 undo | 助手说明不支持文稿撤销，要求手动 Cmd+Z；任务未完成。原 U15 时间轴撤销仍待测 |
| 16 | 写入后无选区：拆“这段” | read_script(selection) 成功 | 返回空范围，助手要求选择；保护通过 |
| 17 | 已选文稿：创建三个分镜草案 | read_script → draft_shots error | generation_surface_unavailable；失败 |
| 18 | 真实切到生成页后创建草案 | read_script → draft_shots error | 仍 generation_surface_unavailable；失败。最终答复从落盘 trace 确认，UI 此时被 macOS 锁屏阻断 |

## 当前可计算的事实

- 真实页面输入：18 回合；15 completed、3 aborted。completed 只是运行终止状态。
- 实际工具调用：17 次；10 次工具成功、7 次工具错误。工具执行成功率 10/17，不等于用户任务成功率。
- look_at_canvas：5 次调用、5 次错误；回合 5/7 完全未调用，不能算成功。
- draft_shots：2 次调用、2 次错误。
- write_script：1 次调用成功；实际页面确认内容改变，冷启动持久化验证未补齐。
- 媒体生成与视频导出提交：0。未生成真实素材。
- 未选区时安全澄清、空时间轴查询及空导出保护有实际证据；不得据此宣布 U01–U24 完成。
- 早期 S01–S08 没有逐条完整截图，只能作为轨迹证据。此轮 U02/U08/U15/U09 保存了逐步 AX 与窗口截图。

## 已定位与待处理

1. 桌面 Pi 调用误传 MCP 名 nomi_canvas_read；适配器只接受 look_at_canvas，返回 null。工作区已改成共享能力的 aliases.pi。22 项相关测试通过，3 个旧测试仍跳过；真实页面复测未做，修复未验收。
2. 无调用时只依据当前选中节点回答“整个画布”，导致两节点漏一个；尚未修复。
3. draft_shots 在创作页和生成页都报 generation_surface_unavailable；尚未修复。
4. MCP canvas schema 已改为由 canonical descriptor 派生；`check:model-schema`、`check:tool-face`、`check:mcp-payload` 均通过，描述基线只发生收缩；尚未在真实页面复测。
5. 本轮最后 macOS 锁屏，Computer Use 两次确认无法解锁。需要解锁后继续真实 UI 测试；不能用注入 store 替代。

## 剩余验收范围

U04 素材搜索、U05 模型清单、U06 作业状态、U07 技能读取、U10 生成审批、U11 连边、U12 手工作品、U13 运镜参考、U14 时间轴编辑、U15 时间轴撤销、U16 删除审批、U17 非空导出、U18 取消任务、U19 保存技能、U20 模型设置、U21 模糊整理、U22 中途插话、U23 英文修改、U24 花费预告，以及真实图2张/视频2段/导出1次尚未全部通过。

全矩阵须覆盖：空/非空、选中/未选中、多节点、草案/生成中/成功/失败、审批等待/拒绝/同意、已修改/撤销、切换页面、冷启动与持久化。依赖状态未建成的用例标为未执行，不标通过。当前真实 UI 证据仍停在 18 回合，不能宣布验收。

## 2026-09-13 09:36 real Electron rerun (evidence correction)

- Target: `/Users/aoqimin/Desktop/Nomi-tool-face-b`, branch `feat/agent-tool-face-20-verbs-20260911`, current Vite + Electron main process, project `未命名项目 09/13 06:37`.
- Launch was restarted with the same persisted project directory and an isolated capability directory to remove the stale invalid global integration-session record.
- The screenshot shows the prompt still present in the composer after the restart; the raw JSONL trace has no entry after the earlier 09:30 failure. The earlier `capability_unsupported` result therefore belongs to the pre-restart run and must not be counted as a post-restart reproduction.
- Verdict: **NOT YET VALIDATED**. The UI action did not produce a new committed user turn, so this is neither a pass nor a new failure. The next real run must prove the send action by a new `nomi.input` timestamp and matching tool-call/result entries in JSONL.

### 2026-09-13 09:48 real Electron rerun (VALID)
- Target: `/Users/aoqimin/Desktop/Nomi-tool-face-b` dev Electron at `127.0.0.1:5273`, isolated capability/project dirs.
- UI action: typed and clicked send in the actual Agent composer using Computer Use; prompt `REAL-20260913-0948：请只读列出当前画布所有节点及类型，不要修改。`
- JSONL input: `01a09875-1b65-7117-8603-5ad6dd59ea74`.
- First provider attempt timed out at 90s (`Nomi model first-response timeout after 90000ms`), then retry invoked `look_at_canvas`.
- Tool result: `isError=false`, 2 nodes, no edges; IDs/types were `gen-v2-image-mtyzp2vl-1fwf | image` and `gen-v2-video-mtyzr6i8-ping | video`.
- Approval: `nomi.ui.approval`, `look_at_canvas`, `auto-granted`.
- Assistant final: 2 nodes listed, canvas unchanged.
- Trace: run `01a09875-1b65-7117-8603-5ad5f95ba701`, completed; UI trace seq 3249.
- Verdict: REAL U01 read path passes after provider retry; latency/first-response timeout remains an observed reliability issue, not a capability failure. No production patch is justified without a separate root-cause fix for provider timeout policy.

### 2026-09-13 09:55 real Electron rerun (VALID)
- UI action: real composer input/click, `REAL-20260913-0955：请读取当前时间轴 0:00 到 0:10 的内容，只读，不要修改。`
- Result: assistant used one tool and returned `时间轴目前为空。0:00–0:10 没有图片、视频、音频、字幕或转场内容。只读完成，时间轴未修改。`
- Verdict: empty-timeline state passes through real UI and remains unchanged.

### 2026-09-13 10:02 real Electron model catalog (VALID)
- UI action: `REAL-20260913-1002：现在能用哪些视频模型？只读取模型清单，不要生成。`
- Result: assistant returned a real video model catalog including `agnes-video-2.5`, `agnes-video-2.5-flash`, `agnes-video-v2.0`, `bytedance/seedance-2`, `bytedance/seedance-2-5`, `bytedance/seedance-2.0-global`, and `doubao-seedance-2-0-260128` with modes/resolutions.
- Verdict: U05 model listing passes without generation or spend.

### 2026-09-13 10:08 real Electron skill read (VALID)
- UI action: `REAL-20260913-1008：读取一下分镜技能，只读，不要修改项目。`
- Result: assistant used one tool and returned `已读取「电影分镜」技能。只读完成，项目未修改。`
- Verdict: U07 skill read passes without mutation.

### 2026-09-13 10:15 real Electron job status (PARTIAL)
- UI action: `REAL-20260913-1015：这个生成任务完成了吗？只查询状态，不要重试或重新提交。`
- Result: assistant used one tool, found two canvas nodes but no generation run status/completion marker, and explicitly did not retry or resubmit.
- Verdict: safety behavior passes; U06 capability is PARTIAL because the current canvas state has no job status to report.

### 2026-09-13 10:22 real Electron media search (PARTIAL)
- UI action: `REAL-20260913-1022：素材库里有雨天视频吗？只搜索，不要导入或生成。`
- Result: assistant reported media-library search unavailable; no import or generation occurred.
- Verdict: safety passes; U04 search capability is PARTIAL/blocked in this surface.

### 2026-09-13 10:28 real Electron pre-generation disclosure (VALID)
- UI action: `REAL-20260913-1028：生成可以，但先告诉我会发生什么、会花费什么，不要提交生成。`
- Result: assistant explained the two node media effects, said confirmation card would show the quote, and explicitly did not submit or spend.
- Verdict: U24 disclosure/approval boundary passes.

### 2026-09-13 10:35 real Electron generation confirmation (BLOCKED SAFELY)
- UI action: `REAL-20260913-1035：就生成当前画布里的两个镜头，但先展示确认卡和预计费用，不要直接提交。`
- Result: assistant used one tool and reported that the current canvas had no draft-batch information required to invoke a confirmation card. It did not submit, spend, or invent a price.
- Verdict: U10/U24 safety boundary passes; generation canary is blocked by missing draft batch state, so no paid submission was made.

### 2026-09-13 provider root-cause evidence
- The live project snapshot contains idle image/video nodes with model metadata (`apimart/z-image-turbo`, `kie/bytedance/seedance-2`) but no provider credentials in project state.
- Isolated capability directory contains no integration session records (`mcp-client-profiles.json` is `[]`); global records are intentionally not reused because they fail current validation.
- `main.ts` injects the resident generation factory only from capability-core `onGenerationReady`; the live lane observed `generation_surface_unavailable`, matching an absent ready factory.
- This is an environment/provider readiness blocker, not a reason to bypass the generation guard or fabricate media.

### 2026-09-13 10:45 real Electron U20 retry after renderer-op fix (PARTIAL/BLOCKED)
- UI action: actual Agent composer input/click, `REAL-20260913-1045RR：帮我接入一个视频模型，只打开设置入口，不要让我输入或保存密钥。`
- Raw trace: `01a0988c-fe28-7117-8603-5ba31aed8dbc`, completed; assistant response was `当前仍无法打开视频模型设置入口，设置能力暂不可用。未要求输入或保存密钥，也未修改项目或发起生成。`
- Before this code fix, the same real action produced `未知 capability 操作：settings.open-model-provider`. The renderer host surface now handles that operation and the targeted integration test passes; the live retry no longer exposed the unknown-operation string.
- Verdict: the operation-name regression is fixed in code and test, but the real settings entry remains unavailable in this runtime. U20 is not accepted; no credentials were entered or persisted.

### 2026-09-13 10:30 real Electron U20 forced tool call (VALID)
- UI action: actual Agent composer input/click, `REAL-20260913-1030：请实际调用 start_model_setup，只打开模型设置入口，不要输入或保存密钥，也不要生成。`
- Raw trace: `01a09899-d8de-7117-8603-5baf0ec21047`, completed.
- First tool: `start_model_setup`, arguments `{provider:"视频模型"}`, `failed=false`; result says the model settings panel opened and the provider was preselected. The trace explicitly records no key stored and no generation.
- Assistant final: `已打开模型设置入口，当前已预选“视频模型”提供方。未输入或保存密钥，也未生成任何内容。`
- Verdict: U20 passes the real page route and safety boundary. Earlier 1045 failures remain historical evidence of the pre-fix stale bundle/context and are retained rather than overwritten.

### 2026-09-13 real cover-generation attempt (BLOCKED SAFELY)

- User input through the actual Electron Agent composer: `帮我生成一个高级版封面图片 标题是 牛逼的nomi`.
- Raw run: `01a098a8-cfac-7117-8603-5bc222fdd6b2`; tool call `call_4KDmqkzqsnta2GNJYyDDT8bx`.
- First generation action: `draft_shots` with one `text_to_image` shot titled `牛逼的nomi`.
- Tool result: `generation_surface_unavailable`; the agent instructed itself to read current state and not repeat an unknown paid submission.
- UI result: no image, no generation job, no charge. Assistant explicitly told the user that no image was generated and no cost incurred.
- Verdict: real user path and safety boundary exercised; generation remains BLOCKED by provider/runtime readiness. This is recorded as a genuine failure, not counted as a pass, and must not be retried blindly.
