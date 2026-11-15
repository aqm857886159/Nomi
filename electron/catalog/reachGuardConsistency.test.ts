// **UI 收窄 与 第三闸 必须一口径**——本轮反复在修的病就是「两处各自算、各自漂移」，
// 所以这条测试专门跨边界钉住不变量：
//
//   UI 留下来的槽（reach ≠ none）、按 UI 允许的量放满 → 第三闸必须放行（不能出现「UI 让你放、
//   点生成被拒」）；UI 藏掉的槽 → 第三闸本来就会拒（藏对了）。
//
// 两侧读的是同一个 referenceReachability，但「同一个函数」不等于「用法一致」——UI 把 'single'
// 落实成 max=1，闸门看的是实际携带的 URL 条数，这中间的翻译才是会出错的地方。
import { describe, expect, it } from "vitest";
import { modeSlotReach, DEFAULT_SLOT_INPUT_KEY, type ReachSlot } from "./referenceReachability";
import { unreachableReferenceLabels } from "./taskParamsGuard";
import { NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";

const RELAY = NEWAPI_VIDEO_CREATE_OP.body;
const A = "https://cdn.example.com/a.png";
const B = "https://cdn.example.com/b.png";

/** 把「UI 会留下的槽 + UI 允许的量」翻成 runtime extras（模拟 buildReferenceExtras 的投影口径）。 */
function extrasFor(slots: ReachSlot[], reach: string[], urls: string[]): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  const archetypeInput: Record<string, unknown> = {};
  slots.forEach((slot, i) => {
    if (reach[i] === "none") return; // UI 藏掉了 → 用户放不进来
    const allowed = reach[i] === "single" ? 1 : urls.length;
    const take = urls.slice(0, allowed);
    if (take.length === 0) return;
    const key = slot.inputKey || DEFAULT_SLOT_INPUT_KEY[slot.kind];
    if (slot.kind === "first_frame") extras.firstFrameUrl = take[0];
    else if (slot.kind === "last_frame") extras.lastFrameUrl = take[0];
    else if (slot.kind === "image_ref") {
      extras.referenceImages = take;
      archetypeInput[key] = take;
    } else archetypeInput[key] = take;
  });
  if (Object.keys(archetypeInput).length) extras.archetypeInput = archetypeInput;
  return extras;
}

const slot = (kind: string, inputKey?: string): ReachSlot => ({ kind, inputKey });

describe("UI 收窄 ↔ 第三闸 一口径", () => {
  it("通用中转 · 全能参考：UI 只留角色图且收成 1 张 → 闸门放行（不会出现「让你放却拒发」）", () => {
    const slots = [slot("image_ref"), slot("video_ref"), slot("audio_ref")];
    const reach = modeSlotReach(slots, RELAY);
    expect(reach).toEqual(["single", "none", "none"]);
    const extras = extrasFor(slots, reach, [A, B]);
    expect(unreachableReferenceLabels({ extras }, RELAY)).toEqual([]);
  });

  it("通用中转 · 首尾帧：UI 只留首帧 → 闸门放行", () => {
    const slots = [slot("first_frame"), slot("last_frame")];
    const reach = modeSlotReach(slots, RELAY);
    expect(reach).toEqual(["single", "none"]);
    expect(unreachableReferenceLabels({ extras: extrasFor(slots, reach, [A, B]) }, RELAY)).toEqual([]);
  });

  it("反向：UI 若不收窄（放满 2 张角色图）闸门就会拒——证明这条收窄不是多余的", () => {
    const slots = [slot("image_ref")];
    const notNarrowed = extrasFor(slots, ["full"], [A, B]);
    expect(unreachableReferenceLabels({ extras: notNarrowed }, RELAY)).not.toEqual([]);
  });

  it("原生通道（body 真发得出数组）：UI 零收窄 且 闸门零拦截", () => {
    const body = { model: "x", image_urls: "{{request.params.image_urls}}" };
    const slots = [slot("image_ref", "image_urls")];
    const reach = modeSlotReach(slots, body);
    expect(reach).toEqual(["full"]);
    expect(unreachableReferenceLabels({ extras: extrasFor(slots, reach, [A, B]) }, body)).toEqual([]);
  });
});
