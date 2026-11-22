// 「模型 / 连接现在显示成什么」的**唯一**家（D-1117-delete-verification，协调 2026-11-18 批）。
//
// 根因（docs/engineering/direction-checks/2026-11-17-availability-r2.md）：「能不能用」早就只有一个主人
// （./modelAvailability.ts），可「怎么说」散在 13 个出口里各挑各的词、各配各的色——列表写「可使用」、
// 内置详情写「已保存 · 未验证」、自接详情又按任务状态写「N 个待设置」，同一个模型三句话。
// 这里把「怎么说」收回一处：输入只有主人的结论 + 「格式任务正在跑」这一个布尔，输出只有档位、词条键、点色。
//
// 只有五档，每一档都是本机事实，没有「验证」这回事：
//   可使用（绿）· 配置中（格式任务在跑、还不能用）· 待设置（缺东西，补上就能用）· 已关闭 · 待接入（没 key）。
// 纯函数、不碰 i18n 运行时：放共享层，主进程和渲染层读同一张表，不会再长出第二份。
// 渲染只走 `src/ui/onboarding/ModelStatusMark.tsx`；出口里写这里的词条键会被 ESLint 规则拦下。
import type { ModelAvailability } from "./modelAvailability";

export const MODEL_STATUS_STATES = ["ready", "configuring", "needsSetup", "disabled", "notConnected"] as const;
export type ModelStatusState = (typeof MODEL_STATUS_STATES)[number];

/** 点色只有四种，和设计系统的语义色一一对应。 */
export type ModelStatusTone = "success" | "active" | "warning" | "neutral";

export type ModelStatusLabelKey = `onboardingProviders.modelStatus.${ModelStatusState}`;
export type ConnectionStatusLabelKey = `onboardingProviders.modelStatus.count.${Exclude<ModelStatusState, "notConnected">}`;

export type ModelStatusPresentation = {
  state: ModelStatusState;
  tone: ModelStatusTone;
  labelKey: ModelStatusLabelKey;
};

export type ConnectionStatusPresentation = {
  state: ModelStatusState;
  tone: ModelStatusTone;
  /** 「待接入」不带数（Q1）；其余连接级都是「N 个 X」。 */
  labelKey: ModelStatusLabelKey | ConnectionStatusLabelKey;
  count?: number;
};

const TONE: Record<ModelStatusState, ModelStatusTone> = {
  ready: "success",
  configuring: "active",
  needsSetup: "warning",
  disabled: "neutral",
  notConnected: "neutral",
};

export type ModelStatusInput = {
  availability: ModelAvailability | null | undefined;
  /** 这个模型的格式任务正在跑（主进程从任务生命周期算出，渲染层拿不到任务状态本身）。 */
  formatInProgress?: boolean;
};

function stateOf(input: ModelStatusInput): ModelStatusState {
  const availability = input.availability;
  // 能选就是绿，哪怕后台还有格式任务在跑——「能不能选」和「显示成什么」不许是两个答案。
  if (availability?.usable) return "ready";
  if (input.formatInProgress) return "configuring";
  // 形状不认（旧缓存 / 损坏行）按「缺东西」说，不默默当可用。
  if (!availability) return "needsSetup";
  if (availability.reason === "credential_missing") return "notConnected";
  if (availability.reason === "model_disabled" || availability.reason === "vendor_disabled") return "disabled";
  return "needsSetup";
}

/** 模型级：一行模型显示成什么。不带数。 */
export function presentModelStatus(input: ModelStatusInput): ModelStatusPresentation {
  const state = stateOf(input);
  return { state, tone: TONE[state], labelKey: `onboardingProviders.modelStatus.${state}` };
}

/** 「N 个 X」：连接级折叠和设置首页页头计数共用这一种带数的写法。 */
export function presentStatusCount(
  state: Exclude<ModelStatusState, "notConnected">,
  count: number,
): ConnectionStatusPresentation {
  return { state, tone: TONE[state], labelKey: `onboardingProviders.modelStatus.count.${state}`, count };
}

/**
 * 连接级折叠（Q2，协调 2026-11-18）：
 * 没 key → 待接入；全部已关闭 → N 个已关闭；有可使用 → N 个可使用（哪怕还有在编、缺格式的）；
 * 没有可使用、有在编 → N 个配置中；否则 → N 个待设置（一个模型都还没选的连接也落这一档：「0 个待设置」）。
 *
 * 「没 key」是这家的事实，不是哪个模型的：调用方给得出就给（`keyMissing`）；给不出时，
 * 任何一行被主人判成 credential_missing 也足以说明这家没 key（钥匙按家存，不按模型存）。
 */
export function presentConnectionStatus(input: {
  keyMissing?: boolean;
  models: readonly ModelStatusInput[];
}): ConnectionStatusPresentation {
  const states = input.models.map(stateOf);
  const keyMissing = input.keyMissing === true
    || input.models.some((model) => model.availability?.usable === false && model.availability.reason === "credential_missing");
  if (keyMissing) return { state: "notConnected", tone: TONE.notConnected, labelKey: "onboardingProviders.modelStatus.notConnected" };
  const count = (state: ModelStatusState) => states.filter((value) => value === state).length;
  if (states.length > 0 && states.every((state) => state === "disabled")) return presentStatusCount("disabled", states.length);
  if (count("ready") > 0) return presentStatusCount("ready", count("ready"));
  if (count("configuring") > 0) return presentStatusCount("configuring", count("configuring"));
  return presentStatusCount("needsSetup", count("needsSetup"));
}
