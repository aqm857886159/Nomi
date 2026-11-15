// 从**一份**档案推出主进程 / 无界面发送要问的几件事（设计卡 docs/plan/2026-11-15-archetype-wire-defaults-runtime.md）。
// 以前这些事是生成脚本从档案算好、再提交进仓库的表（靠机器人 PR 同步，合不进去就落后于档案）；档案在 electron/shared、
// 主进程直接读得到，所以改成用时现算。这里只吃传入的档案对象、不碰档案表；按 id 查找在入口 entry.ts。
// 同一份档案对象只算一次（WeakMap），一次无界面请求只算用到的那一个档案。
import { modeTransportFor } from "../videoCapabilities/modeTransport";
import type { ModelArchetype } from "./types";

/** { taskKind: { "*" | vendorKey: { param: default } } } */
export type ArchetypeHeadlessDefaults = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>;

// 一个 size 控件的选项集里出现任意 "16:9" 这样的比例档 → 判定 size 键是比例语义（而非像素语义）。
const RATIO_OPTION_RE = /^\d+\s*:\s*\d+$/;

function remembered<T>(compute: (archetype: ModelArchetype) => T): (archetype: ModelArchetype) => T {
  const cache = new WeakMap<ModelArchetype, T>();
  return (archetype) => {
    if (cache.has(archetype)) return cache.get(archetype) as T;
    const value = compute(archetype);
    cache.set(archetype, value);
    return value;
  };
}

/**
 * 无界面发送缺参兜底：按 (taskKind, 供应商桶) 取这个档案「主方式」声明的默认值（固定参数 + 控件默认值）。
 *
 * 同一档案同一 taskKind 在不同供应商下参数枚举不同（vendorParams，如 apimart Kling duration=number vs kie=string "5"）
 * → 按供应商分桶，读的时候取 perKind[vendorKey] ?? perKind["*"]。
 *
 * 主方式判据（09-01 修 minimax-h3 text_to_video 被 ref 模式盖住，docs/fixes/2026-09-01-wire-defaults-mode-collapse）：
 * 无界面路拿不到 modeId，所以每个 (供应商桶, taskKind) 确定性地选一个方式——
 *   ① 档案 defaultModeId 落在这个桶 → 用它；② 否则用这个桶首个声明的方式。
 * 桶的键必须带 vendorKey：vendorTransportTaskKind 让同一方式在不同供应商下落不同 taskKind，只按 taskKind 分组两家会互相抢。
 * 一个方式声明的供应商桶 = 通用 "*" + vendorParams 覆盖的 + vendorTransportTaskKind 覆盖的（后者即使参数同通用也单独落桶）。
 * 桶里一个默认值都没有的不落键（读的时候回退到 "*"）。
 */
export const headlessDefaultsOf = remembered((arch: ModelArchetype): ArchetypeHeadlessDefaults => {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  const vendorBucketsFor = (mode: (typeof arch.modes)[number]): string[] => [
    "*",
    ...new Set([...Object.keys(mode.vendorParams ?? {}), ...Object.keys(mode.vendorTransportTaskKind ?? {})]),
  ];
  const primaryModeByBucket = new Map<string, { vendorKey: string; taskKind: string; mode: (typeof arch.modes)[number] }>();
  for (const mode of arch.modes) {
    for (const vendorKey of vendorBucketsFor(mode)) {
      const taskKind = modeTransportFor(mode, arch, vendorKey === "*" ? null : vendorKey);
      if (!taskKind) continue;
      const bucket = `${vendorKey}\0${taskKind}`;
      const current = primaryModeByBucket.get(bucket);
      if (!current) {
        primaryModeByBucket.set(bucket, { vendorKey, taskKind, mode }); // 判据②：首个声明的方式是候选。
        continue;
      }
      if (mode.id === arch.defaultModeId) primaryModeByBucket.set(bucket, { vendorKey, taskKind, mode }); // 判据①抢占。
    }
  }
  for (const { vendorKey, taskKind, mode } of primaryModeByBucket.values()) {
    // 有 vendorParams 覆盖的供应商用自己那组（整组替换，与 specializeArchetypeForVendor 一致），只覆盖了传输的沿用通用组。
    const params = (vendorKey === "*" ? undefined : mode.vendorParams?.[vendorKey]) ?? mode.params ?? [];
    const defaults: Record<string, unknown> = {};
    // 方式级固定 body 常量（如 Veo/Omni 的 generation_type）——无界面也必发，各桶都带。
    for (const [key, value] of Object.entries(mode.fixedParams ?? {})) defaults[key] = value;
    // 可调参数的默认值（duration=number 保类型，避开供应商「string≠int」）。
    for (const control of params) if (typeof control.defaultValue !== "undefined") defaults[control.key] = control.defaultValue;
    if (Object.keys(defaults).length === 0) continue;
    (out[taskKind] ??= {})[vendorKey] = defaults;
  }
  return out;
});

/**
 * 这个档案哪些 taskKind 的 `size` 键是**比例语义**——从控件选项集推，不从默认值字面形状猜
 * （seedance-2.5-apimart 的 size 默认 "adaptive"，选项集里有 16:9 → 比例语义；按默认值猜会把调用方 16:9 剥掉）。
 * 通用 params 与每套 vendorParams 里任一 size 控件是比例语义即算；通用桶与每个 vendorTransportTaskKind 覆盖桶的 taskKind 都登记。
 */
export const sizeRatioTaskKindsOf = remembered((arch: ModelArchetype): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const mode of arch.modes) {
    const paramSets = [mode.params ?? [], ...Object.values(mode.vendorParams ?? {})];
    const ratioSemantic = paramSets.some((params) => (params ?? []).some(
      (control) => control.key === "size" && (control.options ?? []).some((option) => RATIO_OPTION_RE.test(String(option.value).trim())),
    ));
    if (!ratioSemantic) continue;
    for (const vendorKey of [null, ...Object.keys(mode.vendorTransportTaskKind ?? {})]) {
      const taskKind = modeTransportFor(mode, arch, vendorKey);
      if (taskKind) out.add(taskKind);
    }
  }
  return out;
});

/** 主进程认档案用的身份：identifierPatterns + 各档 modelKey（用户接入的可能是 fast/mini 那一支），去空去重保序。 */
export const identityPatternsOf = remembered((arch: ModelArchetype): readonly string[] => {
  const patterns = [...(arch.identifierPatterns ?? [])];
  for (const variant of arch.variants ?? []) if (variant.modelKey) patterns.push(variant.modelKey);
  return [...new Set(patterns.map((pattern) => String(pattern).trim()).filter(Boolean))];
});

/**
 * 主进程 custom-call 脚本派发 / 发布面只要确认「这个 modeId 属不属于这个档案、走哪个 taskKind」。
 * **供应商无关（传 null）是有意的**：那条路上的模型是用户自建的单供应商条目，不带 vendorTransportTaskKind 覆盖。
 */
export const modeManifestOf = remembered((arch: ModelArchetype): Readonly<{ defaultModeId: string; modes: Readonly<Record<string, string>> }> => ({
  defaultModeId: arch.defaultModeId,
  modes: Object.fromEntries(arch.modes.map((mode) => [mode.id, modeTransportFor(mode, arch, null)])),
}));
