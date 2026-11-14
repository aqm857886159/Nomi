/**
 * 发送前拒收的原话（taskParams.applyHeadlessParamDefaults 第 ④ 步判出违例后，在这里拼给人看的话）。
 * 判定本身只在 crossFieldConstraints.validateModeConstraints；这里只管「怎么说」：按槽名说缺什么，并点名现有输入能用的方式。
 */
import { desktopT } from "../desktopStrings";
import type { DefiniteSendRefusal } from "../shared/generationDefiniteSendRefusal";
import { modeForInputs, type ModeInput } from "../shared/modelArchetypes/modeForInputs";
import { SLOT_ACCEPTS } from "../shared/modelArchetypes/anchorPolicy";
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from "../shared/modelArchetypes/types";
import type { ModeConstraintViolation, ReferenceCounts } from "../shared/videoCapabilities/crossFieldConstraints";

/** 发送前拒收：方式要的输入请求里没有。`code` 供机读（尺子、Agent 回执）；原话给人看。 */
export class ModeInputMissingError extends Error implements DefiniteSendRefusal {
  readonly code = "mode_input_missing";
  readonly definiteSendRefusal = true as const;
}

/** 发送前拒收：素材给了，但当前这家的请求里没有这个方式要的那一族素材的位置（发出去一定丢素材）。 */
export class ModeRouteMissingError extends Error implements DefiniteSendRefusal {
  readonly code = "mode_route_missing";
  readonly definiteSendRefusal = true as const;
}

function slotName(mode: ArchetypeMode, kind: ArchetypeReferenceSlotKind): string {
  const label = mode.slots.find((slot) => slot.kind === kind)?.label ?? "";
  // 英文轨按槽的种类说；编辑 / 续写方式里的视频是被改的那段「源视频」，不是参考视频（中文轨用档案的槽名，本来就写着源视频）。
  const spoken: ArchetypeReferenceSlotKind | "source_video" = kind === "video_ref" && mode.intent === "edit" ? "source_video" : kind;
  return desktopT("modeInput.slotName", { label, kind: desktopT(`modeInput.slotKind.${spoken}`) });
}

/**
 * 拒收后的出路：这次请求里的输入，同一个模型按「按输入现算方式」（modeForInputs，唯一 owner）能整份收下的那个方式。
 * 只在算出一个别的方式、且它收得下全部输入时点名；算不出就不说（拒收句前半句照旧）。
 */
function modeThatFitsInputs(archetype: ModelArchetype, current: ArchetypeMode, counts: ReferenceCounts): string {
  const inputs: ModeInput[] = [];
  for (const [kind, count] of Object.entries(counts) as Array<[ArchetypeReferenceSlotKind, number]>) {
    // 一件输入先认它在这次请求里的槽，再认同种素材能落的别的槽（同画布上传图的落法：图可以当首帧也可以当参考图）。
    const asset = SLOT_ACCEPTS[kind][0]!;
    const slots = [kind, ...(Object.keys(SLOT_ACCEPTS) as ArchetypeReferenceSlotKind[]).filter((other) => other !== kind && SLOT_ACCEPTS[other].includes(asset))];
    for (let index = 0; index < count; index += 1) inputs.push({ slots, asset });
  }
  if (!inputs.length) return "";
  const fit = modeForInputs(archetype, inputs, null);
  if (fit.status !== "ok" || fit.taken !== inputs.length || fit.mode.id === current.id) return "";
  return desktopT("modeInput.fitsMode", { mode: fit.mode.vendorTerm, modeId: fit.mode.id });
}

/** 违例 → 拒收错误（缺输入类是确定拒收，带 code；参数组合 / 参考合计沿用原来的普通错误）。 */
export function modeInputRefusal(archetype: ModelArchetype, mode: ArchetypeMode, counts: ReferenceCounts, violation: ModeConstraintViolation): Error {
  const refuse = (message: string): Error => new ModeInputMissingError(`${message}${modeThatFitsInputs(archetype, mode, counts)}`);
  switch (violation.kind) {
    case "slotUnrouted":
      return new ModeRouteMissingError(`${desktopT("modeInput.routeMissing", { mode: mode.vendorTerm, slot: slotName(mode, violation.slot) })}${modeThatFitsInputs(archetype, mode, counts)}`);
    case "slotMissing":
      return refuse(desktopT("modeInput.slotMissing", { slot: slotName(mode, violation.slot) }));
    case "companionMissing":
      return refuse(desktopT("modeInput.companionMissing", {
        slot: slotName(mode, violation.slot),
        companions: violation.companions.map((kind) => slotName(mode, kind)).join(desktopT("modeInput.or")),
      }));
    case "optionNeedsSlot": {
      const control = mode.params.find((candidate) => candidate.key === violation.key);
      const option = control?.options.find((candidate) => String(candidate.value) === String(violation.value));
      return refuse(desktopT("modeInput.optionNeedsSlot", {
        parameter: violation.key, parameterLabel: control?.label ?? violation.key,
        value: String(violation.value), valueLabel: option?.label ?? String(violation.value),
        slot: slotName(mode, violation.slot),
      }));
    }
    case "parameter":
      return new Error(desktopT("modelConstraints.parameterCombination", { parameter: violation.key }));
    case "references":
      return new Error(desktopT("modelConstraints.referenceTotal", { max: violation.max }));
  }
}
