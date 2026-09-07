// Agent lane · `timeline.read` 的模型可见工具面
//
// 这一族在 #547 里本来就是 100%（读类 37/37），所以它进阶段 2 不是为了修什么——
// 它是**对照组**：三个工具的形状（一别名一工具、单分支扁平 schema、无参数的那个真的不收参数）
// 与 `canvas.write` 那一族形成对比，评测里两族一起跑，才分得清「变好了」是形状的功劳
// 还是模型今天心情好。
//
// 实质增量是描述三通道 + 示例（#547：35/35 工具零示例）。
//
// ⚠️ **`propose_edit_plan` 本阶段不进 lane**，明着标出来而不是悄悄漏掉：
// 它的 `operations[]` 是一个 `z.union`，`transition` 与 `text` 两支各有一个叫 `action`
// 的字段、词表完全不同。扁平化把两支合成一个字段时只能发布一种形状，替作者挑一个
// 就等于悄悄放宽或收紧另一支——`flattenDiscriminatedUnion` 因此当场拒收（那正是它该做的）。
// 正确的修法是把两个 `action` 改成同一个形状、差额下沉进 refine，而那是**时间轴写入契约**
// 的改动，属于阶段 3（时间轴写入）的射程。今天硬塞进 lane 的代价是新通路第一天就带着
// 9 条 `const` 债；不塞的代价是时间轴少一个只读工具，而它不在本阶段的评测面上。
// 选后者：**新通路是干净的**，这条性质比多一个工具值钱。
import { z } from "zod";

import {
  TIMELINE_READ_ALIASES,
  TIMELINE_READ_CAPABILITY,
  timelineReadPiInputSchemaForAlias,
  projectTimelineReadResult,
  type TimelineReadInput,
  type TimelineReadResult,
} from "../shared/agentCapabilities/timelineRead";
import type { LaneToolSpec } from "../shared/agentLane/laneToolContract";
import { laneArgumentTolerance, laneNoArgumentTolerance } from "./laneArgumentTolerance";
import { bindLaneTool, type LaneToolDescriptor } from "./laneRuntimePort";

/** 领域侧。lane 不认识时间轴渲染，只认识「读一段」。 */
export interface TimelineLanePort {
  read(input: TimelineReadInput): Promise<unknown>;
}

/**
 * 通道③ · 时间轴这一族共享的纪律。
 *
 * 第二条是这一族唯一真会咬人的地方：`revision` 是乐观锁。模型拿着一个过期的 revision
 * 提计划，收到的拒绝理由如果只说「revision mismatch」，它下一步多半是把同一个数再发一遍。
 */
const TIMELINE_GUIDELINES = Object.freeze([
  "Frames, not seconds: every timeline position and duration in these tools is an integer frame count at the project fps returned by read_timeline.",
  "Always plan against a fresh revision: read the timeline, build the plan from what you just read, and pass that same revision back. If a plan is rejected for a stale revision, read again before retrying — resending the old number cannot succeed.",
]);

const TIMELINE_READ_EFFECTS = Object.freeze({ mutates: false, billable: false, reversal: "none" } as const);

interface TimelineToolShape {
  readonly alias: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly examples: LaneToolSpec["examples"];
  readonly arrayFields: readonly string[];
}

const TIMELINE_TOOLS: readonly TimelineToolShape[] = [
  {
    alias: TIMELINE_READ_ALIASES.read,
    description: [
      "Read the whole project timeline as a planning snapshot: fps, duration, playhead, every track and clip, text overlays and transitions.",
      "Takes no arguments. Call this first — the `revision` it returns is the optimistic lock every edit plan has to carry, and clip ids come from here.",
      "The snapshot is path-free: it names clips and source assets by id, never by a file path on disk.",
    ].join(" "),
    promptSnippet: "read the whole timeline (fps, clips, text, transitions) plus the revision to plan against.",
    examples: [{ when: "Always call it with no arguments:", arguments: {} }],
    arrayFields: [],
  },
  {
    alias: TIMELINE_READ_ALIASES.inspectRange,
    description: [
      "Inspect only the clips and text overlays that intersect one frame range of the timeline.",
      "Use this instead of read_timeline when the user is talking about a specific moment (\"the part around 0:30\") and the whole timeline would be far more than you need.",
      "`startFrame` and `endFrame` are integer frame numbers at the project fps; convert from seconds yourself using the fps from read_timeline.",
    ].join(" "),
    promptSnippet: "read just the clips and text inside one frame range.",
    examples: [{ when: "Look at the fourth to sixth second at 30fps:", arguments: { startFrame: 120, endFrame: 180 } }],
    arrayFields: [],
  },
];

/** 说明书那一半。门岗与系统提示词渲染只要这个，不需要任何领域 port。 */
export function timelineLaneToolSpecs(): LaneToolSpec[] {
  return TIMELINE_TOOLS.map((tool): LaneToolSpec => {
    const schema = timelineReadPiInputSchemaForAlias(tool.alias);
    if (!schema) throw new Error(`Unregistered timeline.read alias: ${tool.alias}`);
    return {
      name: tool.alias,
      capabilityId: TIMELINE_READ_CAPABILITY.id,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: TIMELINE_GUIDELINES,
      // 时间轴这一族本阶段**只有读**（写入那两个还带着形状冲突，见方案 §12.2 第 4 行）。
      effects: TIMELINE_READ_EFFECTS,
      schema,
      examples: tool.examples,
      prepareArguments: tool.arrayFields.length === 0 && isNoArgumentSchema(schema)
        ? laneNoArgumentTolerance
        : laneArgumentTolerance({ arrayFields: tool.arrayFields }),
    };
  });
}

/** 「这个工具真的不收参数吗」——判据取自 schema 本身，不靠别名清单再抄一遍。 */
function isNoArgumentSchema(schema: z.ZodTypeAny): boolean {
  const def = schema._def as { typeName?: string; shape?: () => z.ZodRawShape };
  if (def.typeName !== z.ZodFirstPartyTypeKind.ZodObject || !def.shape) return false;
  return Object.keys(def.shape()).length === 0;
}

export function createTimelineLaneTools(port: TimelineLanePort): LaneToolDescriptor[] {
  return timelineLaneToolSpecs().map((spec) =>
    bindLaneTool(spec, async (args) => {
      const operation = spec.name as TimelineReadInput["operation"];
      const input = { operation, ...(args as Record<string, unknown>) } as TimelineReadInput;
      // 领域适配器的**输出**仍然校验：那是能力契约的收据形状（K1），
      // 与「模型输入校验几次」是两件事。
      const result: TimelineReadResult = projectTimelineReadResult(await port.read(input), operation);
      return { ok: true, text: JSON.stringify(result), details: { operation } };
    }),
  );
}
