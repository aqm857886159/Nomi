// 常驻生成面「装没装起来、没装是为什么」的**唯一** owner（2026-09-14）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 2026-09-12 起，Canvas Performance 门岗上的每一条画布 PR（#763、#776）都红在同一句
// `console error: [missing-intervention-card] spend-confirm spend-surface-unavailable`——
// 而 15 个 gating 场景的预算全过。真相：那条 benchmark 用 `NOMI_DISABLE_CAPABILITY_CORE=1`
// **按配置**不起能力核（隔离实例不该起本地 RPC，也不该碰用户的 ~/.codex 配置），于是
// `installPendingSpendActions` 从没被调用；读通道只认得一个 null，把「没起过」当成
// 「装配抛了」抛了出去；渲染层照规矩渲那张会说话的卡 + 一条 console error，每 1.5s 一次。
// 主进程日志里连一行 ERROR 都没有——根本没有异常，只有一个被三处各自解释的 null。
//
// ── 类根因 ──
//
// 「这条面在本会话里装没装」这份状态此前有三份影子：`main.ts` 的 `desktopGenerationAdapterFactory`
// （给 Agent lane）、`appIntegrationSpendConfirm.ts` 的 `actions` 与 `installFailure`（给付费卡）。
// 三份都是 nullable，都把「按配置关掉 / 还在起 / 装配抛了 / 已停」塌成同一个 undefined。
// 2026-09-12 在读侧把 null 改成「抛」（对失败对了，对关掉错了）；2026-09-13 在渲染层把那个错
// 吞回去（对关掉对了，对失败错了，而且没接上线）。两端各修一次都不对：都不是 owner。
//
// 这个模块就是 owner：五种相各是各的，主进程写、lane 与渲染层读同一份。
import type { ResidentGenerationAdapterFactory } from "./residentGenerationAdapterFactory";
import type { ResidentSurfaceDisabledReason } from "../shared/contracts/residentSurfaceLifecycle";

export type ResidentSurfaceLifecycle =
  /** 本会话按配置不装（env / 低内存）。不是失败：这种相下没有任何一面能 announce 一笔待确认。 */
  | Readonly<{ phase: "disabled"; reason: ResidentSurfaceDisabledReason }>
  /** 能力核在起，还没装到这一步。窗口先于能力核出现，所以渲染层的头几次轮询会落在这里。 */
  | Readonly<{ phase: "starting" }>
  /** 装好了：这就是 lane 拿生成适配器工厂的**唯一**出处。 */
  | Readonly<{ phase: "ready"; factory: ResidentGenerationAdapterFactory["factory"] }>
  /** 装配抛了。这才是要一路传到用户眼前、在 CI 里必须红的那种。 */
  | Readonly<{ phase: "install-failed"; reason: string }>
  /** 已撤下（退出，或能力核重启中）。 */
  | Readonly<{ phase: "stopped" }>;

let current: ResidentSurfaceLifecycle = { phase: "starting" };

/**
 * 启动时调一次，**替代** `main.ts` 里自己算 `capabilityCoreDisabled`：判断与记录是同一件事，
 * 否则「main 决定不起、这里却停在 starting」就是又一个说不出口的相。
 */
export function bootResidentSurfaceLifecycle(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  lowMemoryMode: boolean;
}>): ResidentSurfaceLifecycle {
  if (input.env.NOMI_DISABLE_CAPABILITY_CORE === "1") current = { phase: "disabled", reason: "env" };
  else if (input.lowMemoryMode && input.env.NOMI_KEEP_CAPABILITY_CORE !== "1") current = { phase: "disabled", reason: "low-memory" };
  else current = { phase: "starting" };
  return current;
}

export function markResidentSurfaceStarting(): void {
  current = { phase: "starting" };
}

export function markResidentSurfaceReady(factory: ResidentGenerationAdapterFactory["factory"]): void {
  current = { phase: "ready", factory };
}

export function markResidentSurfaceInstallFailed(reason: unknown): void {
  current = { phase: "install-failed", reason: reason instanceof Error ? reason.message : String(reason) };
}

export function markResidentSurfaceStopped(): void {
  current = { phase: "stopped" };
}

export function readResidentSurfaceLifecycle(): ResidentSurfaceLifecycle {
  return current;
}

/** lane 的生成适配器工厂。不是 ready 就是 undefined——但「为什么是 undefined」由上面那份相回答。 */
export function residentGenerationFactory(): ResidentGenerationAdapterFactory["factory"] | undefined {
  return current.phase === "ready" ? current.factory : undefined;
}

/**
 * 给模型（经 lane 工具结果）看的那句话。此前它只有一个 code `generation_surface_unavailable`，
 * 模型只能对用户说「生成服务暂时不可用」——它分不出是自己等一会儿就好、还是这个会话根本没这条面。
 */
export function residentGenerationUnavailableMessage(): string {
  switch (current.phase) {
    case "disabled":
      return current.reason === "env"
        ? "Nomi's resident generation surface is disabled in this session (NOMI_DISABLE_CAPABILITY_CORE=1); paid generation cannot be planned or started here."
        : "Nomi's resident generation surface is disabled in low-memory mode; paid generation cannot be planned or started here.";
    case "starting":
      return "Nomi's resident generation surface is still starting; retry this step in a moment.";
    case "stopped":
      return "Nomi's resident generation surface has been stopped (Nomi is quitting or restarting its capability core).";
    case "install-failed":
      return `Nomi's resident generation surface failed to install: ${current.reason}. Paid generation is unavailable until Nomi restarts.`;
    case "ready":
      return "Nomi's resident generation surface is ready but produced no adapter for this project binding.";
  }
}
