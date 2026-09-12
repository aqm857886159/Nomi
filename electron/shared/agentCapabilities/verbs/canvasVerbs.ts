// `canvas.read` / `canvas.write` / `canvas.delete` 的动词声明（两个 profile 共用；执行那一半住
// `electron/agentLane/laneCanvasTools.ts` 与 `laneExtendedTools.ts`）。
//
// 三个写动词是 #547 的靶心：一个工具塞 9 个分支的 0/18 被拆成三个语义分组、根级 union 被
// `flattenDiscriminatedUnion` 派生成根是 object 的扁平 schema、分镜的 typed 形状从 `canvasModelShapes.ts`
// 替换掉契约上的 `z.record(z.unknown())`。**不是重写，是替换掉弱的那一份。**
import { z } from "zod";

import {
  cameraMoveParamsObjectSchema,
  STORYBOARD_MODEL_GUIDELINES, STAGING_MODEL_GUIDELINES, CAMERA_MOVE_MODEL_GUIDELINES,
  stagingReferenceParamsSchema,
  storyboardPlanParamsSchema,
} from "../canvasModelShapes";
import {
  canvasNodeWriteInputSchema, CANVAS_NODE_PROMPT_GUIDELINES,
  canvasWriteCrossFieldRefine,
  shotReferenceWriteInputUnion,
  storyboardPlanActionInputSchema,
  storyboardWriteInputUnion,
} from "../canvasWrite";
import { CANVAS_DELETE_ALIAS, canvasDeletePiInputSchema } from "../canvasDelete";
import { flattenDiscriminatedUnion } from "../flatModelInput";
import { modelArgumentTolerance, noArgumentTolerance } from "../modelArgumentTolerance";
import { NO_ARGUMENTS_SCHEMA } from "../verbDeclaration";
import type { VerbDeclaration } from "../verbDeclaration";

/** 通道③ · 画布这一族共享的纪律，只写一次。 */
const CANVAS_GUIDELINES = Object.freeze([
  "Read the canvas before you change it: node ids, shot numbers and model keys all come from what is actually there.",
  "Never invent a modelKey, vendor or nodeId. Use the exact values returned by nomi_canvas_read or listed in the user's available-models list; leave the field out when you are unsure and the system fills in a default.",
  "Every canvas write is a reversible proposal the user still has to accept — describe what you are proposing in your reply rather than claiming it is already done.",
]);

const storyboardPlanModelBranch = storyboardPlanActionInputSchema.extend({
  anchors: storyboardPlanParamsSchema.shape.anchors,
  shots: storyboardPlanParamsSchema.shape.shots,
});

// 分组是从 `.options` 拼出来的裸 union，**不会继承**契约外层的 `superRefine`——跨字段约束再挂一次，
// 用的是同一个函数（`canvasWriteCrossFieldRefine`，唯一 owner）。
const storyboardModelUnion = z.discriminatedUnion("operation", [
  storyboardPlanModelBranch as unknown as z.ZodDiscriminatedUnionOption<"operation">,
  ...storyboardWriteInputUnion.options.filter(
    (option) => option.shape.operation.value !== "propose_storyboard_plan",
  ) as unknown as z.ZodDiscriminatedUnionOption<"operation">[],
]).superRefine(canvasWriteCrossFieldRefine);

const stagingModelBranch = shotReferenceWriteInputUnion.options[0].extend({
  characters: stagingReferenceParamsSchema.shape.characters,
  layout: stagingReferenceParamsSchema.shape.layout,
  camera: stagingReferenceParamsSchema.shape.camera,
  environment: stagingReferenceParamsSchema.shape.environment,
  crowd: stagingReferenceParamsSchema.shape.crowd,
  sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
  props: stagingReferenceParamsSchema.shape.props,
  customBlocking: stagingReferenceParamsSchema.shape.customBlocking,
});

const cameraMoveModelBranch = shotReferenceWriteInputUnion.options[1].extend({
  move: cameraMoveParamsObjectSchema.shape.move,
  customMove: cameraMoveParamsObjectSchema.shape.customMove,
  speed: cameraMoveParamsObjectSchema.shape.speed,
  shot: cameraMoveParamsObjectSchema.shape.shot,
  subjectPose: cameraMoveParamsObjectSchema.shape.subjectPose,
  sceneTemplate: stagingReferenceParamsSchema.shape.sceneTemplate,
  props: stagingReferenceParamsSchema.shape.props,
});

type OperationBranch = z.ZodDiscriminatedUnionOption<"operation">;

const shotReferenceModelUnion = z.discriminatedUnion("operation", [
  stagingModelBranch as unknown as OperationBranch,
  cameraMoveModelBranch as unknown as OperationBranch,
]).superRefine(canvasWriteCrossFieldRefine);

const canvasWriteTolerance = (arrayFields: readonly string[], objectFields: readonly string[]) =>
  modelArgumentTolerance({ arrayFields, objectFields });

export function canvasVerbs(): VerbDeclaration[] {
  const read: VerbDeclaration = {
    name: "nomi_canvas_read",
    contractId: "canvas.read",
    effect: "read",
    nextAction: "none",
    describe: {
      does: "Read the generation canvas: every node (id, kind, title, prompt, status, position), reference edges and groups.",
      useWhen: "Call it before any canvas write and whenever the user asks what is on the canvas — node ids, shot numbers and existing prompts all come from here, and inventing an id is the single most common way a canvas edit fails.",
      notWhen: "Do not use it to read the script (read_full_text), the timeline (read_timeline) or the media library (search_media). It never changes anything.",
      params: "Takes no arguments. Node ids returned here are the exact strings to pass as nodeId / sourceClientId / targetClientId to nomi_canvas_write.",
    },
    promptGuidelines: CANVAS_GUIDELINES,
    schema: NO_ARGUMENTS_SCHEMA,
    examples: [{ when: "Always call it with no arguments:", arguments: {} }],
    prepareArguments: noArgumentTolerance,
  };

  const canvasWrite: VerbDeclaration = {
    name: "nomi_canvas_write",
    contractId: "canvas.write",
    effect: "reversible_local",
    nextAction: "none",
    effectGroups: ["canvas-node-creation"],
    describe: {
      does: "Create, connect, retitle or tidy generation-canvas nodes in one reversible batch.",
      useWhen: "Use it when the user asks to connect nodes as references, rename or reposition them, tidy the layout, or create non-generating objects such as artifacts you hand-author yourself. Send one operation per call but batch every node of that operation together.",
      notWhen: "Do not use it when the user described an image, video, audio or 3D model to generate — that is nomi_generation_plan, the only tool that produces a priced draft; a node created here for media stays empty. Do not use it for a whole storyboard (nomi_storyboard_write), for an approved production storyboard artifact (materialize_production_storyboard), or for staging and camera references (nomi_shot_reference_write). Do not use it to delete (delete_canvas_nodes).",
      params: "The operation selects which fields apply and unrelated fields are rejected. Node ids, model keys and vendor names must come from nomi_canvas_read or the user's available-models list; inventing one fails the call.",
    },
    promptGuidelines: [...CANVAS_GUIDELINES, "Send a whole batch in one call rather than one node at a time.", ...CANVAS_NODE_PROMPT_GUIDELINES],
    schema: flattenDiscriminatedUnion(canvasNodeWriteInputSchema, { name: "nomi_canvas_write" }),
    examples: [{ when: "Create one shot node (title given by the user):", arguments: { operation: "create_canvas_nodes", summary: "开场镜头", nodes: [{ clientId: "s1", kind: "keyframe", title: "开场", prompt: "清晨日出" }] } }],
    prepareArguments: canvasWriteTolerance(["nodes", "edges"], []),
  };

  const storyboardWrite: VerbDeclaration = {
    name: "nomi_storyboard_write",
    contractId: "canvas.write",
    effect: "reversible_local",
    nextAction: "none",
    effectGroups: ["canvas-node-creation", "finished-piece"],
    describe: {
      does: "Save, patch or arrange a whole storyboard (the ordered shots of a piece), not a single shot.",
      useWhen: "Use it when the user asks for a storyboard or a set of shots: propose_storyboard_plan replaces the entire plan, patch_shots changes only the rows you name, arrange_storyboard_to_timeline lays existing shot nodes out in story order.",
      notWhen: "Do not use it for one described image or video (nomi_generation_plan), for wiring or renaming individual nodes (nomi_canvas_write), or for a storyboard that already exists as an approved production artifact (materialize_production_storyboard). Do not use it for a finished multi-minute piece that needs a brief and playbook (start_production_run).",
      params: "operation is required. Shots reference recurring characters, locations, props and style through anchorIds; anchor ids become canvas client ids. Model keys and parameter names must come from the user's available models; omit unknowns for defaults.",
    },
    promptGuidelines: [...CANVAS_GUIDELINES, "propose_storyboard_plan replaces the whole plan; patch_shots changes named rows only; arrange_storyboard_to_timeline lays existing shot nodes in story order.", ...STORYBOARD_MODEL_GUIDELINES],
    schema: flattenDiscriminatedUnion(storyboardModelUnion, { name: "nomi_storyboard_write" }),
    examples: [{ when: "Save a one-shot plan (title not specified by the user):", arguments: { operation: "propose_storyboard_plan", title: "开场", anchors: [], shots: [{ index: 1, shotKind: "image", durationSec: 0, anchorIds: [], prompt: "清晨日出" }] } }],
    prepareArguments: canvasWriteTolerance(["anchors", "shots", "nodeIds"], ["select", "patch"]),
  };

  const shotReferenceWrite: VerbDeclaration = {
    name: "nomi_shot_reference_write",
    contractId: "canvas.write",
    effect: "reversible_local",
    nextAction: "none",
    describe: {
      does: "Attach a staging (blocking) or camera-move reference to one shot, rendered as a gray 3D reference.",
      useWhen: "Use it when the user asks for a push-in, a two-shot, a specific blocking, or to show the camera move for a shot.",
      notWhen: "Do not use it to generate the shot itself or to change its prompt (nomi_generation_plan), and not to create or wire ordinary nodes (nomi_canvas_write).",
      params: "operation selects create_staging_reference (needs characters or customBlocking) or create_camera_move (needs move or customMove); shotClientId comes from nomi_canvas_read or this turn's nomi_canvas_write result.",
    },
    promptGuidelines: [...CANVAS_GUIDELINES, "Reference tools do not generate the shot itself. Staging requires characters or customBlocking; motion requires move or customMove. Use the vocabulary only when it matches the intent.", ...STAGING_MODEL_GUIDELINES, ...CAMERA_MOVE_MODEL_GUIDELINES],
    schema: flattenDiscriminatedUnion(shotReferenceModelUnion, { name: "nomi_shot_reference_write" }),
    examples: [{ when: "Push in on a shot:", arguments: { operation: "create_camera_move", shotClientId: "s1", move: "push_in" } }],
    prepareArguments: canvasWriteTolerance(["characters", "props"], ["camera", "crowd"]),
  };

  return [read, canvasWrite, storyboardWrite, shotReferenceWrite];
}

function deleteNodesVerb(): VerbDeclaration {
  return {
    name: CANVAS_DELETE_ALIAS,
    contractId: "canvas.delete",
    effect: "irreversible",
    nextAction: "user_sees_confirm_card",
    internalGroup: "maintenance",
    // 对外 `nomi_canvas_maintenance` 今天是手写传输（多一个 undo_canvas_delete 分支），PR B 收编。
    profiles: ["internal"],
    profileReason: "mcpHandwrittenTransport",
    describe: {
      does: "Delete exact unlocked canvas nodes after fresh explicit approval for each call.",
      useWhen: "Use it only when the user names what to delete.",
      notWhen: "Never delete on your own initiative to tidy up (nomi_canvas_write arranges without removing), and never for nodes you did not just read with nomi_canvas_read.",
      params: "nodeIds are the exact current identifiers from nomi_canvas_read; locked nodes and stale selections are rejected. Undo is not guaranteed.",
    },
    schema: canvasDeletePiInputSchema,
    examples: [{ when: "Delete two nodes the user pointed at:", arguments: { nodeIds: ["node-a", "node-b"] } }],
    prepareArguments: modelArgumentTolerance({ arrayFields: ["nodeIds"] }),
  };
}

/** `canvas.delete`——单独导出，因为它在目录里排在时间轴/素材组之后（顺序是 prompt-cache 合同）。 */
export function canvasMaintenanceVerbs(): VerbDeclaration[] {
  return [deleteNodesVerb()];
}
