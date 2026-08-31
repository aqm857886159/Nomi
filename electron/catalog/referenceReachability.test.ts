// 渠道承载力：UI 收窄与第三闸共用的判据。
// 夹具一律用**真实 body**（NEWAPI_VIDEO_CREATE_OP / apimart / 火山），不自造——本轮栽过「编错 fixture
// 把自己骗过去」（ComfyUI 视频通道整条不存在却测试全绿）。
import { describe, expect, it } from "vitest";
import { modeSlotReach, modeIsUsable, bodyReferenceSupport, DEFAULT_SLOT_INPUT_KEY, type ReachSlot } from "./referenceReachability";
import { NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";
import { VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { APIMART_IMAGE_MODELS } from "./apimartImages";

const RELAY = NEWAPI_VIDEO_CREATE_OP.body;
/** apimart 全能参考 body 的口径：整组数组键都在。 */
const APIMART_OMNI = {
  model: "{{request.params.model}}",
  image_urls: "{{request.params.image_urls}}",
  video_urls: "{{request.params.video_urls}}",
  audio_urls: "{{request.params.audio_urls}}",
};
const VOLC_I2V = VOLCENGINE_VIDEO_MODELS[0].mappings.find((m) => m.taskKind === "image_to_video")?.create.body;

const slot = (kind: string, inputKey?: string): ReachSlot => ({ kind, inputKey });

describe("modeSlotReach · 通用中转最小模板（只有 image_url 这个单图聚合位）", () => {
  it("首尾帧：首帧挤得进聚合位，尾帧发不出——「首尾帧只过得去首帧」的真相", () => {
    expect(modeSlotReach([slot("first_frame"), slot("last_frame")], RELAY)).toEqual(["single", "none"]);
  });

  it("全能参考：只有角色图能挤 1 张，参考视频/音频整条发不出", () => {
    expect(modeSlotReach([slot("image_ref"), slot("video_ref"), slot("audio_ref")], RELAY)).toEqual([
      "single",
      "none",
      "none",
    ]);
  });

  it("单图首帧：能用（刚好占掉那唯一名额）", () => {
    expect(modeSlotReach([slot("first_frame")], RELAY)).toEqual(["single"]);
  });

  it("聚合位只有一个名额，不是每槽一个（否则会谎称首尾帧都行）", () => {
    const reach = modeSlotReach([slot("first_frame"), slot("last_frame"), slot("image_ref")], RELAY);
    expect(reach.filter((r) => r === "single")).toHaveLength(1);
    expect(reach[0]).toBe("single"); // 优先级同 firstReferenceImage：首帧最先
  });

  it("源视频类（补帧/超分）在通用中转上整条发不出", () => {
    expect(modeSlotReach([slot("source_video")], RELAY)).toEqual(["none"]);
    expect(modeIsUsable([slot("source_video")], RELAY)).toBe(false);
  });
});

describe("modeSlotReach · 专用 codec 零收窄（修完不能反过来误伤原生通道）", () => {
  it("apimart 全能参考：角色图/参考视频/参考音频全 full", () => {
    expect(modeSlotReach([slot("image_ref", "image_urls"), slot("video_ref", "video_urls"), slot("audio_ref", "audio_urls")], APIMART_OMNI)).toEqual([
      "full",
      "full",
      "full",
    ]);
  });

  it("多图数组也能承载首帧槽的第一个参考", () => {
    expect(modeSlotReach([slot("first_frame"), slot("last_frame")], APIMART_OMNI)).toEqual(["single", "none"]);
  });

  it("火山原生 i2v：声明了 volcengine_* 键的槽全 full", () => {
    const slots = [
      slot("first_frame", "volcengine_first_role_image_content"),
      slot("last_frame", "volcengine_last_role_image_content"),
      slot("image_ref", "volcengine_image_contents"),
      slot("video_ref", "volcengine_video_contents"),
    ];
    expect(modeSlotReach(slots, VOLC_I2V)).toEqual(["full", "full", "full", "full"]);
  });
});

describe("modeSlotReach · 不误伤的边界", () => {
  it("body 不引用任何参数（纯静态）→ 判不出来就全放行，与第三闸同口径", () => {
    expect(modeSlotReach([slot("image_ref"), slot("video_ref")], { model: "x" })).toEqual(["full", "full"]);
  });

  it("纯文生模式（没有参考槽）永远可用", () => {
    expect(modeIsUsable([], RELAY)).toBe(true);
  });

  it("槽显式声明的 inputKey 优先于缺省表", () => {
    // HappyHorse 角色参考的 inputKey 是 reference_image（非缺省的 reference_image_urls）。
    const body = { input: { reference_image: "{{request.params.reference_image}}" } };
    expect(modeSlotReach([slot("image_ref", "reference_image")], body)).toEqual(["full"]);
    expect(modeSlotReach([slot("image_ref")], body)).toEqual(["none"]); // 缺省键不在 body 里
  });
});

describe("缺省 inputKey 表 = 单一真相源", () => {
  it("六种槽 kind 都有缺省键（渲染层发送构造与本判定共用同一张表）", () => {
    expect(Object.keys(DEFAULT_SLOT_INPUT_KEY).sort()).toEqual(
      ["audio_ref", "first_frame", "image_ref", "last_frame", "source_video", "video_ref"].sort(),
    );
  });
});

describe("bodyReferenceSupport · list_models 逐 mapping 汇报参考能力（真实 body，与 modeSlotReach 同源判据）", () => {
  const seedance25 = APIMART_VIDEO_MODELS.find((m) => m.modelKey === "doubao-seedance-2.5")!;
  const seedream45 = APIMART_IMAGE_MODELS.find((m) => m.modelKey === "doubao-seedream-4.5")!;

  it("seedance 2.5 t2v body（纯文生）→ 无任何参考能力", () => {
    const t2v = seedance25.mappings.find((m) => m.taskKind === "text_to_video")!.create.body;
    expect(bodyReferenceSupport(t2v)).toEqual({ image: false, video: false, audio: false, multiImage: false });
  });

  it("seedance 2.5 i2v body（image_urls 数组 + video_urls + audio_urls）→ 图/视频/音频全能，且图可多张", () => {
    const i2v = seedance25.mappings.find((m) => m.taskKind === "image_to_video")!.create.body;
    expect(bodyReferenceSupport(i2v)).toEqual({ image: true, video: true, audio: true, multiImage: true });
  });

  it("seedream 4.5 文生图 body → 无参考；改图 body（image_urls 数组）→ 图 + 多张", () => {
    const t2i = seedream45.mappings.find((m) => m.taskKind === "text_to_image")!.create.body;
    const edit = seedream45.mappings.find((m) => m.taskKind === "image_edit")!.create.body;
    expect(bodyReferenceSupport(t2i)).toEqual({ image: false, video: false, audio: false, multiImage: false });
    expect(bodyReferenceSupport(edit)).toMatchObject({ image: true, multiImage: true });
    expect(bodyReferenceSupport(edit).video).toBe(false);
  });

  it("通用中转最小模板（单图聚合位 image）→ 图能发但**非多张**（multiImage=false）", () => {
    const support = bodyReferenceSupport(RELAY);
    expect(support.image).toBe(true);
    expect(support.multiImage).toBe(false);
  });

  it("纯静态 body（不引用任何参数）→ 全 false（判不出就不谎称有能力，与不误伤对称）", () => {
    expect(bodyReferenceSupport({ model: "x", prompt: "{{request.prompt}}" })).toEqual({ image: false, video: false, audio: false, multiImage: false });
  });

  it("火山原生 i2v（volcengine_*_content 键）→ 图/视频能发（原生嵌套键也被识别）", () => {
    const support = bodyReferenceSupport(VOLC_I2V);
    expect(support.image).toBe(true);
    expect(support.video).toBe(true);
  });
});

describe("合并槽（mode.combineSlotsInto）", () => {
  it("整组槽合并进一个键发出时，认合并键——否则会把原生首尾帧通道判死", () => {
    // apimart 首尾帧：两个槽序列化进 image_with_roles 一个参数。
    const body = { model: "x", image_with_roles: "{{request.params.image_with_roles}}" };
    const slots = [slot("first_frame"), slot("last_frame")];
    expect(modeSlotReach(slots, body)).toEqual(["none", "none"]); // 不认合并键 = 全判死
    expect(modeSlotReach(slots, body, "image_with_roles")).toEqual(["full", "full"]);
  });

  it("Veo 首尾帧走 flat 的 image_urls：同样认得出", () => {
    const body = { image_urls: "{{request.params.image_urls}}" };
    expect(modeSlotReach([slot("first_frame"), slot("last_frame")], body, "image_urls")).toEqual(["full", "full"]);
  });
});
