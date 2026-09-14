// 常驻生成面（Agent lane 的生成适配器 + 面板付费确认卡）在本会话里「装没装起来」的**唯一**词表。
//
// 为什么它住在 shared/contracts：主进程写它、渲染层和 Agent 读它。三方必须用同一组词，
// 否则「按配置没装」「还在起」「装配抛了」又会各自塌成一个 null / 一句「不可用」。
// 值的真相源在 `electron/capabilityCore/residentSurfaceLifecycle.ts`（唯一 owner）。

/** 本会话按配置不装：来自 env，或低内存模式。不是失败。 */
export type ResidentSurfaceDisabledReason = "env" | "low-memory";

/** 面不在、但**不是失败**的三种相：按配置关掉 / 能力核还在起 / 已停（退出或重启中）。 */
export type ResidentSurfaceOffPhase = "disabled" | "starting" | "stopped";
