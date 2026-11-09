/**
 * 参考绑定的验收合同：同一份绑定夹具（同一组参考、同一条 body、同一对档案模式）走画布、headless、Run 三个入口，
 * 每条用例的名字是「入口 · 用到的绑定」，expected 是手写字面量。
 *
 * 这份合同的用法是变异：在公共解析器里单独改一种目标策略（同组全读 ↔ 组首、都不读时补组首）或一种编码
 * （数组 ↔ 字符串、角色对象 ↔ 扁平地址），**用到这一种的全部入口必须一起红**；只有一个入口红，说明还有另一份放置逻辑。
 * 没有档案模式的 Run 旧值不许被套成档案槽的编码（单图仍是数组）。
 */
import { describe, expect, it } from "vitest";
import { buildArchetypeInputParams } from "../../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { headlessReferenceOverlay } from "../../catalog/taskParams";
import type { ArchetypeMode, ModelArchetype } from "../videoCapabilities/types";
import { placeApprovedRunReferences, standardizeExplicitRunReferences } from "./runReferences";

const A = "https://cdn.example/a.png";
const B = "https://cdn.example/b.png";
const F = "https://cdn.example/first.png";

/** 同一条 body：列表位读两个同组写法、一个首帧位、一个角色数组位。 */
const BODY = {
  model: "m",
  prompt: "{{request.prompt}}",
  image_urls: "{{request.params.image_urls}}",
  imageUrls: "{{request.params.imageUrls}}",
  first_frame_url: "{{request.params.first_frame_url}}",
  image_with_roles: "{{request.params.image_with_roles}}",
};
const BODY_KEYS = ["image_urls", "imageUrls", "first_frame_url", "image_with_roles"];
/** 不读任何参考键的 body（目标策略「都不读 → 组首」）。 */
const EMPTY_BODY = { model: "m", prompt: "{{request.prompt}}" };

const SLOTS: ArchetypeMode["slots"] = [
  { kind: "first_frame", label: "first", min: 0, max: 1 },
  { kind: "image_ref", label: "refs", min: 0, max: 4, inputKey: "image_urls" },
];
const LIST_MODE: ArchetypeMode = { id: "list", intent: "single", vendorTerm: "list", hint: "", slots: SLOTS, params: [], promptRequired: false };
const ROLES_MODE: ArchetypeMode = { ...LIST_MODE, id: "roles", combineSlotsInto: { key: "image_with_roles" } };
const ARCHETYPE = {
  id: "binding-fixture", family: "fixture", label: "Fixture", kind: "video", modes: [LIST_MODE, ROLES_MODE],
  defaultModeId: "list", transportTaskKind: "image_to_video", identifierPatterns: [],
} satisfies ModelArchetype;

const ROLES = [{ url: F, role: "first_frame" }, { url: A, role: "reference_image" }, { url: B, role: "reference_image" }];

function canvas(modeId: string): Record<string, unknown> {
  return buildArchetypeInputParams({ archetype: { id: ARCHETYPE.id, modeId } }, ARCHETYPE, { firstFrameUrl: F, referenceImages: [A, B] });
}

function headless(): Record<string, unknown> {
  return headlessReferenceOverlay({ firstFrameUrl: F, referenceImageUrls: [A, B] }, BODY);
}

function approved(mode: ArchetypeMode | null, createBody: unknown = BODY, images: readonly string[] = [A, B]): Record<string, unknown> {
  // 首帧只在 body 有帧位时给（没有帧位的 body 收首帧是拒发，另由特征测试钉）。
  const frame = createBody === BODY ? [{ url: F, kind: "image", role: "first_frame" }] : [];
  return placeApprovedRunReferences({}, [
    ...frame,
    ...images.map((url) => ({ url, kind: "image", role: "reference" })),
  ], createBody, mode).parameters;
}

function explicit(parameters: Record<string, unknown>, bodyKeys: readonly string[] = BODY_KEYS): Record<string, unknown> {
  return standardizeExplicitRunReferences(parameters, bodyKeys);
}

describe("参考绑定合同", () => {
  it("canvas · url-list", () => expect(canvas("list").image_urls).toEqual([A, B]));
  it("canvas · url-string", () => expect(canvas("list").first_frame_url).toBe(F));
  it("canvas · role-objects", () => expect(canvas("roles").image_with_roles).toEqual(ROLES));

  it("headless · url-list", () => expect(headless().image_urls).toEqual([A, B]));
  it("headless · url-string", () => expect(headless().first_frame_url).toBe(F));

  it("run-approved · url-list", () => expect(approved(null).image_urls).toEqual([A, B]));
  it("run-approved · url-string", () => expect(approved(null).first_frame_url).toBe(F));
  it("run-approved · role-objects", () => expect(approved(ROLES_MODE).image_with_roles).toEqual(ROLES));
  it("run-approved · every-read", () => expect(Object.keys(approved(null))).toEqual(["first_frame_url", "image_urls", "imageUrls"]));
  it("run-approved · head-when-none-read", () => expect(approved(null, EMPTY_BODY, [A]).image_urls).toEqual([A]));
  it("run-approved · no-mode-not-slot-encoded", () => expect(approved(null, BODY, [A]).image_urls).toEqual([A]));

  it("run-explicit · url-list", () => expect(explicit({ input_urls: [A, B] }).image_urls).toEqual([A, B]));
  it("run-explicit · url-string", () => expect(explicit({ first_frame_image: F }).first_frame_url).toBe(F));
  it("run-explicit · role-objects", () => expect(explicit({ imageWithRoles: ROLES }).image_with_roles).toEqual(ROLES));
  it("run-explicit · every-read", () => expect(Object.keys(explicit({ input_urls: [A] }))).toEqual(["input_urls", "image_urls", "imageUrls"]));
  it("run-explicit · head-when-none-read", () => expect(explicit({ input_urls: [A] }, []).image_urls).toEqual([A]));
});
