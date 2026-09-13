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
4. MCP canvas schema 仍有 12 项新增门禁违规；未提高基线。
5. 本轮最后 macOS 锁屏，Computer Use 两次确认无法解锁。需要解锁后继续真实 UI 测试；不能用注入 store 替代。

## 剩余验收范围

U04 素材搜索、U05 模型清单、U06 作业状态、U07 技能读取、U10 生成审批、U11 连边、U12 手工作品、U13 运镜参考、U14 时间轴编辑、U15 时间轴撤销、U16 删除审批、U17 非空导出、U18 取消任务、U19 保存技能、U20 模型设置、U21 模糊整理、U22 中途插话、U23 英文修改、U24 花费预告，以及真实图2张/视频2段/导出1次尚未全部通过。

全矩阵须覆盖：空/非空、选中/未选中、多节点、草案/生成中/成功/失败、审批等待/拒绝/同意、已修改/撤销、切换页面、冷启动与持久化。依赖状态未建成的用例标为未执行，不标通过。

## 2026-09-13 follow-up evidence

- **U01 real rerun (new target Electron):** `REAL-20260913-0948` was entered and sent through the actual Agent composer. The first provider attempt timed out after 90s, then retry called `look_at_canvas` and returned `isError=false` with 2 nodes and no edges. This proves the canonical alias path works after retry; it also exposes first-response timeout as a reliability finding.
- **U03 empty-timeline state:** `REAL-20260913-0955` was entered and sent through the actual Agent composer. One `read_timeline` call returned the empty 0:00–0:10 state and confirmed no mutation.
- These two runs do not close the matrix. The older failures and unexecuted generation/export cases remain as listed above.
- **U05 real model catalog:** `REAL-20260913-1002` returned the available video model list and modes from the live Agent page without starting a generation job.
- **U07 real skill read:** `REAL-20260913-1008` read the storyboard skill in the live Agent page and confirmed no project mutation.
- **U06 real job status:** `REAL-20260913-1015` correctly refused to infer completion or resubmit; it reported that no run-status marker was available. Safety passes, capability remains partial in this state.
- **Live gate evidence:** `live-production-mcp-blocked.md` records the actual live-provider gate result: blocked because credentials and explicit spend authorization are not supplied; no child journey was executed.
- **Raw trace inventory refreshed 2026-09-13:** current isolated session JSONL contains 27 `nomi.input` entries, 25 tool-result messages, and 27 `nomi.ui.trace` entries. The 6 new REAL-* entries are included in the raw trace; the older rows remain classified individually and are not promoted by trace completion alone.
- **Generation confirmation boundary:** `REAL-20260913-1035` reached the live Agent page but correctly stopped because no draft batch metadata was available for a confirmation card; no spend or fake quote occurred.

### U20 follow-up (2026-09-13 10:45)
- Real Agent input `REAL-20260913-1045RR` was sent after the renderer operation fix.
- The previous unknown operation error is gone; the actual page now reports `设置能力暂不可用` and makes no mutation.
- This validates the direct operation mismatch remediation but leaves the live settings route unavailable. U20 remains PARTIAL/BLOCKED and the branch is not accepted.

### U20 real route closure (2026-09-13 10:30)
- Forced a fresh real-page turn after the renderer operation fix: `REAL-20260913-1030`.
- `start_model_setup` succeeded with provider preselection; the settings panel opened in Electron, no key was entered/stored, and no generation started.
- U20 is now VALID for the current runtime. Earlier 1045 failures are retained as historical pre-fix evidence.

### 2026-09-13 latest real cover attempt

The actual Electron composer received `帮我生成一个高级版封面图片 标题是 牛逼的nomi`. The first tool was `draft_shots` for a single text-to-image cover shot. The live result was `generation_surface_unavailable` (run `01a098a8-cfac-7117-8603-5bc222fdd6b2`, call `call_4KDmqkzqsnta2GNJYyDDT8bx`). No image, job, or spend was produced. The assistant correctly declined to repeat an unknown paid submission. This closes another real safety-path observation while leaving the live generation canary blocked on provider/runtime readiness.
