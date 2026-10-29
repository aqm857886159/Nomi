// 拆解「读图腿」用哪个模型——唯一的解析点（与转写腿 `resolveTranscribeLeg` 同形：显式身份 + 软偏好 + 自动）。
//
// 2026-10-11 用户走查第 1 条：读图腿原来只有「自动挑目录序第一个能读图的」一条路——用户只连了一家免费限流的就必中它，
// 逐镜撞 429，既换不了模型也看不到原话。三种来源，按优先级：
//   · requested（显式）：用户在分镜表底栏选的。**解不出、或它声明不能读图，就整次拒绝**，绝不悄悄回落到别家——
//     「我选了 A，它偷偷用了 B 并扣了 B 的钱」是这条路上最糟的失败（同转写腿的规矩）。
//   · preferred（软偏好）：渲染层带来的「用户在 Agent 面板里选的脑」。**只要它此刻可用、又不是「不能读图」就采用**，
//     否则当没给——软偏好从不报错、也不拦路。
//   · 都没有：自动挑（`resolveTextBrainKeys({preferImageInput})`）；挑出的第一名都是「不能」= 没有读图模型。
// 能不能读图的判据是现成的三态 `modelImageInputSupport`（能 / 不能 / 不知道，只认声明），三条来源用同一个、
// 都只拒「不能」——「不知道」交给真后端（2026-10-27：此前显式点名不核能力，点了纯文本模型照样报价、逐镜调用）。
// 可用性是现成的 `findExecutableModel`；这里不另写第二份。
import { findExecutableModel } from "../catalog/executableModel";
import { modelImageInputSupport, type ImageInputSupport } from "../ai/agentUserContent";
import { resolveTextBrainKeys } from "../ai/textBrainResolver";

export type VisionLegIdentity = { vendorKey: string; modelKey: string };

export type VisionLegResolution =
  | { ok: true; vendor: string; modelKey: string }
  | { ok: false; reason: "requested-unavailable"; requested: VisionLegIdentity; detail: string }
  | { ok: false; reason: "no-vision-model" };

/** payload 来自 IPC（未经 schema）：不是两段非空字符串就当没给。 */
function cleanIdentity(value: unknown): VisionLegIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { vendorKey, modelKey } = value as { vendorKey?: unknown; modelKey?: unknown };
  return typeof vendorKey === "string" && vendorKey.trim() && typeof modelKey === "string" && modelKey.trim()
    ? { vendorKey: vendorKey.trim(), modelKey: modelKey.trim() }
    : undefined;
}

/** 解出一行此刻可执行的 text 模型，带上它的读图三态；用不了就照 `findExecutableModel` 原样抛。 */
function executableTextModel(identity: VisionLegIdentity): { vendor: string; modelKey: string; imageInput: ImageInputSupport } {
  const { vendor, model } = findExecutableModel(identity.vendorKey, identity.modelKey, "text");
  return { vendor: vendor.key, modelKey: model.modelKey, imageInput: modelImageInputSupport(model) };
}

export function resolveVisionLeg(raw: { requested?: unknown; preferred?: unknown }): VisionLegResolution {
  const input = { requested: cleanIdentity(raw.requested), preferred: cleanIdentity(raw.preferred) };
  if (input.requested) {
    try {
      const leg = executableTextModel(input.requested);
      if (leg.imageInput === "unsupported") {
        // 与「解不出」同一条路、同一句话（deconstruct.visionModelUnavailable）：开拆前拒，零报价、零调用。
        return { ok: false, reason: "requested-unavailable", requested: input.requested, detail: `Model does not accept image input: ${leg.modelKey}` };
      }
      return { ok: true, vendor: leg.vendor, modelKey: leg.modelKey };
    } catch (error) {
      return { ok: false, reason: "requested-unavailable", requested: input.requested, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  if (input.preferred) {
    try {
      const leg = executableTextModel(input.preferred);
      if (leg.imageInput !== "unsupported") return { ok: true, vendor: leg.vendor, modelKey: leg.modelKey };
    } catch {
      /* 软偏好用不了：当没给，走自动 */
    }
  }
  const brain = resolveTextBrainKeys({ preferImageInput: true });
  if (!brain) return { ok: false, reason: "no-vision-model" };
  // 带图选型把「不能」排在最后：第一名就是「不能」，目录里就没有能（或可能能）读图的文本模型。
  // 这一行此刻解不出来的话，紧接着的报价一样解不出（deconstructVideo 用同一个 findExecutableModel），异常原样上抛。
  const auto = executableTextModel({ vendorKey: brain.vendor, modelKey: brain.modelKey });
  return auto.imageInput === "unsupported" ? { ok: false, reason: "no-vision-model" } : { ok: true, vendor: auto.vendor, modelKey: auto.modelKey };
}
