// Agent lane · `timeline.read` 的**执行那一半**。
//
// 说明书那一半是 `verbs/readVerbs.ts` 的 `read_timeline`：给了 startFrame/endFrame 就只看那一段
// （契约 operation `inspect_timeline_range`），否则整条（`read_timeline`，唯一带 revision 的读）。
import {
  projectTimelineReadResult,
  type TimelineReadInput,
  type TimelineReadResult,
} from "../shared/agentCapabilities/timelineRead";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { toSemanticInput } from "../shared/agentCapabilities/modelFacingTools";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";

/** 领域侧。lane 不认识时间轴渲染，只认识「读一段」。 */
export interface TimelineLanePort {
  read(input: TimelineReadInput, context: LaneToolExecutionContext): Promise<unknown>;
}

export function createTimelineLaneTools(port: TimelineLanePort): LaneToolDescriptor[] {
  return specsForCapability("timeline.read").map((spec) =>
    bindLaneTool(spec, async (args, context) => {
      // 参数 → 契约 operation 的翻译住在声明上（`verbs/verbSemanticInput.ts`），两个 profile 同一张表。
      const input = toSemanticInput(spec, args as Record<string, unknown>) as TimelineReadInput;
      const result: TimelineReadResult = projectTimelineReadResult(await port.read(input, context), input.operation);
      return { ok: true, text: JSON.stringify(result), details: { operation: input.operation } };
    }),
  );
}
