# IMPL · Agent 工具层施工图（P0-2 + P0-3 落地细节）

> 状态：📋 方案待拍板（2026-09-09 定稿，2026-09-11 归档入库）

> 2026-09-09 · 前置：[P0-2](P0-2-timeline-write-contract.md) / [P0-3](P0-3-transcript-layer.md) / [工具面政策](../../research/2026-09-09-agent-tool-surface-minimalism.md)
> 本文是写码级施工图：每个改动的**接口形状、落点文件、复用哪个现成模式**。开工前照例过 P5/R4；本文与代码冲突时以代码为准并回改本文。

---

## 0. 现成模板（照抄的接线模式，当日实核）

```
lane 工具 = spec(schema + examples + prepareArguments 容忍器)
          + bindLaneTool(spec, port 函数)          ← electron/agentLane/laneRuntimePort.ts
          + port 由装配层注入（createCanvasLaneTools(port: CanvasLanePort) 模式，
            laneCanvasTools.ts:270-288）
收据纪律：模型只收回执，不回显正文；收据必含「下一步要用的真实 id 映射」
        （clientIdToNodeId，laneCanvasTools.ts:296-300）；用户拒绝=诚实 cancelled 收据。
schema 生成：flattenDiscriminatedUnion(tool.union) 派生扁平版——手抄=第二真相源（:255-262）。
校验点唯一：laneTools.mts 的 ajv 之后契约自己 parse 一次，bind 回调里不再 parse（G-08）。
```

**结论：P0-2/P0-3 不发明任何新机制，全部按 CanvasLanePort 模式新增端口与 spec。**

## 1. 改动一：`TimelineWritePort` + `edit_timeline` 工具

### 1.1 端口接口（electron/agentLane/laneTimelineTools.ts 同文件扩展）

```ts
export interface TimelineWritePort {
  /** 提案化应用：renderer 端走 timelineCapabilityTarget（kernel+CAS），返回回执。 */
  plan(input: TimelineEditPlanInput): Promise<TimelineEditPlanReceipt>;
}
type TimelineEditPlanInput = {
  expectedRevision: string;               // read_timeline 返回的 revision（CAS）
  operations: TimelineOperation[];        // ← kernel 类型直接 import，不重定义
  rationale?: string;                     // 计划卡 summary
};
type TimelineEditPlanReceipt =
  | { status: "proposed"; proposalId: string; affects: {...}; pendingUserApproval: true }
  | { status: "stale"; currentRevision: string }        // 人话提示重读
  | { status: "rejected"; violations: string[] }        // validate 诊断原文
  | { status: "cancelled" };
```

### 1.2 工具契约（zod，从 kernel union derive）

- `operations` 的每个分支从 `timelineKernel.ts` 的 `TimelineOperation` 类型**派生 zod schema**（type→zod 手写映射表放 `electron/shared/agentCapabilities/timelineWrite.ts`，**一个 owner**；`check:timeline-contract` 门核验它与 kernel 的字段级一致）。
- `propose_edit_plan` 旧债的修法在此落实：transition/text 两支的 `action` 统一为 `{ set | clear }` + 分支专属字段（原方案 A' 设计不变）。
- `arrayFields: ["operations"]` 进容忍器（B 族）。
- **3 个示例**：①对调两镜（两个 move）②全片字幕改字号（text update ×n 说明可批量）③ 4-6 镜加 dissolve。
- 工具描述四句：帧原生 / 先 read 拿 revision / 重叠会被 validate 拒绝且回话说明 / 每次是提案要用户批准。

### 1.3 renderer 执行点（复用，不新建）

- 端口实现接 `src/workbench/timeline/agent/timelineCapabilityTarget.ts:167`（已消费 `applyTimelineOperations` + expectedRevision）——**执行逻辑零新增**；新写的只有：lane 主进程→renderer 的桥（照 canvas write 端口的装配路径）+ 采纳桥幂等键（`runId+contractHash+revision`，复用 `adoptStoryboardBatch` 模式）。

### 1.4 收据设计（laneCanvasTools.ts:296 模式）

```text
Proposed edit plan · 5 operations · 2 clips affected. Proposal pr-8f2a.
The user must approve before anything changes. Use read_timeline after approval to get the new revision.
```

stale 时：`Timeline changed since you read it (revision a1→b3). Read the timeline again — resending the old revision cannot succeed.`（照抄 TIMELINE_GUIDELINES 第二条的口径）。

## 2. 改动二：`check:timeline-contract` 门（scripts/checks/）

- **输入三源**：① `timelineKernel.ts` 的操作 union（类型扫描：kind 字面量+每 kind 必填字段）② `electron/shared/agentCapabilities/timelineWrite.ts` 的 zod schema ③ `ffmpegFiltergraph.ts` 的 transition 支持集。
- **规则**：kernel 有而 schema 无（模型看不见）→红；schema 有而 kernel 无（模型会调用但不存在的操作）→红；transition 词表超出 filtergraph 支持集→红。
- **实现**：AST 扫描（参照 `check:vocabularies` 的现成手法），R17 纪律：**加规则先验它会红**（先用现状「match_cut 在 schema 而 filtergraph 只 warning」造红再收）。

## 3. 改动三：`understanding.ts` + transcript 两工具

### 3.1 服务（electron/video/understanding.ts）

```ts
export async function transcribe(input: {
  videoLocalPath: string; fps: number; language?: string;
}): Promise<{ segments: TranscriptSegment[]; language: string; hasAudio: boolean }>
// TranscriptSegment { startFrame, endFrame, text, confidence? }
// 复用 extractAudioTrack + whisper verbose_json（#259 同链路），帧换算在此唯一 owner。
```

- 资产落库：`TranscriptAsset` 挂源视频节点 meta（与 `videoAnalysis` 同位），素材库登记。
- `deconstructVideo.ts` 改为 import 此服务（同 commit 删内联 whisper 调用）。

### 3.2 两工具（照 CanvasLanePort 模式，端口=读服务）

- `read_transcript { sourceAssetId?, fromFrame?, toFrame?, maxSegments?=200 }`：紧凑视图 `140.2-146.8 真的太划算了一共五折`，一行一句；**未返回=未知不假装全量**。
- `find_transcript { query, sourceAssetId? }`：返回 `{ matches: [{ startFrame, endFrame, text }] }`，上限 20 条+hint「缩窄来源或换词」。
- 语言参数服务端 derive（C0 教训），schema 不收。

## 4. 改动四：capability 组与装配

- `agentChatPolicy.ts:35`：`canvas-agent` 组加入 `edit_timeline` / `read_transcript` / `find_transcript`（写类走 `PRODUCTION/ARTIFACT` 同款 aliases 注册：`electron/shared/agentCapabilities/` 定义 capability + pi/mcp 双通道别名）。
- 预算：这三工具计入 `canvas-agent` 组步数，不改全局 8/24 上限（管线设档另案）。
- MCP 外暴：`read_transcript`/`find_transcript` 进 `mcpToolCatalog`（只读无审批边界，schema 即校验边界）。

## 5. 分期（commit 粒度）

| T | 内容 | 先红用例 |
|---|---|---|
| T1 | `timelineWrite.ts` schema + `check:timeline-contract` 门（现状 match_cut 造红→修词表收绿） | 门先红 |
| T2 | `TimelineWritePort` + renderer 桥 + `edit_timeline` 进 lane（带 3 示例） | stale revision 重试路径；必失败操作回执 |
| T3 | `understanding.ts` + transcript 资产 + 两工具 + 拆解引擎切换 | 无音频诚实 hasAudio:false；find 未命中 |
| T4 | 计划卡 UI（affects 分组+逐项勾选+预演 toggle，按交互研究 §三 ProposalCard 规格） | 人眼走查 R13 |

## 6. 验收门（R16 真实任务）

1. 「第 3/5 镜对调 + 全片字幕 24 号 + 4-6 镜 dissolve」→ 计划卡逐项勾选 → 批准 → 一步撤销 → read_timeline 得新 revision。
2. 10 分钟口播 → `find_transcript("价格")` 帧区间正确 → 生成粗剪计划卡。
3. #646 合并后全链路：说想法→分镜→生成→粗剪提案→批准→MP4。
4. 五门绿 + 新门 `check:timeline-contract` 入 gates。

## 7. 不动项

- kernel 的 10 原语与 CAS 语义**零改动**（只加消费）。
- 不新建第二落轴路径（一切写经 kernel+采纳桥）。
- 不给内置 agent shell；MCP 面不新增非只读工具。
- `read_state(projection)` 三合一挂 P2 评估，本轮不做。
