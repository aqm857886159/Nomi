# Nomi v0.21.0 MCP 宣传片制作旅程问题档案

日期：2026-08-27

审计对象：《Nomi v0.21.0｜最后一卷片》四段 Seedance 2.0 生成、时间轴编排、章节标题迭代与 MP4 导出

文档性质：**只记录问题、证据、版本边界和当前状态；不在本文给出完整解决方案或施工排期。**

## 1. 这份问题档案基于哪个版本

### 1.1 真实制作旅程能确认到的版本

| 项目 | 已确认事实 |
|---|---|
| 用户可见版本 | `0.21.0`；项目名为《Nomi v0.21.0｜最后一卷片》，当前仓库 `package.json` 也是 `0.21.0` |
| 首条项目事件 | 2026-08-27 15:03:07（Asia/Shanghai），`canvas.snapshot.restored`，事件序号 1 |
| 末条项目事件 | 2026-08-27 16:53:20（Asia/Shanghai），事件序号 116 |
| 最终导出 | 2026-08-27 17:34，`nomi-export-202608271734.mp4` |
| 精确运行 commit | **没有被项目、事件或导出作业持久化，无法确认** |

这里必须诚实区分“版本号”和“二进制来源”：真实项目证明这次制作发生在 Nomi `0.21.0`，但没有任何落盘字段能证明当时正在运行的是 `v0.21.0` 标签、某个本地提交，还是合并前的分支构建。

这不是文字洁癖。统一 Agent PR [#181](https://github.com/aqm857886159/Nomi/pull/181) 于 2026-08-27 15:56:32 合入，而项目在 15:03 已经开始；因此不能把 #181 的运行时变化倒推成这次旅程已经使用的事实。

### 1.2 本次代码复核基线

问题是否仍存在，统一在以下较新主线复核：

```text
origin/main@8f9365aeb9dacc91153b186178eaf9184eeac639
git describe: v0.21.0-9-g8f9365ae
package version: 0.21.0
commit time: 2026-08-27 16:55:42 +08:00
```

这个基线已经包含 v0.21.0 发布 PR [#197](https://github.com/aqm857886159/Nomi/pull/197)、统一 Agent PR #181、ComfyUI 多输入 PR [#183](https://github.com/aqm857886159/Nomi/pull/183)、模型与 Antigravity PR [#188](https://github.com/aqm857886159/Nomi/pull/188)，以及此前的 MCP/ProductionRun 地基。

开放中的 [#179](https://github.com/aqm857886159/Nomi/pull/179) 只作为补充调研上下文，**不属于上述基线，也不能当成已发布能力**。

### 1.3 证据根目录

项目证据：

```text
/Users/aoqimin/Documents/Nomi Projects/Nomi v0.21.0｜最后一卷片-mtb67t42-182d6835
```

核心事实文件：

```text
.nomi/project.json
.nomi/events/log-0.jsonl
.nomi/events/sidecar/*.json
.nomi/jobs/<jobId>/job.json
.nomi/jobs/<jobId>/manifest.json
.nomi/jobs/<jobId>/ffmpeg.log
exports/nomi-export-202608271734.mp4
```

最终交付：

```text
/Users/aoqimin/Desktop/Nomi-v021-launch-media/videos/nomi-v021-story-film/renders/nomi-v021-story-film-final.mp4
/Users/aoqimin/Desktop/Nomi-v021-launch-media/videos/nomi-v021-story-film/renders/nomi-v021-story-film-contact-sheet.jpg
```

## 2. 一句话结论

四条视频都成功了，Nomi 也成功导出了带声音和章节标题的 50.4 秒成片；真正暴露的问题不是 APIMart 或 Seedance 不可用，而是：

> 仓库已经有语义化 GenerationOperation/ProductionRun 地基，真实 Agent 旅程却仍选择了低层 `nomi_add_nodes + nomi_generate`；确认、媒体核对、参数 revision、长任务状态、结果看片和导出事实没有在同一条用户路径上闭合。

因此这次成片的质量主要由强参考、人工判断、反复回到 Nomi 操作和四次导出核验保证，而不是由一条可复演的 MCP 制作流程保证。

## 3. 用户实际走过的路径

```text
想一次建立四个镜头
→ 批量 nomi_add_nodes 返回 ids:[]、cancelled:true
→ 不知道为什么取消，只能拆成单节点重做
→ 用 nomi_generate 发起付费生成
→ 当前 MCP 客户端不能完成所需确认
→ 切回 Nomi，寻找并点击确认卡
→ 卡上只看到“参考图 N 张”，看不到具体图片、视频和角色
→ 切到 APIMart Seedance 2.0 后，重新检查并补回分辨率、时长等参数
→ 等待期间看到约 1 分钟的提示，真实每条耗时 8–17 分钟
→ MCP、画布节点和供应商任务分别显示状态
→ MCP 结果面板没有可用的视频画面预览
→ 回到 Nomi 播放结果并逐条加入时间轴
→ 首版标题全部在底部，故事与版本更新的关系不清楚
→ 手工改成居中章节卡，连续导出四版
→ 再用 ffprobe、抽帧、音轨和 contact sheet 确认最终文件
```

用户最难受的并不是步骤多，而是每个关键步骤都需要重新判断一次：

- 这次取消是我拒绝了，还是系统出错了？
- 要去当前客户端确认，还是去 Nomi 找卡？
- 我批准的到底是哪两张图、哪段上一镜视频？
- 切模型后，12 秒和 1080p 还在不在？
- 任务是在运行、卡住，还是已经完成但某个界面没刷新？
- “视频成功”为什么看不到视频？
- 当前导出的到底是哪一版标题和音轨？

## 4. 最新 PR 上下文：哪些已经做了，不能重复算成待建能力

本节用于避免把近期合入重新设计一遍。

| PR | 已经合入的事实 | 对本次问题的约束 |
|---|---|---|
| [#155](https://github.com/aqm857886159/Nomi/pull/155) | `nomi_operation_create` 已支持多镜 `shots[]`，能落 durable generation seal、逐镜合同和 planHash；真实 APIMart 付费链已走到提交 | 不能再写“缺一套多镜 operation”；问题是本次为何没走它 |
| [#156](https://github.com/aqm857886159/Nomi/pull/156) + [#167](https://github.com/aqm857886159/Nomi/pull/167) | 锚定妆照检查点已有 MCP 决议入口、自动续跑和 Nomi 图片确认卡 | 不能把所有确认都说成没有图片；缺口只发生在通用付费生成 gate |
| [#158](https://github.com/aqm857886159/Nomi/pull/158) | 慢供应商轮询、续踢和 APIMart `url[]` 物化已修 | 本次 8–17 分钟不是已知“32 次空轮询后永远停死”的复发；四条都正常完成 |
| [#164](https://github.com/aqm857886159/Nomi/pull/164) | MCP 安全投影已有校验后的 `shotId` 与项目相对产物路径 | 不能重新发明一套 artifact 路径投影 |
| [#165](https://github.com/aqm857886159/Nomi/pull/165) | semantic binding 进入 legacy MCP 路会 fail-closed，并用门岗冻结新增批量机器 | 当前洞不是“又有第四台批量调度器”，而是新建的普通画布节点没有 semantic binding，仍可合法落到 legacy 单次生成 |
| [#168](https://github.com/aqm857886159/Nomi/pull/168) + [#177](https://github.com/aqm857886159/Nomi/pull/177) | 所谓确认卡“零高”被证明是量错节点；花费与匿名素材托管已合并成一张卡 | 本档案不再把“确认卡 0 高”或“连续弹两张卡”列为当前问题 |
| [#174](https://github.com/aqm857886159/Nomi/pull/174) | MCP/IPC 已有 request registry、cancel/disconnect、并发付费确认绑定、schema 校验、协议协商和 sender/frame/origin 绑定 | 不能把问题笼统写成“MCP 没有取消或安全边界”；当前剩余的是业务取消结果缺少原因，以及确认内容/宿主能力不足 |
| [#176](https://github.com/aqm857886159/Nomi/pull/176) | 生成产物进入时间轴已收敛为 Artifact → EditProposal → Apply/Undo 唯一受控通道 | “加入时间轴”不是本次故障，真实轨迹也证明它工作正常 |
| [#178](https://github.com/aqm857886159/Nomi/pull/178) | 走查证据增加持续 absent、视觉 settled、gates 链和断言密度门岗 | 本档案把落盘事实、旅程观察和代码推断分级，不用一张截图代替运行事实 |
| [#181](https://github.com/aqm857886159/Nomi/pull/181) | 通用 Agent loop 已切到 pi AgentSession；Nomi 仍掌握 MCP、审批、预算、写入和 Undo | pi runtime 不是本次业务确认/生成状态的替代 owner，也不能用 #181 解释 15:03 已开始的运行 |
| [#183](https://github.com/aqm857886159/Nomi/pull/183) + [#187](https://github.com/aqm857886159/Nomi/pull/187) + [#193](https://github.com/aqm857886159/Nomi/pull/193) | ComfyUI 独立媒体槽、data/local 素材传输、headless 首帧/参考族互斥都已修 | 本次参考素材成功送达，不能把结果质量问题归因为“引用传丢了” |
| [#188](https://github.com/aqm857886159/Nomi/pull/188) | Antigravity 的素材、能力、CLI 身份会在 grant 和任务受理前验证；普通 catalog runtime 仍按真实 vendor 合同执行 | 这套保护没有卡住 APIMart；四条真实成功任务是反证 |
| [#197](https://github.com/aqm857886159/Nomi/pull/197) | v0.21.0 已正式把 ComfyUI、多模型、多镜、素材/MCP 地基列为版本能力 | 本档案讨论的是这些地基在真实跨端制作中的“使用闭环缺口”，不是否定本次版本能力 |
| [#179](https://github.com/aqm857886159/Nomi/pull/179)，未合并 | 调研指出第三确认宿主不存在、非硬切转场未渲染、当时音频导出链有缺口 | 只作为历史上下文；本次最终 MP4 已证明当前音频导出可用，不能照搬其旧结论 |

## 5. 问题总表

状态含义：

- **现行确认**：真实旅程观察到，且在 `origin/main@8f9365ae` 仍能从代码确认机制存在。
- **运行观察**：真实旅程观察到，但现有证据不足以把根因写死。
- **证据缺口**：无法精确归因本身就是问题。

| ID | 严重度 | 问题 | 发生版本 | 最新主线状态 |
|---|---|---|---|---|
| MCP-J01 | P0 | 已有 semantic operation，但真实 Agent 选择了 legacy 画布/生成路径 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J02 | P1 | 批量落节点取消只返回 `cancelled:true`，没有原因与下一步 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J03 | P1 | 当前客户端不能确认时，用户被迫切到 Nomi 找卡 | v0.21.0 实际旅程 | 依宿主能力发生；第三确认表面仍不存在 |
| MCP-J04 | P1 | 通用付费确认只显示参考数量，不显示实际图片/视频及角色 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J05 | P1 | 切模型会先清旧控件并套新默认，兼容参数也没有可见变更说明 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J06 | P1 | 视频 ETA 固定按每条 40 秒估算，真实为 8–17 分钟 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J07 | P1 | legacy 生成把提交、轮询和结果挤在一次 MCP 调用，跨端状态难以对齐 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J08 | P1 | MCP 成功结果没有可审片的视频 poster/播放器 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J09 | P2 | Nomi 全屏预览曾短暂显示“无法播放媒体”后恢复 | v0.21.0 实际旅程 | 运行观察，根因未定 |
| MCP-J10 | P2 | 章节标题只能作为普通文字片段手工定位/缩放，首版叙事意图不清 | v0.21.0 实际旅程 | 运行观察，属于产品表达缺口 |
| MCP-J11 | P0 | 持久化导出 manifest 与真正执行的 ffmpeg 输入、音频和标题矛盾 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J12 | P2 | 导出成功主要靠瞬时 toast 和目录，缺少项目内持久结果身份 | v0.21.0 实际旅程 | 现行确认 |
| MCP-J13 | P1 | 项目与作业不记录应用 build/commit，事故无法精确绑定二进制 | v0.21.0 实际旅程 | 证据缺口仍存在 |

## 6. 逐项问题记录

### MCP-J01：已有 semantic operation，真实旅程却走了 legacy 路径

**用户当时想做的事**

一次建立四个镜头，确认一组参考、模型、时长和分辨率，然后让系统按计划生成。

**实际发生**

- 先用 `nomi_add_nodes` 建普通画布节点；批量被取消后拆成单节点。
- 再逐节点调用 `nomi_generate`。
- 每次生成都由 legacy 调用自己发起确认、提交、进程内轮询并回写节点。

**为什么这是路径问题，不是“仓库没有 operation”**

当前主线 `electron/capabilityCore/mcpGenerationTools.ts:55-228` 已公开完整语义工具：

```text
nomi_session_open
nomi_get_generation_context
nomi_operation_create
nomi_submit_generation_plan
nomi_preview_execution
nomi_request_generation_gate
nomi_decide_generation_gate
nomi_start_generation
nomi_operation_read
nomi_cancel_generation
nomi_reconcile_generation
```

[#155](https://github.com/aqm857886159/Nomi/pull/155) 还证明多镜 `shots[]`、逐镜合同、planHash 和真实 APIMart 提交已经走通；`productionGenerationOperationStore.ts` 也把 operation 适配到 ProductionRun，而不是另建内存 owner。

但当前工具面同时继续暴露 `nomi_add_nodes` 和 `nomi_generate`。`mcpGenerationPolicy.ts` 只在节点已经带 semantic binding 时禁止 legacy；这次新建普通节点没有 binding，因此 legacy 路径仍是一个合法选择。

同时，`mcpProtocol.ts:55-61` 的 MCP App resource 只挂在 `nomi_generate`、playbook 和 run/artifact 读工具上，没有挂在 operation create/preview/gate/read 上。语义工具存在，但在宿主里的可理解性和可视反馈弱于 legacy 工具。

**用户后果**

- 一次制作计划被拆成四个独立调用。
- 每个节点都重新经历确认、等待和结果定位。
- operationId、plan revision、统一进度和统一结果没有成为用户所在路径的主身份。

**最新状态**

`origin/main@8f9365ae` 仍保留上述双入口，因此标记为“现行确认”。这里记录的是默认选择与产品路径的缺口，不是否定 #155/#165 已完成的地基。

### MCP-J02：批量落节点取消没有原因

**实际结果**

一次 `nomi_add_nodes` 返回：

```json
{ "ids": [], "cancelled": true }
```

用户无法知道它代表：

- 人在确认卡点了拒绝；
- 确认超时；
- 调用方无法显示确认；
- Nomi 内确认卡被关闭；
- 请求被 MCP cancellation 中断。

**当前代码事实**

- `mcpProtocol.ts:520-533` 把 decline 和 timeout 收敛成同一个 `{ ids: [], cancelled: true }`。
- `core.ts:296-305` 的应用内方案门拒绝也返回同一形状。
- [#174](https://github.com/aqm857886159/Nomi/pull/174) 已经修的是协议 request registry、断连与 `notifications/cancelled`，并不等于业务结果已经带 typed reason。

**用户后果**

没有可恢复动作。Agent 只能猜测并改用单节点重试，真实旅程正是这样绕过去的。

### MCP-J03：确认表面取决于宿主能力，用户被迫跨应用找卡

**实际发生**

两次 MCP 付费生成没有在当前客户端完成确认，也没有消耗额度；之后改用 Nomi 客户端确认并成功生成。

**当前机制**

[#174](https://github.com/aqm857886159/Nomi/pull/174) 后的顺序是：

1. MCP 客户端声明 elicitation 且通过认证时，优先在当前客户端确认；
2. 客户端不能确认但 Nomi 开着时，回退到 Nomi 卡；
3. 两边都不能确认时，拒绝花费。

安全语义是正确的。摩擦发生在第 2 种情况：调用发生在 A，待办出现在 B，而当前结果只告诉用户“需要确认”，没有一个持续可见、可回到的跨端待办身份。

开放 PR [#179](https://github.com/aqm857886159/Nomi/pull/179) 的调研还指出，当前没有独立的置顶确认宿主；它尚未合入，所以不能把第三表面当成已有能力。

**用户后果**

用户需要切回 Nomi、判断哪张卡属于当前请求，再切回原客户端继续。确认没有丢，但注意力和任务上下文丢了。

### MCP-J04：通用付费确认知道“有几张参考”，不知道“是哪几张”

**真实风险**

本片后续镜头同时使用：

- 上一镜视频；
- 主角与红胶片身份锚；
- 手工电影世界风格锚。

多参考任务最危险的错误不是数量少一，而是角色对错：上一镜被当风格、角色锚被遗漏、旧素材被批准。

**当前代码事实**

- `mcpGateConfirmation.ts:19,88` 只有 `referenceCount`。
- `appIntegration.ts:123-140` 发给 renderer 的也是 `referenceCount`。
- `capabilityApplyHandler.ts:232-250` 的通用生成卡只显示项目、模型、参考数量、成本和过期时间。

需要明确排除两个容易混淆的已完成项：

- [#167](https://github.com/aqm857886159/Nomi/pull/167) 的 `anchor_checkpoint` 确认卡能展示定妆照，但它是生成后的免费质量门，不是每次付费生成的输入合同卡。
- [#177](https://github.com/aqm857886159/Nomi/pull/177) 已把素材托管披露并入花费卡，但没有把实际参考媒体投影进去。

[#183](https://github.com/aqm857886159/Nomi/pull/183) 已经为 ComfyUI 和画布建立精确媒体槽身份，说明“系统完全不知道每个参考是谁”不是事实；缺口在确认投影没有把既有身份呈现给用户。

### MCP-J05：切换模型时，创作参数会被静默改写

**实际发生**

用户的目标是 1080p、12–13 秒、带原生音频。切到 APIMart Seedance 2.0/对应模式后，需要重新检查并设置这些值；否则新模型默认值会接管。

**当前代码事实**

`buildNodeModelChangePatch.ts:47-70`：

1. 解析旧模型 controls；
2. `removePreviousControlParams` 清掉旧 controls 对应值；
3. `defaultPatchForControls` 应用新模型默认；
4. 再写入新的 model/vendor/archetype。

清理不兼容字段本身合理；问题是当前用户没有看到：

- 哪些值被保留；
- 哪些值被删除；
- 哪些值从用户值变成了新默认；
- 先前的确认是否因此失效。

**用户后果**

“我只换了供应商/模型”在产品行为上等于“我同时改了输出合同”。如果用户没有再次逐项检查，最终时长和清晰度会偏离故事板。

### MCP-J06：ETA 比真实耗时少一个数量级

**当前 UI 算法**

`spendConfirm.ts:190-198` 对视频使用固定 `40 秒/条`，四舍五入到分钟。

**真实四条任务**

| 节点 | provider taskId | requested → completed | 真实耗时 |
|---|---|---:|---:|
| `node-618b0167-2` | `task_01M110SH6JP27HYAWDY828J0WT` | seq 27 → 28 | 8m05s |
| `node-3fdb65a4-3` | `task_01M112J4TVHBNQGEVRHQ7F1ECZ` | seq 58 → 59 | 8m58s |
| `node-82d83d07-4` | `task_01M11436RWH5ZDQCVGK3XVJK8C` | seq 85 → 86 | 16m59s |
| `node-d74b4289-5` | `task_01M115YK73AWPJDPPTPFT6VQ9K` | seq 111 → 112 | 13m55s |

最后一条供应商载荷自己记录的 `estimated_time` 是 300 秒、`actual_time` 是 826 秒；Nomi 仍在确认阶段显示约 1 分钟。

**用户后果**

等待 60 秒后没有结果，用户自然会判断“卡死了”，然后刷新、取消或重复提交。当前幂等与 grant 护栏避免了重复扣费，但错误预期仍制造焦虑和额外操作。

### MCP-J07：legacy 生成把长任务塞在一次 MCP 调用里，状态分成多份

**当前代码事实**

`core.ts:380-383` 明确写明：task cache 在进程内，host 退出即丢，因此 `nomi_generate` 要在同一次调用中轮询到终态。`core.ts:597-632` 的视频默认轮询视野可到 15 分钟。

同时，一次生成至少有这些局部状态：

1. MCP `tools/call` 是否仍在飞；
2. 画布节点的 queued/running/error/result；
3. Electron task cache 和供应商轮询；
4. `.nomi/events` 的 vendor requested/completed；
5. semantic ProductionRun/operation（如果走了 semantic 路）。

[#158](https://github.com/aqm857886159/Nomi/pull/158) 已修 semantic 批次的慢供应商续踢；[#174](https://github.com/aqm857886159/Nomi/pull/174) 已修 MCP request cancellation；[#181](https://github.com/aqm857886159/Nomi/pull/181) 已替换通用 Agent loop。它们都没有改变这次实际使用的 `nomi_generate` 仍需长时间占住一次调用这一事实。

**用户后果**

用户看到某一面“完成/仍在运行”时，无法直接判断那是不是同一个任务的最终事实。成功结果最后能落盘，但等待过程不具备一个稳定、跨端可读的主身份。

### MCP-J08：MCP 结果知道是视频，但没有可审片画面

**当前代码事实**

- `mcpPreviewImage.ts:50-76` 对视频只有在已有 `thumbnailUrl` 时才返回图片；没有 poster 就明确不抽帧。
- `mcpAppWidget.ts:236-257` 会把生成结果 URL当作 `thumbnailUrl` 候选。
- `mcpAppWidget.ts:441-447` 无论图片还是视频，最终都用 `<img>` 渲染 `thumbnailUrl`；没有 URL时只显示“视频”占位。

因此两种路径都不能稳定审片：

- 视频没有 poster：只有文字占位；
- MP4 URL 被当缩略图：`<img>` 无法播放它，加载失败后仍回到占位。

**用户后果**

MCP 告诉用户“成功”，用户仍必须回到 Nomi 找对应节点、等待播放器就绪，才能判断角色、构图和转场是否正确。

### MCP-J09：Nomi 预览曾短暂报无法播放，但现有证据不足以定根因

**实际观察**

全屏预览第一次打开时短暂出现“无法播放媒体”，缓冲后恢复并可正常播放。

**为什么不把它直接写成播放器 bug**

当前没有同时保存：

- video element 的 readyState/networkState；
- `nomi-local://` 响应状态；
- 解码错误；
- 文件仍在 materialize 还是已经完整落盘；
- 该提示出现和消失的时间。

最终四段源视频和导出文件都可解码，所以只能记录为运行观察，不能凭一次 UI 提示把根因归给播放器、文件或协议。

### MCP-J10：章节标题不是语义化叙事节拍，只是普通文字片段

**实际发生**

首版把更新点作为底部字幕放入成片。用户指出“核心标题应该在中间、配合转场和音效，否则页面不知道在干什么”，之后才改成居中章节卡。

最终七个标题：

```text
09:00 FINAL
COMFYUI / 多模态工作流
WAN 3.0
MINIMAX H3
火山引擎
GEMINI
一个人，也有一整间片场 / Nomi v0.21.0
```

当前时间轴可以编辑普通文字，但标题的开始时间、持续时长、位置、缩放和安全区需要人工逐项调整。Agent 也难以精确选中“已有的那一张标题”做结构化修改。

这不是“字幕功能坏了”，而是产品只有文字编辑能力，没有表达“这是一个章节转场节拍”的任务语义。故本项记录为产品表达缺口，不在本文预设实现方式。

### MCP-J11：持久化导出 manifest 与真正执行的作业事实相反

这是本次最严重、证据最完整的问题。

**最终 job 的持久记录**

`457196f8-0e27-4f02-b871-b6e2555d5166/job.json` 与 `manifest.json` 记录：

```json
{
  "tracks": 0,
  "assets": 0,
  "audioCodec": "none",
  "audioMode": "mute",
  "durationFrames": 1512
}
```

**同一 job 的实际 ffmpeg 事实**

`ffmpeg.log` 记录：

- Input #0–#3：4 段 1920×1080 H.264 视频；
- 四段输入都带 AAC stereo 音轨；
- Input #4–#10：7 张 1920×1080 PNG 文字 overlay；
- 输出包含 H.264 1920×1080 30fps 和 AAC stereo 32kHz。

**当前代码根因**

`exportJobs.ts:205-218` 先用 renderer 原始 manifest 调 `exportJobManager.createJob` 并持久化，然后才异步构建已经解析本地资产、音轨和 filtergraph 的 prepared manifest；后者只进入进程内 `preparedFiltergraphExports` map。`exportJobManager.ts:120-133` 因而保存的是原始快照。

**用户后果**

最终 MP4 是正确的，但系统保存了一个错误的成功原因。重启后：

- 无法仅凭 job/manifest 复演同一输出；
- 无法准确回答用了哪四条素材、哪七个标题、是否带声音；
- 事故分析会得到“静音、零轨道”的假结论；
- 内存 prepared plan 消失后，持久状态不再代表执行状态。

开放 PR #179 曾记录“音频进不了导出链”，但本次真实 ffmpeg 日志已经反证当前执行链能输出音频。**当前问题不是没有音频，而是持久 manifest 说没有音频。**

### MCP-J12：导出成功是瞬时反馈，不是项目内可持续追踪的结果

**实际发生**

连续导出四版：

| jobId | 时间 | 文字 overlay 数 | 用途 |
|---|---:|---:|---|
| `52edb752-285f-4f39-9ac2-7a3df4f48ded` | 17:07 | 2 | 初版 |
| `e282e0da-e2a4-424a-b676-b8c5c876417c` | 17:17 | 4 | 增补章节信息 |
| `33c69011-c6e3-496b-99e4-4df3d73bf4c2` | 17:30 | 7 | 完整章节卡 |
| `457196f8-0e27-4f02-b871-b6e2555d5166` | 17:34 | 7 | 最终微调版 |

导出后 toast 会告诉用户相对路径，并提供“在文件夹中显示”。这对即时动作是清楚的；但 toast 消失后，用户要靠目录名、时间戳和外部播放器辨认四版差异。

[#176](https://github.com/aqm857886159/Nomi/pull/176) 已解决“生成 Artifact 如何受控进入时间轴”，不等于“导出文件已经成为项目内可比较、可回看的 Artifact”。两者不能混写。

### MCP-J13：运行环境没有随项目/作业留痕

**当前落盘缺失**

项目、事件和 export job 没有稳定记录：

- app version；
- git/build SHA；
- packaged/dev 标志；
- Electron 版本；
- MCP server contract version；
- 当次运行的 catalog snapshot identity。

这次只能从项目名推断用户面是 v0.21.0，再用更晚的 `origin/main@8f9365ae` 复核当前代码。由于 #181 在项目中途才合入主线，任何“这次运行已经用了 pi runtime”的断言都无法成立。

**用户与工程后果**

当一次昂贵生成或导出出问题时，无法精确回答“问题发生在哪个构建上”。这会让已经修复的问题看起来像复发，也会让尚未合入的 PR 被误当成已生效。

## 7. 明确不是本次问题的事项

### 7.1 APIMart 没有被“扣费前验证”卡住

四次 APIMart Seedance 2.0 任务都：

- 只提交一次；
- 成功完成；
- 各落地一段可解码视频；
- 没有被 Antigravity CLI 专用身份闸拦截。

“素材、能力和 CLI 身份在扣费前验证”以及“错误请求不先消费额度”只拒绝无法执行或身份不可信的请求。普通 APIMart catalog/runtime 不走 Antigravity 的 exact executable identity 闸；本次四个成功结果是最直接的回归证据。

### 7.2 不是慢供应商调度器再次停死

四条任务虽然耗时长，但都从 requested 进入 completed 并落地资产。[#158](https://github.com/aqm857886159/Nomi/pull/158) 所修的“毫秒内烧完 32 次查询、之后无人续踢”没有在本次复现。

### 7.3 不是参考媒体传输失败

最终节点运行事实里保留了上一镜视频、两张图片锚和实际 provider task；[#183](https://github.com/aqm857886159/Nomi/pull/183)、[#187](https://github.com/aqm857886159/Nomi/pull/187)、[#193](https://github.com/aqm857886159/Nomi/pull/193) 的媒体合同/传输没有在本次表现为丢引用。

### 7.4 不是时间轴采纳失败

“加入时间轴末尾”的反馈清楚，四段视频都成功进入编排。受控 adoption bridge 是正向样本。

### 7.5 不是导出器完全没有音频

最终 MP4 实测含 AAC stereo 32kHz；ffmpeg 也读取并混合了四段输入音轨。错误的是持久 manifest，而不是最终执行没有声音。

## 8. 最终成片质量事实

最终文件：

```text
H.264
1920×1080
30 fps
50.4 seconds
AAC stereo 32 kHz
31,425,266 bytes
```

质量达标的主要原因：

- 四段都使用明确的镜头时序、单一机位运动和 9:16 中央安全区约束；
- 后三段把上一镜视频作为连续性入口；
- 两张锚图持续固定角色、胶片卷轴和手工电影世界；
- Seedance 原生音频被保留到最终导出；
- 用户及时指出底部字幕无法承担章节叙事，之后手工重做为居中标题；
- 最终通过 ffprobe、过渡帧、contact sheet 和音轨进行外部核验。

因此准确评价是：

> 模型与参考策略产生了好素材，人工编辑把它做成了好成片；但同样的质量目前还不能仅靠一次 MCP 制作操作稳定复演。

## 9. 回溯命令

生成任务：

```bash
jq -c 'select(.type=="vendor.call.requested" or .type=="vendor.call.completed")' \
  '<project>/.nomi/events/log-0.jsonl'
```

最终 export job：

```bash
jq '{id,status,manifest,result}' \
  '<project>/.nomi/jobs/457196f8-0e27-4f02-b871-b6e2555d5166/job.json'
```

持久 manifest 与实际 ffmpeg 对账：

```bash
jq '{profile,timeline,assets}' \
  '<project>/.nomi/jobs/457196f8-0e27-4f02-b871-b6e2555d5166/manifest.json'

sed -n '1,220p' \
  '<project>/.nomi/jobs/457196f8-0e27-4f02-b871-b6e2555d5166/ffmpeg.log'
```

最终媒体：

```bash
ffprobe -v error -show_format -show_streams \
  '<project>/exports/nomi-export-202608271734.mp4'
```

## 10. 本文停止在哪里

本文只做三件事：

1. 把真实用户旅程和落盘证据串起来；
2. 标明问题发生在 Nomi v0.21.0，并说明为什么无法精确到运行 commit；
3. 用最新已合入 PR 和 `origin/main@8f9365ae` 判断哪些是现行缺口、哪些已经解决、哪些只是观察。

本文不决定 UI 形态，不引入新 operation/store，不给出分期施工清单。后续若进入实现，应以这里的 13 个问题 ID 作为验收对象，而不是从一份预设架构方案倒推问题。
