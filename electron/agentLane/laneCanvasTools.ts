// Agent lane · `canvas.read` / `canvas.write` 的**执行那一半**。
//
// 说明书那一半是 `verbs/readVerbs.ts` 的 `look_at_canvas` 与 `verbs/writeVerbs.ts` 的
// `arrange_canvas` / `make_artifact` / `stage_shot`。动词参数 → 契约 `CanvasWriteInput` 的翻译住在声明上
// （`verbs/verbSemanticInput.ts` 的 `canvasWriteInputOf`，两个 profile 共用），这里只执行。
// 造生成类节点的入口**不在这里**——那只归 `draft_shots`；三个画布写动词的 `prepareArguments` 已在 ajv 之前
// 把这种意图按 `wrong_verb` 拒掉。
import { canvasReadResultSchema, type CanvasReadResult } from "../shared/agentCapabilities/canvasRead";
import { canvasWriteSemanticInputSchema, type CanvasWriteInput, type CanvasWriteResult } from "../shared/agentCapabilities/canvasWrite";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { projectsToProfile } from "../shared/agentCapabilities/modelFacingTools";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";
import { toSemanticInput } from "../shared/agentCapabilities/modelFacingTools";

/** 领域侧。lane 不认识 React Flow，只认识「读一次画布」和「提一次可撤销的改动」。 */
export interface CanvasLanePort {
  read(context: LaneToolExecutionContext): Promise<unknown>;
  write(input: CanvasWriteInput, context: LaneToolExecutionContext): Promise<CanvasWriteResult>;
}

export function createCanvasLaneTools(port: CanvasLanePort): LaneToolDescriptor[] {
  const specs = [...specsForCapability("canvas.read"), ...specsForCapability("canvas.write")]
    .filter(spec => projectsToProfile(spec, "internal"))
  return specs.map((spec) => {
    if (spec.contractId === "canvas.read") {
      return bindLaneTool(spec, async (_args, context) => {
        const result: CanvasReadResult = canvasReadResultSchema.parse(await port.read(context));
        return { ok: true, text: formatCanvasForAgent(result), details: { nodeCount: result.nodes.length } };
      });
    }
    return bindLaneTool(spec, async (args, context) => {
      const input = toSemanticInput(spec, args as Record<string, unknown>) as CanvasWriteInput;
      const receipt = await port.write(input, context);
      return { ok: true, text: canvasWriteReceiptText(input, receipt), details: receipt, nextAction: canvasWriteNextAction(input, receipt) };
    });
  });
}

function canvasWriteNextAction(input: CanvasWriteInput, receipt: CanvasWriteResult): { kind: "none"; userSees: string } {
  if ("cancelled" in receipt) return { kind: "none", userSees: "Nothing changed: the user declined the proposal." };
  const what = input.operation === "connect_canvas_edges" ? "the new reference links"
    : input.operation === "tidy_canvas" ? "the tidied layout"
      : input.operation === "create_canvas_nodes" ? "the new artifact node"
        : "the new director reference node next to the shot";
  return { kind: "none", userSees: `The canvas shows ${what}; the user can undo it with Cmd+Z. Nothing was generated and nothing was spent.` };
}

/**
 * 模型看到的是一张**收据**，不是被写进去的正文——正文它自己刚写的，回显一遍只是在烧上下文。
 */
function canvasWriteReceiptText(input: CanvasWriteInput, receipt: CanvasWriteResult): string {
  if ("cancelled" in receipt) return `The user declined the ${input.operation} proposal. Nothing changed on the canvas.`;
  const lines = [`Applied directly (undoable).`];
  if ("clientIdToNodeId" in receipt) {
    lines.push(`Created ${Object.keys(receipt.clientIdToNodeId).length} node(s). Use look_at_canvas to inspect them before further edits.`);
  }
  if ("skippedEdges" in receipt && receipt.skippedEdges.length > 0) {
    lines.push(
      `${receipt.skippedEdges.length} reference edge(s) were skipped because the target model does not support them: `
      + [...new Set(receipt.skippedEdges.map((edge) => edge.reason))].join("; "),
    );
  }
  return lines.join("\n");
}

export { canvasWriteSemanticInputSchema };
