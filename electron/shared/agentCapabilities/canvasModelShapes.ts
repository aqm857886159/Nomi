// 能力契约 · `canvas.write` 的**模型可见形状**（分镜 / 站位 / 运镜）。
//
// ── 为什么这些形状搬到了这里 ──
//
// 它们原来住在 `electron/harness/tools/canvasDescriptors.ts`——旧通路发给 pi 的工具表里。
// 于是同一件事在仓库里有两份说法：
//   · 这一份是**typed 的**（`storyboardShotSchema` 25 个字段、每个带 `.describe()`）；
//   · 能力契约 `canvasWrite.ts` 那一份是 `z.record(z.unknown())`——「一个由任意对象组成的数组」。
// 后者正是对外 MCP 广播出去的那份，也就是说**外部宿主拿到的 schema 比内部 agent 还松**
// （方案 §3.6 的 S9：信任方向反了）。而 #547 实测 `canvas.write` 真实成功率 **0/18**，
// 模型在写 24 行分镜时，25 个字段名一个都没被告诉过。
//
// 搬到能力契约层之后只有**一个** owner，新通路的 lane 工具直接 import 同一份。
// （旧通路的 `canvasDescriptors.ts` 阶段 2 起只是 re-export 壳，2026-09-07 已整份删除。）
//
// ⚠️ 一条明着标的欠账（不是遗漏，是排期）：`canvasWrite.ts` 里对外 MCP 那一份仍然是
// `z.record(z.unknown())`。理由是 `check:mcp-payload` 是 shrink-only 棘轮，而 main
// **恰好卡在上限**（实测 28047 / max 28047，零余量）——把 typed 形状接进共享契约会让
// `tools/list` 当场顶穿。它由 `check:model-schema` 登记成身份式债，到阶段 4（工具数量
// 收敛腾出字节）归零。登记不是防线，但它至少让这条债不会被忘掉（R28）。
import { z } from "zod";

import { jsonTolerantArray } from "./jsonArgTolerance";

/**
 * 生成参数的值。**不是 `z.unknown()`**：`z.record(z.unknown())` 发布出去是
 * `{"additionalProperties":{}}`——键名不可枚举是真话（参数名由所选模型的档案决定），
 * 但「值随便什么都行」不是。模型据此会塞进嵌套对象、数组，而执行侧只认标量。
 * 键名开放、值有类型，才是这个字段的实话。
 */
const generationParamValueSchema = z.union([z.string(), z.number(), z.boolean()]);

// ── 分镜方案 schema（propose_storyboard_plan 的参数；镜像渲染层 StoryboardPlan，
// electron/renderer 进程隔离故两处各一份，与 plannedNodeSchema 同例）。──
const storyboardAnchorSchema = z.object({
  id: z
    .string()
    .min(1)
    .describe("Stable anchor id; becomes the canvas clientId."),
  kind: z.enum(["character", "scene", "prop", "style"]),
  name: z.string().describe("Display name & shot-reference key ('林夏' / '天台' / '红书包' / '全片风格')."),
  description: z
    .string()
    .describe("Reusable anchor appearance or prompt text."),
  carrier: z
    .enum(["visual", "text"])
    .describe("visual: reference image; text: words folded into shot prompts."),
  scope: z
    .enum(["all", "selective"])
    .optional()
    .describe("all = every shot (style/brand); selective = only named shots."),
});

const storyboardShotSchema = z.object({
  index: z.number().int().describe("1-based shot number in script order."),
  sceneId: z
    .string()
    .min(1)
    .optional()
    .describe("Optional scene/group id; same-scene shots share it and remain contiguous."),
  shotKind: z
    .enum(["image", "video"])
    .optional()
    .describe("image: still frame (default); video: duration and camera motion."),
  durationSec: z
    .number()
    .describe("Seconds; image shots use 0. Clamped to model maximum."),
  anchorIds: z
    .array(z.string())
    .describe("Referenced anchor ids."),
  prompt: z
    .string()
    .describe("Generatable action and camera prompt; omit static anchor descriptions."),
  // P0-9:让 AI 一并产出每镜的模型/模式/参数(含负面词)。取值必须来自用户消息里的「可用模型」清单,
  // 不要编不存在的 modelKey/参数名;不确定就留空,落画布时系统用默认视频模型兜底。
  modelKey: z
    .string()
    .optional()
    .describe("已指定填目录键；未指定用默认。"),
  modeId: z
    .string()
    .optional()
    .describe("Catalog mode/variant paired with modelKey; omit for default."),
  params: z
    .record(generationParamValueSchema)
    .optional()
    .describe("已指定按档案填；未指定派生，禁编键。"),
  subtitle: z
    .string()
    .optional()
    .describe("Verbatim on-screen caption."),
  dialogue: z
    .string()
    .optional()
    .describe("Verbatim spoken dialogue: speaker and line."),
  transition: z
    .object({
      type: z.enum(["cut", "dissolve", "fade", "match_cut", "whip_pan"]),
      durationFrames: z.number().int().positive().optional(),
    })
    .optional()
    .describe("Transition to next shot; cut means hard cut, omit if unauthored."),
  keyframe: z
    .object({
      enabled: z
        .boolean()
        .optional()
        .describe("Set true only for 图片+视频 mode: create a first-frame image before the video."),
      prompt: z
        .string()
        .optional()
        .describe("Static first-frame composition, light, pose and environment."),
      modelKey: z
        .string()
        .optional()
        .describe("Catalog first-frame image model key; omit for saved default."),
      modeId: z
        .string()
        .optional()
        .describe("First-frame image mode; prefer reference/edit with visual anchors."),
      params: z
        .record(generationParamValueSchema)
        .optional()
        .describe("Parameters declared by the selected first-frame image model."),
    })
    .optional()
    .describe("First-frame image plan within this logical shot."),
});

export const storyboardPlanParamsSchema = z.object({
  title: z.string().describe("Short plan title in the user's language."),
  // 这两条以前一个有容错、一个没有：`shots` 包了本地的 `parseJsonArrayString`，
  // `anchors` 是裸数组。同一次调用里模型不会只把其中一个字段字符串化——
  // 容错必须覆盖整类，否则它只是把失败点从一个字段挪到另一个字段。
  anchors: jsonTolerantArray(z.array(storyboardAnchorSchema).max(24)),
  shots: jsonTolerantArray(z.array(storyboardShotSchema).min(1).max(24)),
});

// ── 站位参考 schema（create_staging_reference 的参数；镜像渲染层 stagingBuilder 的 StagingSpec，
// 进程隔离故两处各一份，与 storyboardPlan 同例。pose 枚举=已校准的预设 id）。──
export const stagingReferenceParamsSchema = z.object({
  shotClientId: z
    .string()
    .optional()
    .describe("Shot/keyframe/video clientId or nodeId; omit for standalone staging."),
  characters: z
    .array(
      z.object({
        name: z.string().optional().describe("Character label, e.g. '林夏' / '角色A'."),
        pose: z
          .enum([
            "standing",
            "t-pose",
            "walk",
            "run",
            "sit",
            "squat",
            "crouch",
            "single-knee",
            "double-knee",
            "hands-on-hips",
            "point",
            "wave",
            "cheer",
          ])
          .optional()
          .describe("Body-pose preset; default standing."),
        facing: z
          .enum(["toward", "away", "camera", "left", "right"])
          .optional()
          .describe("Facing direction. toward = face the partner / circle center."),
      }),
    )
    .max(6)
    .optional()
    .describe("1–6 staged characters, or use customBlocking."),
  layout: z
    .enum(["solo", "facing", "side-by-side", "line", "behind", "circle"])
    .optional()
    .describe("Layout: side-by-side is a row; line is a front-to-back queue."),
  camera: z
    .object({
      angle: z.enum(["front", "three-quarter", "side", "back"]).optional(),
      height: z
        .enum(["eye", "low", "high", "overhead"])
        .optional()
        .describe("low = low-angle look up; high = high-angle look down; overhead = top-down."),
      shot: z.enum(["wide", "medium", "close"]).optional(),
    })
    .optional(),
  environment: z.enum(["studio", "day", "night"]).optional(),
  crowd: z
    .object({ rows: z.number().int(), columns: z.number().int() })
    .optional()
    .describe("Optional background crowd grid behind the main characters."),
  // 灰模布景（走 UI 同一套 builder）：整套场景模板 + 单件语义道具，给参考图一个可读的环境/尺度背景。
  sceneTemplate: z
    .enum(["street", "room"])
    .optional()
    .describe("Gray backdrop: street or room; environment=day lights the street."),
  props: z
    .array(
      z.object({
        kind: z.enum([
          "car",
          "building",
          "tree",
          "streetlamp",
          "wall",
          "suv",
          "bus",
          "bicycle",
          "scooter",
          "sofa",
          "diningTable",
          "fridge",
          "washingMachine",
          "trashBins",
          "atm",
          "backpack",
        ]),
        position: z
          .array(z.number())
          .length(2)
          .optional()
          .describe("Ground [x,z] meters, relative to characters at origin."),
        rotationY: z.number().optional().describe("Yaw in degrees."),
        scale: z.number().optional().describe("Uniform scale (0.1–10, default 1)."),
      }),
    )
    .max(12)
    .optional()
    .describe("Placed gray-model props; use sceneTemplate for a full backdrop."),
  // 词表外逃生口（站位）：词表(layout/pose/facing…)是精确首选，但站位/构图意图不在词表里时
  // 不要硬塞最近的词——填自由文本，执行器不渲站位图、把它当 composition 指令追加进关键帧图 prompt。
  customBlocking: z
    .string()
    .optional()
    .describe("Composition outside the vocabulary, injected into the keyframe prompt."),
});

// ── 运镜参考 schema（create_camera_move 的参数；镜像渲染层 cameraMoveBuilder 的 CameraMoveSpec，
// 进程隔离故两处各一份，与 staging 同例。move/speed/shot 枚举=S1 cameraMoveVocab 词表）。──
export const cameraMoveParamsObjectSchema = z.object({
  shotClientId: z
    .string()
    .describe("Target video nodeId or this turn's clientId."),
  move: z
    .enum([
      "orbit_left",
      "orbit_right",
      "push_in",
      "pull_out",
      "crane_up",
      "crane_down",
      "track_left",
      "track_right",
      "arc_left",
      "arc_right",
      "zoom_in",
      "zoom_out",
      "dolly_zoom",
    ])
    .optional()
    .describe("One dominant vocabulary camera move; otherwise use customMove."),
  // 词表外逃生口（运镜）：enum 是精确首选(确定性渲 3D 参考)，但意图不在 enum 里时
  // 不要硬塞最近的词——填自由文本，执行器不渲小片、把它当运镜指令追加进目标视频 prompt。
  customMove: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Out-of-vocabulary cinematography, injected into video prompt; excludes move."),
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
      "standing",
      "t-pose",
      "walk",
      "run",
      "sit",
      "squat",
      "crouch",
      "single-knee",
      "double-knee",
      "hands-on-hips",
      "point",
      "wave",
      "cheer",
    ])
    .optional()
    .describe("Subject body-pose preset; default standing."),
  // 灰模布景（走站位/UI 同一套 builder）：让运镜小片的参考里带上环境/尺度背景。相机仍绕主体运镜。
  sceneTemplate: z
    .enum(["street", "room"])
    .optional()
    .describe("Gray backdrop beneath the subject at origin."),
  props: z
    .array(
      z.object({
        kind: z.enum([
          "car",
          "building",
          "tree",
          "streetlamp",
          "wall",
          "suv",
          "bus",
          "bicycle",
          "scooter",
          "sofa",
          "diningTable",
          "fridge",
          "washingMachine",
          "trashBins",
          "atm",
          "backpack",
        ]),
        position: z
          .array(z.number())
          .length(2)
          .optional()
          .describe("Ground [x,z] meters, relative to subject at origin."),
        rotationY: z.number().optional().describe("Yaw in degrees."),
        scale: z.number().optional().describe("Uniform scale (0.1–10, default 1)."),
      }),
    )
    .max(12)
    .optional()
    .describe("Placed gray-model props; use sceneTemplate for a full backdrop."),
});

/** Workflow guidance shared by the model profiles; field schemas retain their concise meanings. */
// Keep workflow guidance once, alongside both profiles' schemas. Field-specific
// constraints and enum values remain in the typed schema, never in a second table.
export const STORYBOARD_MODEL_GUIDELINES = Object.freeze([
  "Stable anchor id becomes canvas clientId. Describe neutral, stable appearance/environment for visual cards; reusable prompt words for text anchors.",
  "carrier=visual generates shot reference images (faces/scenes/props); carrier=text folds words into shot prompts (tone/brand colors/wardrobe). character/scene/prop default visual; style defaults text.",
  "Same-sceneId shots must be contiguous; omit without grouping. Match all shot kinds to requested mode; default image unless video is explicit. Image: duration 0, no motion/transition/dialogue. Video: seconds, clamped to model max.",
  "Reference anchors by id. Video prompts: camera move + action progression, no repeated static anchors. Preserve captions and speaker/line dialogue verbatim on canvas/timeline. Explicit hard cut: cut; unauthored transition: omit.",
  "modelKey, mode/variant and parameter keys must come from available models; omit unknowns for defaults. First frames use image models; prefer image_ref/edit with visual anchors.",
  "First frame: static composition, shot size, light, pose/expression, environment; no motion, action progression, dialogue, subtitles or sound. Use supported image parameters. 图片+视频: first frame belongs inside its video shot, never a separate shot."
]);

export const STAGING_MODEL_GUIDELINES = Object.freeze([
  "shotClientId: this turn's create_canvas_nodes clientId or existing shot/keyframe/video id. Render connects as composition_ref; omit id for standalone reference.",
  "Stage 1–6 characters using precise 3D vocabulary, or supply customBlocking. Default pose standing; squat=deep squat, crouch=upright half-crouch, single-knee=proposal kneel, cheer=arms up; hands-on-hips, point and wave are literal poses.",
  "layout: side-by-side=shoulder-to-shoulder row（并排/一字排开）; line=front-to-back queue（纵队）; facing=two facing each other; behind=one ahead of another; circle=around a center.",
  "sceneTemplate supplies a gray backdrop: street has roads/lane lines/sidewalk/buildings/trees/lamps/cars; room has three walls/bed/table/sofa/ceiling light. Use it for environment and scale; street needs environment=day for a lit sky. Props are individual objects; prefer sceneTemplate for whole backdrops. Positions are [x,z] ground meters relative to characters at origin; omitted props auto-spread to their right.",
  "For out-of-vocabulary multi-tier/over-the-shoulder/prop-relative/reference-image compositions, use customBlocking film terms, never a wrong layout/pose. It injects a KEYFRAME IMAGE prompt directive, not a 3D render, and is less precise. With customBlocking, characters/layout/camera may be omitted; never omit both characters and customBlocking."
]);

export const CAMERA_MOVE_MODEL_GUIDELINES = Object.freeze([
  "shotClientId: this turn's clientId or existing VIDEO id. Render attaches as video reference; model copies camera path, not gray content.",
  "Use one dominant move: orbit_left/right circles ~300°; push_in/pull_out dollies toward/away; crane_up/down booms; track_left/right tracks laterally; arc_left/right arcs ~90°; zoom_in/out changes FOV with camera static; dolly_zoom pulls back while zooming in, keeping subject size constant as background stretches (Hitchcock/vertigo).",
  "Use enum move only when it matches the intent. For whip-pan, handheld follow, compound/sequenced moves (push then whip to window) or reference-video matching, omit move and describe customMove with film terms. This injects a video-prompt cinematography directive, not a 3D render, and is less precise. Set move OR customMove for the same intent.",
  "Subject pose defaults standing (also sit/walk). street/room sceneTemplate: gray backdrop; camera moves around subject at origin. props: individual objects. Prop [x,z] is ground meters; omission auto-spreads right of subject."
]);
