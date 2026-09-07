// Agent lane · `canvas.read` / `canvas.write` 的模型可见工具面
//
// ── 这一族是本阶段全部工作的靶心 ──
//
// `canvas.write` 是今天最贵的那扇门，真实成功率 **0/18**（#547 §3.2）。三条互不排斥的成因，
// 本文件把三条一起拆掉，因为少任何一刀 0/18 都还在：
//
//   ① **一个工具塞 9 个分支**。模型要在参数里做第二次选择，而拒收回执是 9 个分支一起吐出
//      的 8 行互不标记的诉求，其中只有 1 行是真的。
//      → 按语义拆成三个工具（`canvasWrite.ts` 的三个 sub-union），模型选工具那一次判断变简单。
//   ② **两个字节级相同的工具**（`nomi_canvas_plan` / `nomi_canvas_edit`，各 8238 B）。
//      真机序列 `plan→edit→edit→edit→plan→edit→plan` = 在两枚一模一样的硬币间抛。
//      → lane 上根本没有这两个名字：三个工具、三份互不相同的 schema。
//   ③ **根级 `anyOf` 在部分供应商上被静默丢掉**（G-01）。拆成三个工具**治不了这一条**——
//      拆完每个仍然是根级 union。
//      → `flattenDiscriminatedUnion` 把每一组派生成根是 object 的扁平 schema。
//
// 外加一条 #547 点名、而拆分与扁平化都治不了的：**分镜的 `anchors`/`shots` 是
// 「由任意对象组成的数组」**。模型要写 24 行、25 个字段，而 schema 一个字段名都没说。
// 那份 typed 形状其实一直存在，只是曾经住在旧通路的工具表里（`canvasDescriptors.ts`，已删）——
// 阶段 2 把它搬进能力契约层（`canvasModelShapes.ts`）成为唯一 owner，这里 `.extend()`
// 覆盖掉契约上那两个 `z.record(z.unknown())` 字段。**不是重写，是替换掉弱的那一份。**
import { z } from "zod";

import { CANVAS_READ_CAPABILITY, canvasReadResultSchema, type CanvasReadResult } from "../shared/agentCapabilities/canvasRead";
import {
  cameraMoveParamsObjectSchema,
  stagingReferenceParamsSchema,
  storyboardPlanParamsSchema,
} from "../shared/agentCapabilities/canvasModelShapes";
import {
  CANVAS_WRITE_CAPABILITY,
  canvasNodeWriteInputSchema,
  canvasWriteCrossFieldRefine,
  canvasWriteSemanticInputSchema,
  shotReferenceWriteInputUnion,
  storyboardPlanActionInputSchema,
  storyboardWriteInputUnion,
  type CanvasWriteInput,
  type CanvasWriteResult,
} from "../shared/agentCapabilities/canvasWrite";
import { flattenDiscriminatedUnion } from "../shared/agentCapabilities/flatModelInput";
import type { LaneToolSpec } from "../shared/agentLane/laneToolContract";
import { laneArgumentTolerance, laneNoArgumentTolerance } from "./laneArgumentTolerance";
import { bindLaneTool, type LaneToolDescriptor } from "./laneRuntimePort";

/** 领域侧。lane 不认识 React Flow，只认识「读一次画布」和「提一次可撤销的改动」。 */
export interface CanvasLanePort {
  read(): Promise<unknown>;
  write(input: CanvasWriteInput): Promise<CanvasWriteResult>;
}

/**
 * 通道③ · 画布这一族共享的纪律，**只写一次**。
 *
 * 第一条不是凑数的：真机实测模型给 `modelKey` 编了一个 `"seedance"`（`canvasWrite.ts:43`
 * 当时是裸 `z.string()`，无枚举无说明）。「值必须来自目录」这件事没法用 schema 表达
 * （目录是运行时的），只能用一句话说清——而这句话属于整族，不属于某一个工具。
 */
const CANVAS_GUIDELINES = Object.freeze([
  "Read the canvas before you change it: node ids, shot numbers and model keys all come from what is actually there.",
  "Never invent a modelKey, vendor or nodeId. Use the exact values returned by nomi_canvas_read or listed in the user's available-models list; leave the field out when you are unsure and the system fills in a default.",
  "Every canvas write is a reversible proposal the user still has to accept — describe what you are proposing in your reply rather than claiming it is already done.",
]);

/**
 * 画布这一族的副作用声明（第 ⑨ 维）。
 *
 * `reversal: "proposal"` 不是修辞：画布写入落的是一份**提案**，用户还要在面板上点接受——
 * 这正是 `CANVAS_GUIDELINES` 第三条要模型「别宣称已经改好了」的那件事。同一个事实过去
 * 只活在那句散文里，现在它是机器可读的，阶段 3 的闸按它决定要不要停下来问用户。
 */
const CANVAS_READ_EFFECTS = Object.freeze({ mutates: false, billable: false, reversal: "none" } as const);
const CANVAS_WRITE_EFFECTS = Object.freeze({ mutates: true, billable: false, reversal: "proposal" } as const);

/**
 * 分镜那一支：把契约里两个 `z.record(z.unknown())` 换成 typed 形状。
 *
 * `.extend()` 只覆盖这两个字段，`operation`/`title` 以及未来新增的字段都还是从契约派生的
 * ——不是抄一份新的分支定义。抄一份的代价是：下次给 `propose_storyboard_plan` 加字段时，
 * 两处都要记得改，漏掉的那处不会报错，只会让模型看不见那个字段。
 */
const storyboardPlanModelBranch = storyboardPlanActionInputSchema.extend({
  anchors: storyboardPlanParamsSchema.shape.anchors,
  shots: storyboardPlanParamsSchema.shape.shots,
});

// 分组是从 `.options` 拼出来的裸 union，**不会继承**契约外层的 `superRefine`——所以跨字段
// 约束在这里再挂一次，用的是同一个函数（`canvasWriteCrossFieldRefine`，唯一 owner）。
const storyboardModelUnion = z.discriminatedUnion("operation", [
  storyboardPlanModelBranch as unknown as z.ZodDiscriminatedUnionOption<"operation">,
  ...storyboardWriteInputUnion.options.filter(
    (option) => option.shape.operation.value !== "propose_storyboard_plan",
  ) as unknown as z.ZodDiscriminatedUnionOption<"operation">[],
]).superRefine(canvasWriteCrossFieldRefine);

/**
 * 站位/运镜那两支：契约上这些字段全是 `z.string()` 或 `z.record(z.unknown())`——
 * 「随便填一个词」。而 typed 版本（词表 enum + 每个值的含义）一直存在，只是住在旧通路的
 * 工具表里。这里把弱的那一份替换掉。
 *
 * `sceneTemplate` / `props` 两个字段**两支共用同一份 typed 形状**：它们是同一个领域概念
 * （灰模布景与灰模道具，走渲染层同一个 builder）。共用不是为了让扁平化通过——反过来说，
 * 扁平化的形状冲突检测正是发现「同一个概念在两个分支上被声明成两种东西」的地方。
 */
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

interface CanvasWriteToolShape {
  readonly name: string;
  readonly union: z.ZodTypeAny;
  readonly description: string;
  readonly promptSnippet: string;
  readonly examples: LaneToolSpec["examples"];
  /** 声明成数组/对象的字段名，交给共享容忍器（B/C 族）。 */
  readonly arrayFields: readonly string[];
  readonly objectFields: readonly string[];
}

const CANVAS_WRITE_TOOLS: readonly CanvasWriteToolShape[] = [
  {
    name: "nomi_canvas_write",
    union: canvasNodeWriteInputSchema,
    description: [
      "Create, connect, retitle or tidy the nodes on the generation canvas.",
      "Every call is one reversible proposal the user still has to accept, so send the whole batch in a single call instead of one node at a time.",
      "`operation` picks the action and decides which other fields apply; fields belonging to another operation are rejected.",
    ].join(" "),
    promptSnippet: "add, connect, retitle or tidy generation-canvas nodes (one reversible proposal per call).",
    examples: [
      {
        when: "Add one character reference card and one shot that uses it:",
        arguments: {
          operation: "create_canvas_nodes",
          summary: "Add the lead character card and her first shot.",
          nodes: [
            { clientId: "c1", kind: "character", title: "林夏", prompt: "Full-body neutral reference of a 17-year-old girl, short black hair, school uniform, plain grey backdrop." },
            { clientId: "s1", kind: "keyframe", title: "天台开场", prompt: "Rooftop at dusk; she leans on the railing looking down; wide shot, warm rim light." },
          ],
          edges: [{ sourceClientId: "c1", targetClientId: "s1", mode: "character_ref" }],
        },
      },
      { when: "Rewrite one existing node's prompt:", arguments: { operation: "set_node_prompt", nodeId: "node-42", prompt: "Close-up on her hands gripping the railing." } },
    ],
    arrayFields: ["nodes", "edges"],
    objectFields: [],
  },
  {
    name: "nomi_storyboard_write",
    union: storyboardModelUnion,
    description: [
      "Save, patch, or lay out a storyboard: the ordered table of shots the whole film is generated from.",
      "`propose_storyboard_plan` replaces the whole plan, `patch_shots` changes named rows only, `arrange_storyboard_to_timeline` puts existing shot nodes onto the timeline in story order.",
      "Anchors are the recurring characters, scenes, props and style; every shot references them by anchor id instead of restating their appearance.",
    ].join(" "),
    promptSnippet: "save a whole storyboard, patch named shot rows, or lay shots onto the timeline.",
    examples: [
      {
        when: "Save a two-shot storyboard with one character anchor:",
        arguments: {
          operation: "propose_storyboard_plan",
          title: "天台的三分钟",
          anchors: [{ id: "anchor-1", kind: "character", name: "林夏", description: "17-year-old girl, short black hair, school uniform.", carrier: "visual" }],
          shots: [
            { index: 1, shotKind: "image", durationSec: 0, anchorIds: ["anchor-1"], prompt: "Wide: she steps onto the rooftop, dusk light behind her." },
            { index: 2, shotKind: "video", durationSec: 4, anchorIds: ["anchor-1"], prompt: "Slow push-in as she leans on the railing and exhales." },
          ],
        },
      },
      {
        when: "Change only shots 2 and 3 to four-second video shots:",
        arguments: { operation: "patch_shots", select: { kind: "indexes", indexes: [2, 3] }, patch: { shotKind: "video", durationSec: 4 } },
      },
    ],
    arrayFields: ["anchors", "shots", "nodeIds"],
    objectFields: ["select", "patch"],
  },
  {
    name: "nomi_shot_reference_write",
    union: shotReferenceModelUnion,
    description: [
      "Attach a staging reference (where people stand and how the camera sees them) or a camera-move reference to one shot.",
      "Both render a grey 3D reference that hangs on the shot as a composition or motion reference; they do not generate the shot itself.",
      "A staging reference needs `characters` (or `customBlocking`); a camera move needs `move` (or `customMove`). Prefer the vocabulary fields — they render a precise reference; fall back to the free-text field only when the intent is genuinely outside the vocabulary.",
    ].join(" "),
    promptSnippet: "hang a staging or camera-move reference on one shot.",
    examples: [
      {
        when: "Two characters facing each other, camera low and close:",
        arguments: {
          operation: "create_staging_reference",
          shotClientId: "s1",
          characters: [{ name: "林夏", pose: "standing", facing: "toward" }, { name: "陈默", pose: "standing", facing: "toward" }],
          layout: "facing",
          camera: { angle: "three-quarter", height: "low", shot: "close" },
        },
      },
      { when: "A slow push-in on an existing video shot:", arguments: { operation: "create_camera_move", shotClientId: "s1", move: "push_in", speed: "slow" } },
    ],
    arrayFields: ["characters", "props"],
    objectFields: ["camera", "crowd"],
  },
];

const canvasReadSchema = z.object({}).strict();

const CANVAS_READ_DESCRIPTION = [
  "Read the current generation canvas: every node with its id, kind, title, prompt, status and position, plus the reference edges between them and any groups.",
  "Takes no arguments. Call it before any canvas write, because node ids, shot numbers and existing prompts all come from here — inventing an id is the single most common way a canvas edit fails.",
  "Node ids returned here are the exact strings to pass as `nodeId` / `sourceClientId` / `targetClientId`.",
].join(" ");

/** 说明书那一半。门岗与系统提示词渲染只要这个，不需要任何领域 port。 */
export function canvasLaneToolSpecs(): LaneToolSpec[] {
  const read: LaneToolSpec = {
    name: "nomi_canvas_read",
    capabilityId: CANVAS_READ_CAPABILITY.id,
    description: CANVAS_READ_DESCRIPTION,
    promptSnippet: "read every node, edge and group currently on the generation canvas.",
    promptGuidelines: CANVAS_GUIDELINES,
    effects: CANVAS_READ_EFFECTS,
    schema: canvasReadSchema,
    examples: [{ when: "Always call it with no arguments:", arguments: {} }],
    prepareArguments: laneNoArgumentTolerance,
  };
  const writes = CANVAS_WRITE_TOOLS.map((tool): LaneToolSpec => ({
    name: tool.name,
    capabilityId: CANVAS_WRITE_CAPABILITY.id,
    description: tool.description,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: CANVAS_GUIDELINES,
    effects: CANVAS_WRITE_EFFECTS,
    // 派生，不是手写：判别字段降成 `z.enum`、分支专属字段设为 optional、跨字段约束仍由
    // 原 union 裁决。手抄一份扁平版就是第二个真相源（理由见 `flatModelInput.ts` 头部）。
    schema: flattenDiscriminatedUnion(tool.union, { name: tool.name }),
    examples: tool.examples,
    prepareArguments: laneArgumentTolerance({
      arrayFields: tool.arrayFields,
      objectFields: tool.objectFields,
    }),
  }));
  return [read, ...writes];
}

export function createCanvasLaneTools(port: CanvasLanePort): LaneToolDescriptor[] {
  return canvasLaneToolSpecs().map((spec) => {
    if (spec.name === "nomi_canvas_read") {
      return bindLaneTool(spec, async () => {
        const result: CanvasReadResult = canvasReadResultSchema.parse(await port.read());
        return { ok: true, text: JSON.stringify(result), details: { nodeCount: result.nodes.length } };
      });
    }
    return bindLaneTool(spec, async (args) => {
      // `laneTools.mts` 在 pi 的 ajv 之后跑过契约自己的那一次 parse（扁平 schema 的
      // `transform` → union + 跨字段约束），所以这里拿到的已经是收窄的 `CanvasWriteInput`。
      // 这里**不再** parse——校验点只有那一个（G-08）。
      const input = args as CanvasWriteInput;
      const receipt = await port.write(input);
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
 * 收据里唯一必须有的是**下一步要引用的 id**：`clientIdToNodeId` 把这一轮的临时 id 换成
 * 真实节点 id，模型下一次连边、挂参考、改提示词全靠它（按 id join，永不复制）。
 */
function canvasWriteReceiptText(input: CanvasWriteInput, receipt: CanvasWriteResult): string {
  if ("cancelled" in receipt) return `The user declined the ${input.operation} proposal. Nothing changed on the canvas.`;
  const lines = [`Applied ${receipt.operation}. Proposal ${receipt.proposalId}.`];
  if ("clientIdToNodeId" in receipt) {
    lines.push(`Real node ids: ${JSON.stringify(receipt.clientIdToNodeId)} — use these, not the clientIds, from now on.`);
  }
  if ("skippedEdges" in receipt && receipt.skippedEdges.length > 0) {
    lines.push(
      `${receipt.skippedEdges.length} reference edge(s) were skipped because the target model does not support them: `
      + receipt.skippedEdges.map((edge) => `${edge.source}→${edge.target} (${edge.reason})`).join("; "),
    );
  }
  if ("changedShotIndexes" in receipt) {
    lines.push(`Changed shots ${receipt.changedShotIndexes.join(", ")} (fields: ${receipt.changedFields.join(", ")}).`);
  }
  return lines.join("\n");
}

export { canvasWriteSemanticInputSchema };
