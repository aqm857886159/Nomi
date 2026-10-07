// 改草稿 = 只改被点名的参数，其余不动（2026-10-05，设计卡 docs/plan/2026-10-05-draft-revision-merge-params.md）。
//
// 以前 `resolvePlanPatch` 对参数是整份替换：Agent 只改比例，清晰度掉回默认（验收线实测 4K → 1K）；
// 只改清晰度，比例被清掉。现在点名的键合并进原有参数，`null` 显式清掉一个键；回给 Agent 的 changeset
// 列出这次实际改了哪几个键。付费卡每次带完整参数集，合并与替换结果相同——最后一组钉住这一点。
// 用真档案（Z-Image 键 size、Nano Banana 2 kie 键 aspect_ratio、Veo 3.1 Runway 像素档）。
import { describe, expect, it } from "vitest";

import { ContractCompilationError, type PlanCandidate } from "./executionContract";
import { resolvePlanPatch } from "./generationPlanPatch";
import { createModuleRegistry } from "./moduleRegistry";

const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "text_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "image", max: 14 } },
  providers: [
    { providerId: "apimart", models: [{ modelId: "z-image-turbo", modes: ["text_to_image"], parameterSchema: {}, capabilities }] },
    { providerId: "kie", models: [{ modelId: "nano-banana-2", modes: ["text_to_image"], parameterSchema: {}, capabilities }] },
    { providerId: "runway", models: [{ modelId: "veo3.1_fast", modes: ["text_to_video"], parameterSchema: {}, capabilities }] },
  ],
}]);

const base = (providerId: string, modelId: string, mode: string, parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "cand-1", revision: 3, moduleId: "generation.single-shot",
  providerId, modelId, mode, prompt: "海边日出", parameters, references: [],
});
const nanoBanana = (parameters: Record<string, unknown>) => base("kie", "nano-banana-2", "text_to_image", parameters);
const revise = (baseCandidate: PlanCandidate, userPatch: Parameters<typeof resolvePlanPatch>[0]["userPatch"]) =>
  resolvePlanPatch({ baseCandidate, userPatch, registry });

describe("改草稿只改被点名的参数", () => {
  it("只改比例：清晰度 4K 留着（以前掉回 1K）；changeset 只列比例那一项", () => {
    const { normalizedPatch, changeset } = revise(nanoBanana({ aspect_ratio: "16:9", resolution: "4K" }), { parameters: { aspectRatio: "9:16" } });
    expect(normalizedPatch.parameters).toEqual({ aspect_ratio: "9:16", resolution: "4K" });
    expect(changeset).toMatchObject({ changedParameters: [{ key: "aspect_ratio", before: "16:9", after: "9:16" }] });
  });

  it("只改清晰度：比例留着", () => {
    const { normalizedPatch, changeset } = revise(nanoBanana({ aspect_ratio: "16:9", resolution: "1K" }), { parameters: { resolution: "4K" } });
    expect(normalizedPatch.parameters).toEqual({ aspect_ratio: "16:9", resolution: "4K" });
    expect(changeset).toMatchObject({ changedParameters: [{ key: "resolution", before: "1K", after: "4K" }] });
  });

  it("null 显式清掉一个键（回到档案默认），changeset 里只有 before", () => {
    const { normalizedPatch, changeset } = revise(nanoBanana({ aspect_ratio: "16:9", resolution: "4K" }), { parameters: { resolution: null } });
    expect(normalizedPatch.parameters).toEqual({ aspect_ratio: "16:9" });
    expect(changeset).toMatchObject({ changedParameters: [{ key: "resolution", before: "4K" }] });
    expect((changeset!.changedParameters as Array<Record<string, unknown>>)[0]).not.toHaveProperty("after");
  });

  it("时长同样合并（durationSec 投影成的 duration 不再把别的参数冲掉）", () => {
    const veo = base("runway", "veo3.1_fast", "text_to_video", { aspect_ratio: "1280:720", duration: 4 });
    expect(revise(veo, { parameters: { duration: 8 } }).normalizedPatch.parameters).toEqual({ aspect_ratio: "1280:720", duration: 8 });
  });

  it("原有的真实比例键不算冲突（改比例本来就是换掉它）；这一次自己写的两处不一样才拒", () => {
    const z = base("apimart", "z-image-turbo", "text_to_image", { size: "1:1", resolution: "2K" });
    expect(revise(z, { parameters: { aspectRatio: "16:9" } }).normalizedPatch.parameters).toEqual({ size: "16:9", resolution: "2K" });
    expect(() => revise(z, { parameters: { aspectRatio: "16:9", size: "1:1" } })).toThrow(/two different ratios/);
  });

  it("像素档改比例留在原来那一档：Veo 原来 1920:1080，改 9:16 → 1080:1920（不掉回默认的 720 档）", () => {
    const veo = base("runway", "veo3.1_fast", "text_to_video", { aspect_ratio: "1920:1080", duration: 8 });
    expect(revise(veo, { parameters: { aspectRatio: "9:16" } }).normalizedPatch.parameters).toEqual({ aspect_ratio: "1080:1920", duration: 8 });
  });

  it("点名的值照旧当场判：越界拒，什么都不落", () => {
    expect(() => revise(nanoBanana({ resolution: "4K" }), { parameters: { resolution: "8K" } })).toThrow(ContractCompilationError);
  });

  it("换模型：原有参数里新模型不认的清掉并上报，认的留着，点名的落新模型的键", () => {
    const z = base("apimart", "z-image-turbo", "text_to_image", { size: "1:1", resolution: "2K" });
    const { normalizedPatch, changeset } = revise(z, { providerId: "kie", modelId: "nano-banana-2", parameters: { aspectRatio: "1:1" } });
    expect(normalizedPatch.parameters).toEqual({ resolution: "2K", aspect_ratio: "1:1" });
    expect(changeset).toMatchObject({ modelChanged: true, clearedParameters: ["size"] });
  });

  it("什么参数都没写：不出 changedParameters，也不重写参数", () => {
    const { normalizedPatch, changeset } = revise(nanoBanana({ aspect_ratio: "16:9" }), { prompt: "夜景" });
    expect(normalizedPatch).not.toHaveProperty("parameters");
    expect(changeset).toBeUndefined();
  });
});

describe("付费卡手改：每次带的是这一镜的完整参数集，合并与替换结果相同（行为不变）", () => {
  it("卡上改一个值（其余照抄）→ 落盘的就是卡发来的那一份", () => {
    // 卡的补丁 = 这一镜全部参数键 ∪ 控件键，没动的取候选原值（`spendCardDraft.candidatePatchFromNode`）。
    const cardPatch = { aspect_ratio: "16:9", resolution: "2K", output_format: "png" };
    const { normalizedPatch } = revise(nanoBanana({ aspect_ratio: "16:9", resolution: "1K", output_format: "png" }), { parameters: cardPatch });
    expect(normalizedPatch.parameters).toEqual(cardPatch);
  });
});

// 设计卡 docs/plan/2026-10-05-storyboard-ratio-and-merge.md §3：参数以外那几格的修订语义（钉住现状与理由）。
describe("参数以外那几格：本来就是「只改点名的」，参考是整列表", () => {
  const ref = (assetId: string) => ({ assetId, contentHash: assetId.repeat(8).slice(0, 64).padEnd(64, "0"), version: 1, kind: "image" as const });

  it("参考素材：点名就是整列表替换（模型面给的是完整列表；RFC 7396 对数组也是整体替换），不点名不动", () => {
    const withRefs = { ...nanoBanana({ aspect_ratio: "16:9" }), references: [ref("a"), ref("b")] };
    expect(revise(withRefs, { references: [ref("c")] }).normalizedPatch.references).toEqual([ref("c")]);
    expect(revise(withRefs, { prompt: "夜景" }).normalizedPatch).not.toHaveProperty("references");
  });

  it("只点名 prompt：模型、模式、变体、参数都不进补丁", () => {
    const { normalizedPatch } = revise(nanoBanana({ aspect_ratio: "16:9" }), { prompt: "夜景" });
    expect(normalizedPatch).not.toHaveProperty("modelId");
    expect(normalizedPatch).not.toHaveProperty("providerId");
    expect(normalizedPatch).not.toHaveProperty("mode");
  });
});
