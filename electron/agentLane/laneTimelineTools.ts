// Agent lane · `timeline.read` 的**执行那一半**。
//
// 说明书那一半是 `electron/shared/agentCapabilities/verbs/timelineVerbs.ts` 里的动词声明（两个 profile 共用）。
// 这里只绑 `timeline.read` 上真正走 typed port 的两个读动词（`read_timeline` / `inspect_timeline_range`）；
// `propose_edit_plan` 虽同属 `timeline.read` 契约，但走 `laneExtendedTools.ts` 的 dispatcher 路由。
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

export function createTimelineLaneTools(port: TimelineLanePort): LaneToolDescriptor[] {
  return specsForCapability("timeline.read").filter((spec) => spec.name !== TIMELINE_READ_ALIASES.proposePlan).map((spec) =>
    bindLaneTool(spec, async (args, context) => {
      const operation = spec.name as TimelineReadInput["operation"];
      const input = { operation, ...(args as Record<string, unknown>) } as TimelineReadInput;
      // 领域适配器的**输出**仍然校验：那是能力契约的收据形状（K1），
      // 与「模型输入校验几次」是两件事。
      const result: TimelineReadResult = projectTimelineReadResult(await port.read(input, context), operation);
      return { ok: true, text: JSON.stringify(result), details: { operation } };
    }),
  );
}
