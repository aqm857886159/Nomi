// Agent lane · `canvas.read` / `canvas.write` 的**执行那一半**。
//
// 说明书那一半（三个语义拆分的写工具、扁平 schema、typed 分镜形状、示例、容忍钩子）是
// `electron/shared/agentCapabilities/verbs/canvasVerbs.ts` 里的动词声明 —— 它不属于任何一个 profile，
// 对外 MCP 的 `nomi_canvas_edit` 读的是注册表派生的同一份（PR A 单一 owner）。
import {
  canvasReadResultSchema,
  type CanvasReadResult,
} from "../shared/agentCapabilities/canvasRead";
import {
  canvasWriteSemanticInputSchema,
  type CanvasWriteInput,
  type CanvasWriteResult,
} from "../shared/agentCapabilities/canvasWrite";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";

/** 领域侧。lane 不认识 React Flow，只认识「读一次画布」和「提一次可撤销的改动」。 */
export interface CanvasLanePort {
  read(context: LaneToolExecutionContext): Promise<unknown>;
  write(input: CanvasWriteInput, context: LaneToolExecutionContext): Promise<CanvasWriteResult>;
}

export function createCanvasLaneTools(port: CanvasLanePort): LaneToolDescriptor[] {
  return [...specsForCapability("canvas.read"), ...specsForCapability("canvas.write")].map((spec) => {
    if (spec.name === "nomi_canvas_read") {
      return bindLaneTool(spec, async (_args, context) => {
        const result: CanvasReadResult = canvasReadResultSchema.parse(await port.read(context));
        return { ok: true, text: formatCanvasForAgent(result), details: { nodeCount: result.nodes.length } };
      });
    }
    return bindLaneTool(spec, async (args, context) => {
      // `laneTools.mts` 在 pi 的 ajv 之后跑过契约自己的那一次 parse（扁平 schema 的
      // `transform` → union + 跨字段约束），所以这里拿到的已经是收窄的 `CanvasWriteInput`。
      // 这里**不再** parse——校验点只有那一个（G-08）。
      const input = args as CanvasWriteInput;
      const receipt = await port.write(input, context);
      return {
        ok: true,
        text: canvasWriteReceiptText(input, receipt),
        details: receipt,
      };
    });
  });
}

/**
 * 模型看到的是一张**收据**，不是被写进去的正文——正文它自己刚写的，回显一遍只是在烧上下文。
 * 标识留在结构化 details 供宿主关联；后续编辑先读画布拿到当前对象，不把收据 id 当用户文案。
 */
function canvasWriteReceiptText(input: CanvasWriteInput, receipt: CanvasWriteResult): string {
  if ("cancelled" in receipt) return `The user declined the ${input.operation} proposal. Nothing changed on the canvas.`;
  const lines = [`Applied ${receipt.operation}.`];
  if ("clientIdToNodeId" in receipt) {
    lines.push(`Created ${Object.keys(receipt.clientIdToNodeId).length} node(s). Use canvas read to inspect them before further edits.`);
  }
  if ("skippedEdges" in receipt && receipt.skippedEdges.length > 0) {
    lines.push(
      `${receipt.skippedEdges.length} reference edge(s) were skipped because the target model does not support them: `
      + [...new Set(receipt.skippedEdges.map((edge) => edge.reason))].join("; "),
    );
  }
  if ("changedShotIndexes" in receipt) {
    lines.push(`Changed shots ${receipt.changedShotIndexes.join(", ")} (fields: ${receipt.changedFields.join(", ")}).`);
  }
  return lines.join("\n");
}

export { canvasWriteSemanticInputSchema };
