import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANVAS_READ_CAPABILITY } from "../../shared/agentCapabilities/canvasRead";
import {
  cameraMoveParamsSchema,
  canvasNodeKindSchema,
  canvasToolNames,
  canvasToolDescriptors,
  plannedEdgeSchema,
  plannedNodeSchema,
  storyboardPlanParamsSchema,
} from "./canvasDescriptors";

const FORBIDDEN_OWNER_IMPORT =
  /(?:from|import\s*\()\s*["'](?:ai|@ai-sdk\/[^"']*|@mariozechner\/[^"']*|@earendil-works\/pi-[^"']*|[^"']*agentChatV2)["']/;

describe("Nomi canvas descriptors", () => {
  it("owns exactly the remaining five legacy tool names", () => {
    expect(Object.keys(canvasToolDescriptors)).toEqual([...canvasToolNames]);
    for (const [name, descriptor] of Object.entries(canvasToolDescriptors)) {
      expect(descriptor.name).toBe(name);
      expect(Object.keys(descriptor).sort()).toEqual(["description", "name", "parameters"]);
    }
  });

  it("detects static and dynamic imports from every forbidden SDK prefix", () => {
    const imports = [
      "ai",
      "@ai-sdk/openai",
      "@mariozechner/pi-coding-agent",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-agent-core",
      "@earendil-works/pi-ai",
    ].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => !FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("allows Zod, Node, and local pure helpers", () => {
    const imports = ["zod", "node:path", "../../jsonUtils"].flatMap((specifier) => [
      `import { dependency } from "${specifier}";`,
      `const dependency = await import('${specifier}');`,
    ]);
    expect(imports.filter((source) => FORBIDDEN_OWNER_IMPORT.test(source))).toEqual([]);
  });

  it("has no runtime or SDK dependency", () => {
    const source = readFileSync(new URL("./canvasDescriptors.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(FORBIDDEN_OWNER_IMPORT);
    expect(source).not.toMatch(/\b(?:tool\s*\(|execute\s*:)/);
  });

  it("preserves the byte-exact LIVE agentChatV2 descriptions, not the unused legacy table", () => {
    // Captured from buildCanvasToolsForV2 at b4a3f466 before extraction.
    const descriptions = Object.fromEntries(
      Object.entries(canvasToolDescriptors).map(([name, value]) => [name, value.description]),
    );
    expect(createHash("sha256").update(JSON.stringify(descriptions)).digest("hex")).toBe(
      "da441357a56e731d16ed1567cc6edb753f15c5f3b1dbe27b391078f2cdaff48e",
    );
  });

  it("projects the Pi canvas.read descriptor directly from the canonical contract", () => {
    const descriptor = canvasToolDescriptors.read_canvas_state;
    expect(descriptor.name).toBe(CANVAS_READ_CAPABILITY.aliases.pi);
    expect(descriptor.description).toBe(CANVAS_READ_CAPABILITY.projections.pi?.description);
    expect(descriptor.parameters).toBe(CANVAS_READ_CAPABILITY.inputSchema);

    const source = readFileSync(new URL("./canvasDescriptors.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*read_canvas_state:\s*\{/m);
    expect(source).not.toMatch(/name:\s*["']read_canvas_state["']/);
    expect(source).not.toContain('description: "Read the current generation canvas (nodes + edges)."');
    expect(source).not.toMatch(/read_canvas_state:\s*\{[\s\S]{0,160}parameters:\s*z\.object\(\{\}\)/);
  });

  it("exposes storyboard string preprocessing through the real descriptor", () => {
    const shot = { index: 1, durationSec: 0, anchorIds: [], prompt: "A still frame" };
    expect(
      canvasToolDescriptors.propose_storyboard_plan.parameters.parse({
        title: "Draft",
        anchors: [],
        shots: JSON.stringify([shot]),
      }),
    ).toEqual({ title: "Draft", anchors: [], shots: [shot] });
  });

  it("exposes camera normalization through the real descriptor", () => {
    expect(
      canvasToolDescriptors.create_camera_move.parameters.parse({
        shotClientId: "video-1",
        move: "push_in",
        customMove: "handheld follow",
      }),
    ).toEqual({ shotClientId: "video-1", customMove: "handheld follow" });
  });

  it("requires an explicit non-empty timeline node subset of at most 48 ids", () => {
    const schema = canvasToolDescriptors.arrange_storyboard_to_timeline.parameters;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ nodeIds: [] }).success).toBe(false);
    expect(schema.safeParse({ nodeIds: Array.from({ length: 48 }, (_, i) => `n${i}`) }).success).toBe(true);
    expect(schema.safeParse({ nodeIds: Array.from({ length: 49 }, (_, i) => `n${i}`) }).success).toBe(false);
  });

  it("retains the calibrated pose vocabulary and staging character limit", () => {
    const schema = canvasToolDescriptors.create_staging_reference.parameters;
    for (const pose of [
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
    ]) {
      expect(schema.safeParse({ characters: [{ pose }] }).success, pose).toBe(true);
      expect(
        canvasToolDescriptors.create_camera_move.parameters.safeParse({ shotClientId: "v", subjectPose: pose }).success,
        pose,
      ).toBe(true);
    }
    expect(schema.safeParse({ characters: [{ pose: "flying" }] }).success).toBe(false);
    expect(schema.safeParse({ characters: Array.from({ length: 6 }, () => ({ pose: "standing" })) }).success).toBe(
      true,
    );
    expect(schema.safeParse({ characters: Array.from({ length: 7 }, () => ({ pose: "standing" })) }).success).toBe(
      false,
    );
  });

  it("retains the 12-prop range on both 3D descriptors", () => {
    for (const name of ["create_staging_reference", "create_camera_move"] as const) {
      const schema = canvasToolDescriptors[name].parameters;
      expect(
        schema.safeParse({ shotClientId: "v", props: Array.from({ length: 12 }, () => ({ kind: "car" })) }).success,
      ).toBe(true);
      expect(
        schema.safeParse({ shotClientId: "v", props: Array.from({ length: 13 }, () => ({ kind: "car" })) }).success,
      ).toBe(false);
    }
  });
});

const makeValidNode = (overrides: Partial<Record<string, unknown>> = {}) => ({
  clientId: "n1",
  kind: "image",
  title: "Shot 1",
  prompt: "A scenic mountain view",
  position: { x: 100, y: 200 },
  ...overrides,
});

describe("canvas descriptor schemas", () => {
  describe("cameraMoveParamsSchema", () => {
    it("treats model placeholder strings as an empty customMove", () => {
      const parsed = cameraMoveParamsSchema.parse({
        shotClientId: "video-1",
        move: "push_in",
        customMove: "none",
        speed: "slow",
      });

      expect(parsed).toMatchObject({ shotClientId: "video-1", move: "push_in", speed: "slow" });
      expect(parsed).not.toHaveProperty("customMove");
    });

    it("promotes a custom description that exactly matches one preset", () => {
      const parsed = cameraMoveParamsSchema.parse({
        shotClientId: "video-1",
        customMove: "缓慢稳定地向女孩面部推进，从肩侧近景收至眼神特写；运动柔和",
        speed: "slow",
      });

      expect(parsed).toMatchObject({ shotClientId: "video-1", move: "push_in", speed: "slow" });
      expect(parsed).not.toHaveProperty("customMove");
    });

    it("normalizes a stale enum away when customMove carries the latest intent", () => {
      const parsed = cameraMoveParamsSchema.parse({
        shotClientId: "video-1",
        move: "push_in",
        customMove: "快速甩镜到窗外街景",
      });

      expect(parsed).toMatchObject({
        shotClientId: "video-1",
        customMove: "快速甩镜到窗外街景",
      });
      expect(parsed).not.toHaveProperty("move");
    });

    it("keeps compound preset descriptions on the custom path", () => {
      const parsed = cameraMoveParamsSchema.parse({
        shotClientId: "video-1",
        customMove: "先推近女孩，再向右弧移到窗外",
      });

      expect(parsed).toMatchObject({
        shotClientId: "video-1",
        customMove: "先推近女孩，再向右弧移到窗外",
      });
      expect(parsed).not.toHaveProperty("move");
    });
  });

  describe("canvasNodeKindSchema", () => {
    it("accepts the 9 supported kinds", () => {
      for (const kind of ["text", "character", "scene", "image", "keyframe", "video", "shot", "output", "panorama"]) {
        expect(canvasNodeKindSchema.safeParse(kind).success).toBe(true);
      }
    });

    it("rejects unknown kinds", () => {
      expect(canvasNodeKindSchema.safeParse("audio").success).toBe(false);
      expect(canvasNodeKindSchema.safeParse("").success).toBe(false);
      expect(canvasNodeKindSchema.safeParse(42).success).toBe(false);
    });
  });

  describe("plannedNodeSchema", () => {
    it("accepts a well-formed node", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode()).success).toBe(true);
    });

    it("requires a non-empty clientId", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ clientId: "" })).success).toBe(false);
    });

    it("requires a non-empty title", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ title: "" })).success).toBe(false);
    });

    it("requires numeric position", () => {
      const bad = makeValidNode({ position: { x: "100", y: 200 } as unknown });
      expect(plannedNodeSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects unknown kind", () => {
      expect(plannedNodeSchema.safeParse(makeValidNode({ kind: "audio" })).success).toBe(false);
    });
  });

  describe("plannedEdgeSchema", () => {
    it("accepts a well-formed edge", () => {
      const ok = plannedEdgeSchema.safeParse({ sourceClientId: "n1", targetClientId: "n2" });
      expect(ok.success).toBe(true);
    });

    it("rejects empty source or target", () => {
      expect(plannedEdgeSchema.safeParse({ sourceClientId: "", targetClientId: "n2" }).success).toBe(false);
      expect(plannedEdgeSchema.safeParse({ sourceClientId: "n1", targetClientId: "" }).success).toBe(false);
    });
  });

  describe("canvasToolNames", () => {
    it("enumerates all 5 remaining legacy tools", () => {
      expect(canvasToolNames).toEqual([
        "read_canvas_state",
        "propose_storyboard_plan", // 分镜方案：产出结构化方案对象落创作区，确认后才落画布
        "arrange_storyboard_to_timeline", // 按剧本镜序排片到时间轴
        "create_staging_reference", // 3D 站位参考图（站位+动作+机位）
        "create_camera_move", // 3D 运镜参考小片（喂 video_ref / 降级 prompt）
      ]);
    });

    it("matches the keys of canvasToolDescriptors", () => {
      expect(Object.keys(canvasToolDescriptors).sort()).toEqual([...canvasToolNames].sort());
    });
  });

  describe("propose_storyboard_plan parameters", () => {
    it("accepts an image+video logical shot with an embedded keyframe plan", () => {
      const parsed = storyboardPlanParamsSchema.safeParse({
        title: "首帧驱动视频",
        anchors: [],
        shots: [
          {
            index: 1,
            shotKind: "video",
            durationSec: 6,
            anchorIds: [],
            prompt: "镜头缓慢推近，人物抬头",
            keyframe: {
              enabled: true,
              prompt: "人物坐在电脑前，冷蓝屏幕光，中近景静态构图",
              modelKey: "image-model",
              params: { aspect_ratio: "16:9" },
            },
          },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts a valid JSON-stringified shots array as defensive compatibility", () => {
      const parsed = storyboardPlanParamsSchema.safeParse({
        title: "字符串化数组兜底",
        anchors: [],
        shots: JSON.stringify([
          {
            index: 1,
            shotKind: "video",
            durationSec: 6,
            anchorIds: [],
            prompt: "镜头缓慢推近，人物抬头",
            keyframe: { enabled: true, prompt: "人物坐在电脑前，冷蓝屏幕光，中近景静态构图" },
          },
        ]),
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.shots).toHaveLength(1);
    });

    it("rejects malformed JSON-stringified shots instead of guessing a repair", () => {
      const parsed = storyboardPlanParamsSchema.safeParse({
        title: "坏字符串",
        anchors: [],
        shots:
          '[{"index":1,"shotKind":"video","durationSec":6,"anchorIds":[],"prompt":"p","keyframe":{"enabled":true,"prompt":"k"}}',
      });
      expect(parsed.success).toBe(false);
    });

    it("still rejects more than 24 logical shots", () => {
      const shots = Array.from({ length: 25 }, (_, i) => ({
        index: i + 1,
        shotKind: "video",
        durationSec: 5,
        anchorIds: [],
        prompt: `shot ${i + 1}`,
      }));
      expect(storyboardPlanParamsSchema.safeParse({ title: "too many", anchors: [], shots }).success).toBe(false);
    });

    // v5：sceneId + 台词/字幕/转场进 propose schema（原 §3.10 登记缺口）——zod 默认剥未知键，
    // 不进 schema 的字段会在这里被静默吃掉、渲染层永远拿不到。
    it("accepts and keeps sceneId/subtitle/dialogue/transition (v5 additions)", () => {
      const parsed = storyboardPlanParamsSchema.safeParse({
        title: "带场与台词",
        anchors: [],
        shots: [
          {
            index: 1,
            sceneId: "scene-1",
            shotKind: "video",
            durationSec: 5,
            anchorIds: [],
            prompt: "中景，手持",
            subtitle: "三年了",
            dialogue: "陈默：「你不该回来的。」",
            transition: { type: "dissolve", durationFrames: 12 },
          },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.shots[0]).toMatchObject({
          sceneId: "scene-1",
          subtitle: "三年了",
          dialogue: "陈默：「你不该回来的。」",
          transition: { type: "dissolve", durationFrames: 12 },
        });
      }
    });

    it("rejects an unknown transition type instead of guessing", () => {
      const parsed = storyboardPlanParamsSchema.safeParse({
        title: "坏转场",
        anchors: [],
        shots: [{ index: 1, shotKind: "video", durationSec: 5, anchorIds: [], prompt: "p", transition: { type: "explode" } }],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("read_canvas_state parameters", () => {
    it("accepts only the empty semantic object", () => {
      expect(canvasToolDescriptors.read_canvas_state.parameters.safeParse({}).success).toBe(true);
      expect(canvasToolDescriptors.read_canvas_state.parameters.safeParse({ projectId: "project-a" }).success).toBe(
        false,
      );
      expect(canvasToolDescriptors.read_canvas_state.parameters.safeParse({ leaseHandle: "lease-a" }).success).toBe(
        false,
      );
    });
  });
});
