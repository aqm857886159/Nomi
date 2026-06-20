import { tool } from "ai";
import { z } from "zod";

/**
 * Zod schemas for the generation canvas tools the LLM is allowed to call.
 *
 * The schemas mirror the existing `GenerationCanvasNode` shape (see
 * `src/workbench/generationCanvas/model/...`). They intentionally use a
 * `clientId` (LLM-supplied) instead of the real node id so the model can
 * reference nodes it just proposed before the user has confirmed creation.
 *
 * The Vercel AI SDK `tool({ ... })` helper only requires `description` +
 * `parameters` for the LLM-side schema. We deliberately omit `execute` here:
 * actual mutation happens in the renderer once the user confirms, so the main
 * process emits the tool-call to the UI and feeds the user's decision back to
 * the model as the tool result.
 */

export const canvasNodeKindSchema = z.enum([
  "text",
  "character",
  "scene",
  "image",
  "keyframe",
  "video",
  "shot",
  "output",
  "panorama",
]);

export const plannedNodeSchema = z.object({
  clientId: z.string().min(1),
  kind: canvasNodeKindSchema,
  title: z.string().min(1),
  // ⑤ 结构化骨架（唯一真相源；系统提示/skill 只放指向这里的指针，不重写，避免三处漂移）。
  // 文本须稳定、不含动态值（进 tools 块前缀，一次性 byte 变更后命中缓存）。
  prompt: z
    .string()
    .describe(
      "High-quality generation prompt, in the SAME language as the user (Chinese user → Chinese prompt). Write it as a STRUCTURED skeleton, not a run-on sentence:\n" +
        "- character/scene reference card: stable appearance/environment description + unified style keywords (neutral full-body pose for a character, empty wide establishing shot for a scene; no plot action).\n" +
        "- image / keyframe shot: scene·time·light → subject·action·expression → shot language (wide / close-up / low-angle…) → style keywords.\n" +
        "- video shot: camera move (push / pull / pan / track…) → on-screen action progression → rhythm & duration feel; do NOT restate the static keyframe description.\n" +
        "Keep the same subject's appearance description consistent across shots.",
    ),
  // 可省略：批量布局由渲染层 derive 成紧凑网格（applyCanvasToolCall.gridPosition），
  // 不再信任 LLM 手写的像素坐标（硬编码单行会溢出视口）。
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  // bug①：agent 为节点建议模型 + 模式 + 标量参数（比例/清晰度…），用户在计划卡可改可确认。
  // modelKey/modeId 必须取自系统提示词给出的「可用模型清单」；params 是宽松键值（schema 不按
  // 单个模型严格——一次 batch 可含多模型），合法性在写入时按档案逐字段校验（单字段，跨字段留二期）。
  modelKey: z.string().optional(),
  modeId: z.string().optional(),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const plannedEdgeSchema = z.object({
  sourceClientId: z.string().min(1),
  targetClientId: z.string().min(1),
  // T1 轨迹语义：边的参考槽语义。character_ref=角色定妆参考、style_ref=场景/风格参考、
  // composition_ref=构图参考、first_frame=源图像作为目标视频首帧（源为视频节点时＝
  // 用源视频尾帧接力，须用户在计划卡单独勾选）、last_frame=尾帧约束、reference=通用参考。
  mode: z
    .enum(["reference", "first_frame", "last_frame", "style_ref", "character_ref", "composition_ref"])
    .optional()
    .describe(
      "Reference-slot semantics: character_ref (cast sheet feeds keyframe), style_ref (scene/style feeds keyframe), composition_ref, first_frame (keyframe image feeds the video's first frame; when the source is a VIDEO node this means last-frame relay and must be opted-in by the user), last_frame, reference (generic). Omit for a generic reference edge. Only connect a reference the TARGET model actually supports — see each model's per-mode reference slots in the available-models list; text/shot/output nodes cannot be a reference source. Unsupported edges are skipped and reported back in skippedEdges.",
    ),
});

// ── 分镜方案 schema（propose_storyboard_plan 的参数；镜像渲染层 StoryboardPlan，
// electron/renderer 进程隔离故两处各一份，与 plannedNodeSchema 同例）。──
const storyboardAnchorSchema = z.object({
  id: z.string().min(1).describe("Stable id; used as the clientId when the plan lands on the canvas (e.g. 'anchor-1')."),
  kind: z.enum(["character", "scene", "prop", "style"]),
  name: z.string().describe("Display name & shot-reference key ('林夏' / '天台' / '红书包' / '全片风格')."),
  description: z
    .string()
    .describe(
      "Standard description. Visual anchor (carrier=visual) → reference-card / cast-sheet prompt (stable appearance/environment, neutral). Text anchor (carrier=text) → folded into the prompt of every shot that references it.",
    ),
  carrier: z
    .enum(["visual", "text"])
    .describe(
      "visual = generate a reference image and hang it on the shot's reference slot (faces / specific scenes / props that prompt words can't pin down). text = describe in words only, folded into shot prompts (tone / brand color / wardrobe words). character/scene/prop default visual; style defaults text.",
    ),
  scope: z.enum(["all", "selective"]).optional().describe("all = every shot (style/brand); selective = only named shots."),
})

const storyboardShotSchema = z.object({
  index: z.number().int().describe("1-based shot number in script order."),
  durationSec: z.number().describe("Shot duration in seconds (clamped to the chosen model's max when it lands)."),
  anchorIds: z.array(z.string()).describe("Which anchors this shot uses (by anchor.id) → visual anchors become reference edges, text anchors fold into the prompt."),
  prompt: z.string().describe("Directly-generatable prompt: camera move + action progression; do NOT restate the anchors' static descriptions."),
  // P0-9:让 AI 一并产出每镜的模型/模式/参数(含负面词)。取值必须来自用户消息里的「可用模型」清单,
  // 不要编不存在的 modelKey/参数名;不确定就留空,落画布时系统用默认视频模型兜底。
  modelKey: z.string().optional().describe("Video model key for this shot, chosen from the 「可用模型」 list in the user message. Omit to use the default video model."),
  modeId: z.string().optional().describe("Model mode/variant id (paired with modelKey), from the same list. Omit to use the model's default mode."),
  params: z.record(z.unknown()).optional().describe("Per-shot generation params keyed exactly as the chosen model exposes them in the 「可用模型」 list (e.g. aspect_ratio, resolution, and negative_prompt where the model supports it). Only use param keys that model actually lists; omit unknowns."),
})

export const storyboardPlanParamsSchema = z.object({
  title: z.string().describe("Short plan title in the user's language."),
  anchors: z.array(storyboardAnchorSchema).max(24),
  shots: z.array(storyboardShotSchema).min(1).max(24),
})

export const canvasToolNames = [
  "read_canvas_state",
  "propose_storyboard_plan",
  "create_canvas_nodes",
  "connect_canvas_edges",
  "set_node_prompt",
  "delete_canvas_nodes",
  "run_generation_batch",
  "arrange_storyboard_to_timeline",
] as const;
export type CanvasToolName = (typeof canvasToolNames)[number];

export const canvasTools = {
  read_canvas_state: tool({
    description:
      "Read the current generation canvas: returns all nodes (id, kind, title, prompt, position) and all edges (source, target). Use this first when you need to know what is already on the canvas before planning new work.",
    parameters: z.object({}),
  }),
  // 分镜方案规划专用:产出结构化方案对象,落创作区给用户审/改(不碰画布、不花钱),用户确认后才落画布。
  propose_storyboard_plan: tool({
    description:
      "Produce a STRUCTURED storyboard plan (cross-shot anchors + shots) for the user to review and edit in the creation area BEFORE anything is created on the canvas. Does NOT touch the canvas and costs nothing — planning is free and editable; the user confirms later to land it. Use this (not create_canvas_nodes) when planning a story into a consistent multi-shot video. Emit exactly ONE call with the whole plan.",
    parameters: storyboardPlanParamsSchema,
  }),
  create_canvas_nodes: tool({
    description:
      "Propose a batch of new canvas nodes AND the reference edges between them, in this ONE call. Nodes are NOT auto-executed; they appear on the canvas as idle/draft and the user manually clicks generate. Always include the plan's edges via the `edges` field — never split them into a separate connect_canvas_edges call (the user approves the whole plan once).",
    parameters: z.object({
      summary: z
        .string()
        .describe("One-sentence summary of the plan, shown to the user before confirmation."),
      nodes: z.array(plannedNodeSchema).min(1).max(24),
      edges: z
        .array(plannedEdgeSchema)
        .max(48)
        .optional()
        .describe(
          "Reference edges between this plan's nodes (use their clientId) and/or existing real node ids. Submit together with nodes in this same call.",
        ),
    }),
  }),
  connect_canvas_edges: tool({
    description:
      "Connect EXISTING canvas nodes with reference edges (source feeds context into target). Only for follow-up edits to nodes already on the canvas — when proposing new nodes, put their edges in create_canvas_nodes instead.",
    parameters: z.object({
      edges: z.array(plannedEdgeSchema).min(1).max(48),
    }),
  }),
  set_node_prompt: tool({
    description:
      "Rewrite the prompt of a single existing node. Use this in refine/polish flows. Do not use to create new nodes.",
    parameters: z.object({
      nodeId: z.string().min(1),
      prompt: z.string().min(1),
    }),
  }),
  delete_canvas_nodes: tool({
    description:
      "Delete one or more existing canvas nodes by id. Always destructive — the user must confirm.",
    parameters: z.object({
      nodeIds: z.array(z.string().min(1)).min(1).max(24),
    }),
  }),
  // S6b 受理语义:确认前零网络调用零扣费;批准 = 受理并启动,返回受理回执,
  // 生成进度走画布 run 域事件给用户看,不回喂 LLM(长生成不阻塞对话回合)。
  run_generation_batch: tool({
    description:
      "Start real generation for a batch of existing canvas nodes (costs credits — the user must confirm). Provide real node ids from read_canvas_state, or clientIds from this turn's create_canvas_nodes. Nodes are scheduled in dependency waves (references generate first). Returns an acceptance receipt; generation progress is shown to the user on the canvas, not returned to you.",
    parameters: z.object({
      nodeIds: z.array(z.string().min(1)).min(1).max(24),
    }),
  }),
  // 把已生成的镜头视频按剧本时序排进时间轴媒体轨道,用户即可去预览区播放/导出成片。
  // 顺序由系统按镜号(shotIndex,拆镜头时定的剧本序)确定性排定——你不需要、也不应该自己
  // 推断顺序;缺视频的镜头自动用其关键帧图占位。追加到时间轴末尾。
  arrange_storyboard_to_timeline: tool({
    description:
      "Arrange the storyboard's generated shot videos onto the timeline's media track in SCRIPT ORDER, so the user can preview and export a finished film. Ordering is decided deterministically by each shot's stored shot number (from when the script was split) — you do NOT infer the order yourself. Shots whose video isn't generated yet fall back to their keyframe image as a placeholder; shots with neither are skipped and reported. Clips are appended after whatever is already on the timeline. Omit nodeIds to arrange the whole storyboard; pass nodeIds to arrange only those shots. Use this when the videos are generated and the user wants to lay them out / preview / export the cut.",
    parameters: z.object({
      nodeIds: z
        .array(z.string().min(1))
        .max(48)
        .optional()
        .describe(
          "Optional subset of shot node ids to arrange. Omit to arrange the entire storyboard in script order.",
        ),
    }),
  }),
} as const;

export type CanvasTools = typeof canvasTools;

export type PlannedNode = z.infer<typeof plannedNodeSchema>;
export type PlannedEdge = z.infer<typeof plannedEdgeSchema>;
