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
import { DIRECTOR_WRITE_CAPABILITY, type DirectorWriteInput, type DirectorWriteResult } from "../shared/agentCapabilities/directorWrite";
import { LaneDomainFailure } from "../shared/agentLane/laneToolContract";

/** 领域侧。lane 不认识 React Flow，只认识「读一次画布」和「提一次可撤销的改动」。 */
export interface CanvasLanePort {
  read(context: LaneToolExecutionContext): Promise<unknown>;
  write(input: CanvasWriteInput, context: LaneToolExecutionContext): Promise<CanvasWriteResult>;
  /**
   * 3D-BOX（开关开时才有这个动词）：同一个渲染端写口，契约 `director.write`。可选：开关关的构建与只测画布读写的
   * 夹具不必提供；开关开却没接上时，`stage_shot` 如实报「这个宿主不支持」。
   */
  writeDirector?(input: DirectorWriteInput, context: LaneToolExecutionContext): Promise<DirectorWriteResult>;
}

export function createCanvasLaneTools(port: CanvasLanePort): LaneToolDescriptor[] {
  const specs = [...specsForCapability("canvas.read"), ...specsForCapability("canvas.write"), ...specsForCapability(DIRECTOR_WRITE_CAPABILITY.id)]
    .filter(spec => projectsToProfile(spec, "internal"))
  return specs.map((spec) => {
    if (spec.contractId === "canvas.read") {
      return bindLaneTool(spec, async (_args, context) => {
        const result: CanvasReadResult = canvasReadResultSchema.parse(await port.read(context));
        return { ok: true, text: formatCanvasForAgent(result), details: { nodeCount: result.nodes.length } };
      });
    }
    if (spec.contractId === DIRECTOR_WRITE_CAPABILITY.id) {
      return bindLaneTool(spec, async (args, context) => {
        const input = toSemanticInput(spec, args as Record<string, unknown>) as DirectorWriteInput;
        if (!port.writeDirector) throw new LaneDomainFailure({ code: "capability_unsupported", message: "This host has no 3D-BOX director surface, so stage_shot cannot build a preview here.", nextAction: "Tell the user the 3D-BOX preview is not available in this session. Nothing was changed." });
        const result = await port.writeDirector(input, context);
        if (!result.applied) throw new LaneDomainFailure(directorRejection(result));
        return { ok: true, text: directorReceiptText(result), details: result, nextAction: {
          kind: "none" as const,
          userSees: result.unchanged
            ? "Nothing changed: the plan already says this."
            : "The 3D-BOX preview on the canvas is updating; the user can undo it with Cmd+Z. Nothing was generated and nothing was spent.",
          changeId: result.changeId,
        } };
      });
    }
    return bindLaneTool(spec, async (args, context) => {
      const input = toSemanticInput(spec, args as Record<string, unknown>) as CanvasWriteInput;
      const receipt = await port.write(input, context);
      return { ok: true, text: canvasWriteReceiptText(input, receipt), details: receipt, nextAction: canvasWriteNextAction(input, receipt) };
    });
  });
}

function canvasWriteNextAction(input: CanvasWriteInput, receipt: CanvasWriteResult): { kind: "none"; userSees: string; changeId?: string } {
  if ("cancelled" in receipt) return { kind: "none", userSees: "Nothing changed: the user declined the proposal." };
  const what = input.operation === "connect_canvas_edges" ? "the new reference links"
    : input.operation === "tidy_canvas" ? "the tidied layout"
      : input.operation === "set_node_text" ? "the new text in the node (the node is marked as edited by you in the change card)"
      : input.operation === "create_canvas_nodes" ? "the new artifact node"
        : "the new director reference node next to the shot";
  return { kind: "none", userSees: `The canvas shows ${what}; the user can undo it with Cmd+Z. Nothing was generated and nothing was spent.`, changeId: receipt.changeId };
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

type DirectorRejected = Extract<DirectorWriteResult, { applied: false }>;
type DirectorApplied = Extract<DirectorWriteResult, { applied: true }>;

/** 领域拒绝 → 模型读得懂的失败：哪里不成立、当前修订号、下一步。画布在这种结果里一个字没动。 */
function directorRejection(result: DirectorRejected) {
  const why = result.messages.join("; ");
  if (result.rejected === "stale_revision") {
    return { code: "capability_target_stale", message: `The 3D-BOX plan changed since you read it (baseRevision is stale${result.currentRevision ? `; current revision is ${result.currentRevision}` : ""}).`,
      nextAction: "Read it again with look_at_canvas or use the plan from the last stage_shot result, rebuild the edits against that revision, then call stage_shot again. Nothing was changed." };
  }
  if (result.rejected === "target_missing") {
    return { code: "capability_target_stale", message: `stage_shot could not find its target: ${why}.`,
      nextAction: "Read the canvas with look_at_canvas and use an id that is there now. Nothing was changed." };
  }
  return { code: "capability_input_invalid", message: `The director plan was not applied: ${why}.`,
    nextAction: "Fix exactly these points and call stage_shot again. Nothing was changed." };
}

type PlanShotView = { id: string; index: number; size?: string };

function planShotsOf(plan: unknown): Map<string, PlanShotView> {
  const shots = (plan as { shots?: { id?: unknown; size?: unknown }[] } | null)?.shots;
  return new Map((Array.isArray(shots) ? shots : []).map((shot, index) => [String(shot.id ?? ""), { id: String(shot.id ?? ""), index: index + 1, ...(typeof shot.size === "string" ? { size: shot.size } : {}) }]));
}

/** 手调条目 `shot:<名>/camera.position` → 「shot 2 (over_shoulder) camera」，模型能原样复述给用户。 */
function overrideLabel(item: string, shots: ReadonlyMap<string, PlanShotView>): string {
  const camera = /^shot:(.+)\/camera(?:\.(.+))?$/.exec(item);
  if (camera) {
    const shot = shots.get(camera[1]);
    return `${shot ? `shot ${shot.index} (${camera[1]})` : camera[1]} camera${camera[2] ? ` ${camera[2]}` : ""}`;
  }
  return item;
}

/**
 * 收据：修订号、被覆盖的手调、逐 cut 实测（与计划要求并排写明）、问题、预演状态，最后是规范化后的完整计划（下一次补丁的基准）。
 * 真实测试 ④ 两条教训定了写法：①计划 JSON 里的 size 是「要求」，模型曾把它当实测复述（说的≠摆的）——每行实测都点名「实测」并把计划要求写在旁边；
 * ②被覆盖的手调此前根本不在收据里，模型没法提——现在逐条列出、并说明撤销能放回来（面板上另有宿主确定性的一句，不靠这里）。
 */
function directorReceiptText(result: DirectorApplied): string {
  const shots = planShotsOf(result.plan);
  const lines = [result.unchanged
    ? `Unchanged: the plan already says this (revision ${result.revision}). No recompile, no new preview.`
    : `Applied (undoable: undo with changeId ${result.changeId}). 3D-BOX node ${result.directorNodeId}, revision ${result.revision}.`];
  if (result.touched.length) lines.push(`Changed: ${result.touched.join(", ")}.`);
  if (result.reorderedOverrides.length) {
    lines.push(`Hand adjustments REPLACED by this edit: ${result.reorderedOverrides.map((item) => overrideLabel(item, shots)).join(", ")}. The user had adjusted these by hand; tell them in one sentence that this change replaced those adjustments and that undo brings them back.`);
  }
  if (result.changedEntities.length) lines.push(`Also moved by recompiling (the user's hand adjustments there are kept): ${result.changedEntities.map((item) => overrideLabel(item, shots)).join(", ")}.`);
  if (result.cuts.length) {
    lines.push("Measured cuts — what the 3D preview ACTUALLY frames. When you report framing to the user, report these measured values, never the plan's requested size:");
    for (const cut of result.cuts) {
      const shot = cut.shot === null ? undefined : shots.get(cut.shot);
      const name = shot ? `shot ${shot.index} (${cut.shot})` : cut.shot ?? "unmatched cut";
      const measured = cut.shotSize ?? "no measurable subject";
      const asked = shot?.size ? (shot.size === cut.shotSize ? `; plan asked ${shot.size}, matches` : `; plan asked ${shot.size}, measured differs — say so`) : "";
      lines.push(`- ${name} ${cut.start.toFixed(1)}-${cut.end.toFixed(1)}s: measured ${measured}, move ${cut.move}${asked}`);
    }
  }
  lines.push(result.issues.length
    ? `Issues (${result.issues.length}): ${result.issues.slice(0, 12).map((issue) => `[${issue.kind}] ${issue.message}`).join("; ")}`
    : "Issues: none.");
  const preview = result.preview;
  lines.push(preview.status === "rendering"
    ? `Preview: rendering${preview.targetNodeId ? ` for ${preview.targetNodeId}` : ""}; generation of that shot waits until it is attached.`
    : preview.status === "failed" ? `Preview: failed (${preview.reason ?? "unknown"}); generation of that shot stays blocked until it is retried.`
      : preview.status === "ready" ? `Preview: attached${preview.attach === "prompt_only" ? " as a text description only (this model takes no reference video; camera accuracy will be lower)" : " as reference video"}${preview.assetId ? `; preview asset id ${preview.assetId}` : ""}.`
        : "Preview: standalone (no shot attached).");
  lines.push(`Plan at ${result.revision} (base for the next edits; its "size" fields are REQUESTS, not measurements): ${JSON.stringify(result.plan)}`);
  return lines.join("\n");
}