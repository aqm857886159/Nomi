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
    .describe("Stable id; used as the clientId when the plan lands on the canvas (e.g. 'anchor-1')."),
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
    .describe(
      "Scene/group id this shot belongs to (e.g. 'scene-1'). Shots of the same scene must be contiguous and share the id; omit when the story has no scene grouping.",
    ),
  shotKind: z
    .enum(["image", "video"])
    .optional()
    .describe(
      "Shot kind: 'image' = still image-storyboard frame (image-to-image, no duration, no camera move / transition / dialogue), 'video' = video shot (has duration + camera motion). Match ALL shots to the storyboard mode requested by the user; default to 'image' unless the user explicitly wants video.",
    ),
  durationSec: z
    .number()
    .describe(
      "Shot duration in seconds (video shots only; for image shots emit 0). Clamped to the chosen model's max when it lands.",
    ),
  anchorIds: z
    .array(z.string())
    .describe(
      "Which anchors this shot uses (by anchor.id) → visual anchors become reference edges, text anchors fold into the prompt.",
    ),
  prompt: z
    .string()
    .describe(
      "Directly-generatable prompt: camera move + action progression; do NOT restate the anchors' static descriptions.",
    ),
  // P0-9:让 AI 一并产出每镜的模型/模式/参数(含负面词)。取值必须来自用户消息里的「可用模型」清单,
  // 不要编不存在的 modelKey/参数名;不确定就留空,落画布时系统用默认视频模型兜底。
  modelKey: z
    .string()
    .optional()
    .describe(
      "Video model key for this shot, chosen from the 「可用模型」 list in the user message. Omit to use the default video model.",
    ),
  modeId: z
    .string()
    .optional()
    .describe(
      "Model mode/variant id (paired with modelKey), from the same list. Omit to use the model's default mode.",
    ),
  params: z
    .record(generationParamValueSchema)
    .optional()
    .describe(
      "Per-shot generation params keyed exactly as the chosen model exposes them in the 「可用模型」 list (e.g. aspect_ratio, resolution, and negative_prompt where the model supports it). Only use param keys that model actually lists; omit unknowns.",
    ),
  subtitle: z
    .string()
    .optional()
    .describe(
      "On-screen caption/subtitle text for this shot, carried verbatim to canvas metadata and timeline assembly.",
    ),
  dialogue: z
    .string()
    .optional()
    .describe(
      "Spoken dialogue for this shot (speaker + line), carried verbatim to canvas metadata and timeline assembly.",
    ),
  transition: z
    .object({
      type: z.enum(["cut", "dissolve", "fade", "match_cut", "whip_pan"]),
      durationFrames: z.number().int().positive().optional(),
    })
    .optional()
    .describe(
      "Explicit editorial transition into the next shot; emit cut for an intentional hard cut, omit when no transition is authored.",
    ),
  keyframe: z
    .object({
      enabled: z
        .boolean()
        .optional()
        .describe("Set true only for 图片+视频 mode: create a first-frame image before the video."),
      prompt: z
        .string()
        .optional()
        .describe(
          "Static first-frame image prompt: composition, shot size, light, character pose/expression, environment. No camera movement, action progression, dialogue, subtitles, or sound.",
        ),
      modelKey: z
        .string()
        .optional()
        .describe(
          "Image model key for the first-frame image, chosen from the available image models. Omit to use the default image model.",
        ),
      modeId: z
        .string()
        .optional()
        .describe(
          "Image model mode id for the first-frame image. Prefer an image_ref/edit mode when this shot references visual anchors.",
        ),
      params: z
        .record(generationParamValueSchema)
        .optional()
        .describe("First-frame image params, using only keys supported by the chosen image model/mode."),
    })
    .optional()
    .describe(
      "Optional first-frame plan. In 图片+视频 mode keep this as part of the same logical shot instead of emitting a separate image shot.",
    ),
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
    .describe(
      "clientId (from this turn's create_canvas_nodes) or real node id of the shot/keyframe/video this staging locks; the rendered reference auto-connects to it as composition_ref. Omit for a standalone reference.",
    ),
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
          .describe(
            "Body pose preset (default standing). squat=deep squat, crouch=upright half-crouch, single-knee=proposal kneel, hands-on-hips, point, wave, cheer=arms up.",
          ),
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
    .describe(
      "Spatial arrangement. side-by-side = shoulder-to-shoulder in a row (并排/一排/一字排开, e.g. a lineup or saluting row); line = a single-file queue front-to-back (纵队/列队前后排); facing = two face each other (对峙/对坐/对话); behind = one in front of another (一前一后/跟踪); circle = around a center (围绕/环绕).",
    ),
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
    .describe(
      "Optional gray-model backdrop laid under the characters: street = city street (road/lane-lines/sidewalk/buildings/trees/streetlamps/cars), room = interior (three walls/bed/table/sofa/ceiling light). Use when the shot needs a legible environment + scale reference. Set environment=day for street (sky) if you want it lit.",
    ),
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
          .describe(
            "[x, z] ground position in meters. Character(s) are at origin; omit to auto-spread props to the character's right.",
          ),
        rotationY: z.number().optional().describe("Yaw in degrees."),
        scale: z.number().optional().describe("Uniform scale (0.1–10, default 1)."),
      }),
    )
    .max(12)
    .optional()
    .describe(
      "Optional individual gray-model props (a car beside the character, a tree behind, etc.). Prefer sceneTemplate for a full backdrop; use props for a few specific placed objects.",
    ),
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
export const cameraMoveParamsObjectSchema = z.object({
  shotClientId: z
    .string()
    .describe(
      "clientId (from this turn's create_canvas_nodes) or real node id of the shot's VIDEO node this camera move drives. The rendered camera-move clip auto-attaches to it as a video reference (the model copies the camera path, not the gray content).",
    ),
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
    .describe(
      "The single dominant camera move for this shot. orbit_left/right = camera circles the subject (~300°); push_in/pull_out = dolly toward/away; crane_up/down = boom up/down; track_left/right = lateral tracking; arc_left/right = short arc (~90°); zoom_in/zoom_out = lens zoom with the camera static (FOV ramp); dolly_zoom = Hitchcock/vertigo effect (camera pulls back while zooming in, subject size constant, background stretches away). " +
        "Use ONE of these enum values ONLY when the intended move IS one of them (renders a precise 3D reference). If the move is NOT in this set (e.g. whip-pan, handheld follow, a compound/sequenced move, or 'match this reference video'), DO NOT force a wrong enum — leave move empty and use customMove instead.",
    ),
  // 词表外逃生口（运镜）：enum 是精确首选(确定性渲 3D 参考)，但意图不在 enum 里时
  // 不要硬塞最近的词——填自由文本，执行器不渲小片、把它当运镜指令追加进目标视频 prompt。
  customMove: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Natural-language camera-move description for moves OUTSIDE the enum (whip pan, handheld follow, a compound/sequenced move like 'push in then whip to the window', or 'match this reference video's camerawork'). The tool will NOT 3D-render this — it injects it as a cinematography directive into the shot's video prompt (less precise than the rendered reference; the honest fallback). Use proper film terms. Set move OR customMove, never both for the same intent.",
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
    .describe(
      "Optional body-pose preset id for the subject mannequin the camera moves around (e.g. standing / sit / walk). Default standing.",
    ),
  // 灰模布景（走站位/UI 同一套 builder）：让运镜小片的参考里带上环境/尺度背景。相机仍绕主体运镜。
  sceneTemplate: z
    .enum(["street", "room"])
    .optional()
    .describe(
      "Optional gray-model backdrop under the subject: street (road/buildings/trees/cars) or room (walls/furniture). Use when the camera move should read as happening in an environment (e.g. 'push in on a person standing on a street'). The camera still orbits/pushes the subject at origin.",
    ),
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
          .describe("[x, z] ground position in meters. Subject is at origin; omit to auto-spread props to its right."),
        rotationY: z.number().optional().describe("Yaw in degrees."),
        scale: z.number().optional().describe("Uniform scale (0.1–10, default 1)."),
      }),
    )
    .max(12)
    .optional()
    .describe(
      "Optional individual gray-model props placed in the move's scene (a car beside the subject, a tree behind). Prefer sceneTemplate for a full backdrop.",
    ),
});
