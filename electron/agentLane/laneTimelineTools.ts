// Agent lane · `timeline.read` 的**执行那一半**。
//
// 说明书那一半是 `verbs/readVerbs.ts` 的 `read_timeline`：给了 startFrame/endFrame 就只看那一段
// （契约 operation `inspect_timeline_range`），否则整条（`read_timeline`，唯一带 revision 的读）。
import {
  TIMELINE_READ_ALIASES,
  projectTimelineReadResult,
  type TimelineReadInput,
  type TimelineReadResult,
} from "../shared/agentCapabilities/timelineRead";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";

/** 领域侧。lane 不认识时间轴渲染，只认识「读一段」。 */
export interface TimelineLanePort {
  read(input: TimelineReadInput, context: LaneToolExecutionContext): Promise<unknown>;
}

/** `read_timeline` 参数 → 契约语义输入。范围齐全才是 range 读；只给一半按契约的跨字段约束拒。 */
export function timelineReadInputOf(args: unknown): TimelineReadInput {
  const { startFrame, endFrame } = args as { startFrame?: number; endFrame?: number };
  if (startFrame === undefined && endFrame === undefined) return { operation: TIMELINE_READ_ALIASES.read } as TimelineReadInput;
  return { operation: TIMELINE_READ_ALIASES.inspectRange, startFrame: startFrame ?? 0, endFrame: endFrame ?? 0 } as TimelineReadInput;
}

export function createTimelineLaneTools(port: TimelineLanePort): LaneToolDescriptor[] {
  return specsForCapability("timeline.read").map((spec) =>
    bindLaneTool(spec, async (args, context) => {
      const input = timelineReadInputOf(args);
      const result: TimelineReadResult = projectTimelineReadResult(await port.read(input, context), input.operation);
      return { ok: true, text: JSON.stringify(result), details: { operation: input.operation } };
    }),
  );
}
