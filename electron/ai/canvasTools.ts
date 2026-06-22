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

// ── 站位参考 schema（create_staging_reference 的参数；镜像渲染层 stagingBuilder 的 StagingSpec，
// 进程隔离故两处各一份，与 storyboardPlan 同例。pose 枚举=已校准的 12 预设 id）。──
export const stagingReferenceParamsSchema = z.object({
  shotClientId: z
    .string()
    .optional()
    .describe(
      "clientId (from this turn's create_canvas_nodes) or real node id of the shot/keyframe/video this staging locks; the rendered reference auto-connects to it as composition_ref. Omit for a standalone reference.",
    ),
  characters: z
    .array(
      z.object({
        name: z.string().optional().describe("Character label, e.g. '林夏' / '角色A'."),
        pose: z
          .enum([
            "standing", "t-pose", "walk", "run", "sit", "squat",
            "single-knee", "double-knee", "hands-on-hips", "point", "wave", "cheer",
          ])
          .optional()
          .describe("Body pose preset (default standing). single-knee=proposal kneel, hands-on-hips, point, wave, cheer=arms up."),
        facing: z
          .enum(["toward", "away", "camera", "left", "right"])
          .optional()
          .describe("Facing direction. toward = face the partner / circle center."),
      }),
    )
    .max(6)
    .optional()
    .describe("Characters to stage (1-6) for vocab-based precise 3D staging. Omit only when using customBlocking."),
  layout: z
    .enum(["solo", "facing", "side-by-side", "line", "behind", "circle"])
    .optional()
    .describe("Spatial arrangement. side-by-side = shoulder-to-shoulder in a row (并排/一排/一字排开, e.g. a lineup or saluting row); line = a single-file queue front-to-back (纵队/列队前后排); facing = two face each other (对峙/对坐/对话); behind = one in front of another (一前一后/跟踪); circle = around a center (围绕/环绕)."),
  camera: z
    .object({
      angle: z.enum(["front", "three-quarter", "side", "back"]).optional(),
      height: z.enum(["eye", "low", "high", "overhead"]).optional().describe("low = low-angle look up; high = high-angle look down; overhead = top-down."),
      shot: z.enum(["wide", "medium", "close"]).optional(),
    })
    .optional(),
  environment: z.enum(["studio", "day", "night"]).optional(),
  crowd: z
    .object({ rows: z.number().int(), columns: z.number().int() })
    .optional()
    .describe("Optional background crowd grid behind the main characters."),
  // 词表外逃生口（站位）：词表(layout/pose/facing…)是精确首选，但站位/构图意图不在词表里时
  // 不要硬塞最近的词——填自由文本，执行器不渲站位图、把它当 composition 指令追加进关键帧图 prompt。
  customBlocking: z
    .string()
    .optional()
    .describe(
      "For blocking/composition that's OUTSIDE the layout/pose/facing vocab above (e.g. a complex multi-tier formation, an over-the-shoulder framing, a specific prop-relative arrangement, or 'match this reference image's composition') — DO NOT force a wrong vocab value. Describe it here in natural language and it is injected as a composition directive into the shot's KEYFRAME IMAGE prompt (the tool will NOT 3D-render a staging image; less precise than the rendered reference, but the honest fallback). Use proper film/composition terms. When you use customBlocking, the structured vocab fields (characters/layout/camera…) may be omitted. Provide EITHER vocab characters (precise 3D staging) OR customBlocking (prompt-guided fallback) — not neither.",
    ),
});

// ── 运镜参考 schema（create_camera_move 的参数；镜像渲染层 cameraMoveBuilder 的 CameraMoveSpec，
// 进程隔离故两处各一份，与 staging 同例。move/speed/shot 枚举=S1 cameraMoveVocab 词表）。──
export const cameraMoveParamsSchema = z.object({
  shotClientId: z
    .string()
    .describe(
      "clientId (from this turn's create_canvas_nodes) or real node id of the shot's VIDEO node this camera move drives. The rendered camera-move clip auto-attaches to it as a video reference (the model copies the camera path, not the gray content).",
    ),
  move: z
    .enum([
      "orbit_left", "orbit_right", "push_in", "pull_out", "crane_up", "crane_down",
      "track_left", "track_right", "arc_left", "arc_right",
    ])
    .optional()
    .describe(
      "The single dominant camera move for this shot. orbit_left/right = camera circles the subject (~300°); push_in/pull_out = dolly toward/away; crane_up/down = boom up/down; track_left/right = lateral tracking; arc_left/right = short arc (~90°). " +
        "Use ONE of these enum values ONLY when the intended move IS one of them (renders a precise 3D reference). If the move is NOT in this set (e.g. dolly-zoom/vertigo, whip-pan, handheld follow, a compound/sequenced move, or 'match this reference video'), DO NOT force a wrong enum — leave move empty and use customMove instead.",
    ),
  // 词表外逃生口（运镜）：enum 是精确首选(确定性渲 3D 参考)，但意图不在 enum 里时
  // 不要硬塞最近的词——填自由文本，执行器不渲小片、把它当运镜指令追加进目标视频 prompt。
  customMove: z
    .string()
    .optional()
    .describe(
      "Natural-language camera-move description for moves OUTSIDE the enum (dolly-zoom/vertigo, whip pan, handheld follow, a compound/sequenced move like 'push in then whip to the window', or 'match this reference video's camerawork'). The tool will NOT 3D-render this — it injects it as a cinematography directive into the shot's video prompt (less precise than the rendered reference; the honest fallback). Use proper film terms. Set move OR customMove, never both for the same intent.",
    ),
  speed: z
    .enum(["slow", "medium", "fast"])
    .optional()
    .describe("Move speed → clip duration (slow≈8s, medium≈5s, fast≈3s). Default medium."),
  shot: z
    .enum(["wide", "medium", "close"])
    .optional()
    .describe("Framing of the move (wide / medium / close). Default medium."),
  subjectPose: z
    .enum([
      "standing", "t-pose", "walk", "run", "sit", "squat",
      "single-knee", "double-knee", "hands-on-hips", "point", "wave", "cheer",
    ])
    .optional()
    .describe("Optional body-pose preset id for the subject mannequin the camera moves around (e.g. standing / sit / walk). Default standing."),
});

export const canvasToolNames = [
  "read_canvas_state",
  "propose_storyboard_plan",
  "create_canvas_nodes",
  "connect_canvas_edges",
  "set_node_prompt",
  "delete_canvas_nodes",
  "run_generation_batch",
  "arrange_storyboard_to_timeline",
  "create_staging_reference",
  "create_camera_move",
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
  // 站位参考：组装 3D 假人场景(站位+动作+机位)离屏出图 → 自动连 composition_ref 到镜头，
  // 锁死视频模型最易崩的「谁站哪/做什么动作/从哪拍」。零扣费(只出灰模参考图)。
  create_staging_reference: tool({
    description:
      "Create a 3D staging reference image that LOCKS character blocking (who stands where, facing whom), body poses (kneel / sit / squat / point...), and camera angle for a shot — so the video model doesn't break the spatial relationship or the actions. Use it when a shot needs this pinned down: (a) two or more characters with a spatial relationship, (b) a specific physical action / pose, or (c) a director-specified camera angle (low / high / overhead / side). The rendered gray-mannequin reference auto-connects to shotClientId as composition_ref. Do NOT use it for a simple single talking-head shot. One call per shot.\n" +
      "Framing tips so the blocking READS: if the director didn't specify a camera, OMIT the camera field — the system auto-picks a readable angle per layout (circle→high, line→side, behind→3/4 high, facing→3/4). For 'who surrounds whom' use layout=circle (best read from high/overhead). For two characters confronting/addressing each other use layout=facing (they orient toward each other). The 'point'/'wave' poses show a pointing/raised-arm gesture but don't precisely aim at a named target — use them for 'a character is gesturing', not 'A points exactly at B'. Pick the layout that matches the described spatial relationship; only override the camera when the director named one.\n" +
      "shotClientId MUST point to the shot's KEYFRAME IMAGE node (the photoreal first-frame that seeds image-to-video), NOT the video node — video models have no composition slot, so staging only locks blocking when it guides the keyframe image (the video then inherits that first frame). The system renders the keyframe photorealistically from the staging composition (it does not copy the gray mannequins). For an image-first storyboard, that means the shot's image/keyframe node.\n" +
      "Tiered rule: the vocab (characters/layout/pose/facing/camera) is the PRECISE first choice (deterministic 3D staging render). If the blocking is OUTSIDE the vocab, do NOT force the nearest wrong value — use customBlocking (prompt-guided, no staging render, honest about lower fidelity). Never force-map a clearly-different intent into a wrong vocab value.",
    parameters: stagingReferenceParamsSchema,
  }),
  // 运镜参考：组装 3D 相机轨迹场景离屏渲一段运镜小片 → 喂目标镜头视频节点的参考视频槽(Seedance 2.0
  // 全能参考)或降级成结构化运镜 prompt，锁住视频模型最易崩的「镜头怎么运动」。零扣费(只出灰模小片)。
  create_camera_move: tool({
    description:
      "Create a 3D camera-move reference clip that LOCKS the camera motion of a shot (orbit / push-in / pull-out / crane / track / arc) — so the video model follows the intended camera path instead of guessing. The rendered gray-mannequin clip auto-attaches to the shot's video node as a reference video.\n" +
      "WHEN to call: a shot whose description carries a SPECIFIC camera-move intent — orbit/circle around the subject, push-in/dolly-in, pull-out/dolly-out to reveal, crane/boom up or down, lateral track/follow, or an arc sweep (e.g. '镜头绕着她转一圈推近', 'pull out to reveal the empty room', 'crane up over the battlefield'). One call per shot.\n" +
      "WHEN NOT: a static / locked-off / fixed-tripod shot, or a simple single talking-head — these have no camera motion to lock, so do NOT call it.\n" +
      "Pick the SINGLE dominant move that matches the intent. On models with a reference-video slot (e.g. Seedance 2.0 全能参考) the model copies ONLY the camera movement (content stays driven by the character refs + prompt); on models without one it degrades to a structured camera-move prompt directive.\n" +
      "Tiered rule: the `move` enum is the PRECISE first choice (deterministic 3D camera-path render). If the intended move is OUTSIDE the enum (dolly-zoom/vertigo, whip-pan, handheld follow, a compound/sequenced move, or 'match this reference video'), do NOT force the nearest wrong enum — leave move empty and use customMove (prompt-guided into the video node's prompt, no 3D render, honest about lower fidelity). Never force-map a clearly-different intent into a wrong enum value.\n" +
      "shotClientId MUST point to the shot's VIDEO node (the node that actually generates the clip) — NOT its keyframe image, and NOT a text/shot note. For an image-first storyboard that is the shot's video node downstream of the keyframe. If no video node exists for the shot yet, create it first; never aim this at an image node.",
    parameters: cameraMoveParamsSchema,
  }),
} as const;

export type CanvasTools = typeof canvasTools;

export type PlannedNode = z.infer<typeof plannedNodeSchema>;
export type PlannedEdge = z.infer<typeof plannedEdgeSchema>;
