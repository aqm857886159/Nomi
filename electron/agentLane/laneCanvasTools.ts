// Agent lane · `canvas.read` / `canvas.write` 的**执行那一半**。
//
// 说明书那一半是 `verbs/readVerbs.ts` 的 `look_at_canvas` 与 `verbs/writeVerbs.ts` 的
// `arrange_canvas` / `make_artifact` / `stage_shot`。这里把动词参数翻成契约的 `CanvasWriteInput`
// （`canvasWriteInputOf`，唯一对应表；`laneDesktopTools.ts` 的 prepare 也用它），再交给活着的领域 port。
// 造生成类节点的入口**不在这里**——那只归 `draft_shots`；三个画布写动词的 `prepareArguments` 已在 ajv 之前
// 把这种意图按 `wrong_verb` 拒掉。
import { canvasReadResultSchema, type CanvasReadResult } from "../shared/agentCapabilities/canvasRead";
import { canvasWriteSemanticInputSchema, type CanvasWriteInput, type CanvasWriteResult } from "../shared/agentCapabilities/canvasWrite";
import { specsForCapability } from "../shared/agentCapabilities/modelFacingToolRegistry";
import { formatCanvasForAgent } from "../shared/agentCapabilities/canvasReadCompact";
import { bindLaneTool, type LaneToolDescriptor, type LaneToolExecutionContext } from "./laneRuntimePort";

/** 领域侧。lane 不认识 React Flow，只认识「读一次画布」和「提一次可撤销的改动」。 */
export interface CanvasLanePort {
  read(context: LaneToolExecutionContext): Promise<unknown>;
  write(input: CanvasWriteInput, context: LaneToolExecutionContext): Promise<CanvasWriteResult>;
}

type ArrangeArgs = { links?: Array<{ fromId: string; toId: string; role?: string }>; tidy?: boolean; categoryId?: string };
type ArtifactArgs = { fileType: string; title: string; content: string };
type StageArgs = { shotId: string; staging?: Record<string, unknown>; cameraMove?: Record<string, unknown> };

/** 动词参数 → 契约语义输入。**唯一对应表**；返回值再过一次契约 parse，保证跨字段约束（连边至少一条等）照旧生效。 */
export function canvasWriteInputOf(verb: string, args: unknown): CanvasWriteInput {
  let semantic: unknown;
  // Retired canvas aliases remain executable for persisted transcripts.
  const canonicalVerb = ["nomi_canvas_write", "nomi_canvas_edit", "nomi_canvas_plan", "nomi_storyboard_write", "nomi_shot_reference_write"].includes(verb) ? "arrange_canvas" : verb;
  if (canonicalVerb === "arrange_canvas") {
    const { links, tidy, categoryId } = args as ArrangeArgs;
    if (links && links.length > 0) {
      semantic = { operation: "connect_canvas_edges", edges: links.map((link) => ({ sourceClientId: link.fromId, targetClientId: link.toId, ...(link.role ? { mode: link.role } : {}) })) };
    } else if (tidy) {
      semantic = { operation: "tidy_canvas", ...(categoryId ? { categoryId } : {}) };
    } else {
      throw new Error("arrange_canvas needs links to connect or tidy: true");
    }
  } else if (canonicalVerb === "make_artifact") {
    const { fileType, title, content } = args as ArtifactArgs;
    semantic = {
      operation: "create_canvas_nodes", summary: title,
      nodes: [{ clientId: "artifact-1", kind: "agent-artifact", title, prompt: "", artifact: { fileType, content } }],
    };
  } else if (canonicalVerb === "stage_shot") {
    const { shotId, staging, cameraMove } = args as StageArgs;
    semantic = staging
      ? { operation: "create_staging_reference", shotClientId: shotId, ...staging }
      : { operation: "create_camera_move", shotClientId: shotId, ...cameraMove };
  } else {
    throw new Error(`Unregistered canvas verb: ${verb}`);
  }
  return canvasWriteSemanticInputSchema.parse(semantic);
}

export function createCanvasLaneTools(port: CanvasLanePort): LaneToolDescriptor[] {
  const specs = [...specsForCapability("canvas.read"), ...specsForCapability("canvas.write")]
  // Keep retired Pi/MCP/UI names readable by old transcripts while routing them
  // through the canonical canvas.write implementation.
  const write = specs.find(spec => spec.name === "nomi_canvas_write") ?? specs.find(spec => spec.contractId === "canvas.write")
  if (write) for (const name of ["nomi_canvas_write", "nomi_canvas_edit", "nomi_canvas_plan"]) {
    if (!specs.some(spec => spec.name === name)) specs.push({ ...write, name })
  }
  return specs.map((spec) => {
    if (spec.contractId === "canvas.read") {
      return bindLaneTool(spec, async (_args, context) => {
        const result: CanvasReadResult = canvasReadResultSchema.parse(await port.read(context));
        return { ok: true, text: formatCanvasForAgent(result), details: { nodeCount: result.nodes.length } };
      });
    }
    return bindLaneTool(spec, async (args, context) => {
      const input = canvasWriteInputOf(spec.name, args);
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
  const lines = [`Applied ${input.operation}.`];
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
