/**
 * Pure capability projections shared by UI and request validation.
 *
 * 「这个方式收不收这些输入」只在这里判（概念 generation.mode-params 的 write_api）：参数 ↔ 参数、参数 ↔ 参考槽
 * （`when: { slotEmpty }`）、槽下限、`requiresAnyOf`、参考合计。面板收窄选项和主进程发送前拒收读的是同一组规则。
 */
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelParameterControl } from './types';

type Values = Record<string, unknown>;
export type ReferenceCounts = Partial<Record<ArchetypeReferenceSlotKind, number>>;
/**
 * 主进程发送前数到的输入，带「看不看得清」：
 *   · seen：判定手里的请求体就是真要发的那份。`counts` = 发得出去的件数；`unrouted` = 调用方给了、但这条路的请求体
 *     根本没有这一族素材的位置（发出去一定丢）的件数。
 *   · unseen：请求体不是真要发的那份（自定义脚本接管等），只知道调用方交了多少（下限）。判定见到它不产生任何
 *     「缺 / 不够 / 超」类违例——看不清就不拒，交给上游。
 * 画布 / 预览传的普通 ReferenceCounts 等于 seen 且 unrouted 为空。
 */
export type ModeInputEvidence =
  | { readonly route: 'seen'; readonly counts: ReferenceCounts; readonly unrouted: ReferenceCounts }
  | { readonly route: 'unseen'; readonly counts: ReferenceCounts };
type OptionConstraint = NonNullable<ModelParameterControl['optionConstraints']>[number];
const sameValue = (a: unknown, b: unknown): boolean => String(a) === String(b);

/**
 * 一条约束此刻生不生效。参考槽条件只在调用方给了计数时判：不给计数（不知道连了什么）= 不生效，
 * 免得在看不到输入的地方（Agent 预览、计划里的方式）把选项收窄错。
 */
function ruleActive(rule: OptionConstraint, effective: Values, counts: ReferenceCounts | undefined): boolean {
  if ('slotEmpty' in rule.when) return counts !== undefined && (counts[rule.when.slotEmpty] ?? 0) === 0;
  return sameValue(effective[rule.when.key], rule.when.value);
}

export function constrainParameterControls(controls: ModelParameterControl[], values: Values, counts?: ReferenceCounts): ModelParameterControl[] {
  const effective = Object.fromEntries(controls.map(control => [control.key, values[control.key] ?? control.defaultValue]));
  return controls.map(control => {
    const active = control.optionConstraints?.filter(rule => ruleActive(rule, effective, counts));
    if (!active?.length) return control;
    const options = control.options.filter(option => active.every(rule => rule.values.some(value => sameValue(value, option.value))));
    const defaultValue = options.find(option => sameValue(option.value, control.defaultValue))?.value ?? options[0]?.value;
    return { ...control, options, defaultValue };
  });
}

/** Only conditional selections are corrected; ordinary parameter semantics remain with their owner. */
export function normalizeConditionalParameters(controls: ModelParameterControl[], values: Values, counts?: ReferenceCounts): Values {
  let next = values;
  for (const control of constrainParameterControls(controls, values, counts)) {
    if (!control.optionConstraints?.length) continue;
    const value = values[control.key] ?? control.defaultValue;
    if (control.options.some(option => sameValue(option.value, value))) continue;
    next = { ...next, [control.key]: control.defaultValue };
  }
  return next;
}

export function remainingReferenceCapacity(mode: ArchetypeMode, counts: ReferenceCounts): number {
  if (mode.maxTotalReferences === undefined) return Infinity;
  return Math.max(0, mode.maxTotalReferences - mode.slots.reduce((sum, slot) => sum + (counts[slot.kind] ?? 0), 0));
}

/** 请求参数里某个槽键带了几件参考（数组按项数、非空字符串 / 对象算一件）。 */
export function referenceValueCount(value: unknown): number {
  if (Array.isArray(value)) return value.filter(item => (typeof item === 'string' ? item.trim() !== '' : item !== null && item !== undefined)).length;
  if (typeof value === 'string') return value.trim() ? 1 : 0;
  return value !== null && typeof value === 'object' ? 1 : 0;
}

/** 只按槽的 inputKey 数（没给 counts 时的读法；调用方有降级后的逐槽计数就传 counts）。 */
function countsFromInputKeys(mode: ArchetypeMode, values: Values): ReferenceCounts {
  const counts: ReferenceCounts = {};
  for (const slot of mode.slots) {
    const count = slot.inputKey ? referenceValueCount(values[slot.inputKey]) : 0;
    counts[slot.kind] = (counts[slot.kind] ?? 0) + count;
  }
  return counts;
}

export type ModeConstraintViolation =
  | { kind: 'parameter'; key: string }
  | { kind: 'references'; max: number }
  | { kind: 'slotMissing'; slot: ArchetypeReferenceSlotKind }
  /** 素材给了，但这条路没有这个方式要的那一族素材的位置（渠道走不了这个方式）。 */
  | { kind: 'slotUnrouted'; slot: ArchetypeReferenceSlotKind }
  | { kind: 'companionMissing'; slot: ArchetypeReferenceSlotKind; companions: ArchetypeReferenceSlotKind[] }
  | { kind: 'optionNeedsSlot'; key: string; value: string | number | boolean; slot: ArchetypeReferenceSlotKind };

/**
 * 这个方式收不收这一次的参数和输入。顺序：缺必需输入 → 依赖的槽没有 → 选项要的槽没有 → 参数组合 → 参考合计。
 * `counts` 给了就按它判槽（主进程传带「看不看得清」的 ModeInputEvidence）；不给就按槽的 inputKey 从 values 里数。
 * 看不清（unseen）时只判参数组合：其余几条都要「确知发出去的请求里有几件」才判得了。
 */
export function validateModeConstraints(
  mode: ArchetypeMode,
  values: Values,
  input: ReferenceCounts | ModeInputEvidence = countsFromInputKeys(mode, values),
): ModeConstraintViolation | null {
  const evidence: ModeInputEvidence = 'route' in input && (input.route === 'seen' || input.route === 'unseen')
    ? input as ModeInputEvidence
    : { route: 'seen', counts: input as ReferenceCounts, unrouted: {} };
  const counts = evidence.counts;
  const filled = (kind: ArchetypeReferenceSlotKind): boolean => (counts[kind] ?? 0) > 0;
  if (evidence.route === 'seen') {
    for (const slot of mode.slots) {
      if (slot.min < 1 || (counts[slot.kind] ?? 0) >= 1) continue;
      return (evidence.unrouted[slot.kind] ?? 0) >= 1 ? { kind: 'slotUnrouted', slot: slot.kind } : { kind: 'slotMissing', slot: slot.kind };
    }
    for (const slot of mode.slots) {
      if (slot.requiresAnyOf?.length && filled(slot.kind) && !slot.requiresAnyOf.some(filled)) {
        return { kind: 'companionMissing', slot: slot.kind, companions: [...slot.requiresAnyOf] };
      }
    }
    for (const control of mode.params) {
      for (const rule of control.optionConstraints ?? []) {
        if (!('slotEmpty' in rule.when) || filled(rule.when.slotEmpty)) continue;
        const value = values[control.key] ?? control.defaultValue;
        if (value === undefined || rule.values.some(allowed => sameValue(allowed, value))) continue;
        return { kind: 'optionNeedsSlot', key: control.key, value: value as string | number | boolean, slot: rule.when.slotEmpty };
      }
    }
  }
  for (const control of constrainParameterControls(mode.params, values)) {
    if (!control.optionConstraints?.length) continue;
    const value = values[control.key] ?? control.defaultValue;
    if (!control.options.some(option => sameValue(option.value, value))) return { kind: 'parameter', key: control.key };
  }
  if (evidence.route === 'seen' && mode.maxTotalReferences !== undefined) {
    const total = mode.slots.reduce((sum, slot) => sum + (counts[slot.kind] ?? 0), 0);
    if (total > mode.maxTotalReferences) return { kind: 'references', max: mode.maxTotalReferences };
  }
  return null;
}
