// 付费边界：**只在这里表达一次**（方案 §3.1 第二行、母方案 §1.3）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 花钱的那一刀今天写在三个互不认识的地方：
//   ① 注册表里 `generation.gate` 是唯一 `effect:"paid"` 的契约（`generation.ts`）；
//   ② 内部面曾靠 harness 清单里一张**手写**的三行名单把它挡在模型看不见的地方（PR A 删除了那份清单，
//      现在由动词声明的装配期不变量 A1 直接抛）；
//   ③ 对外 MCP 的 `nomi_operation_gate` / `nomi_operation_execute` **根本不是注册表契约**，
//      是 `mcpGenerationToolCatalog.ts` 里两份手写 JSON Schema。
//
// 三份的后果不是难看：加第二个花钱的能力时，②要有人记得加一行，③要有人记得再抄一份，
// 而**漏掉任何一处都不会报错**——只会在某个真实用户的账单上出现。所以边界收成一处：
// 契约上的 `effect:"paid"`，其余全部 derive。
//
// ── 两个面，同一处派生 ──
//
//   · **内部面「不投影」**——付费能力的别名不进 Agent lane 的工具表。模型看不见它，
//     也就不可能自己发起一次付费调用；付费只从宿主/UI 那一侧发起。
//   · **外部面「够得着但永远批不动」**——MCP 宿主看得见这两个工具（它们是宿主自己的
//     确认流程要走的门），但它们**独立于任何审批档位**永不自动放行：`destructiveHint`
//     由 `effectClass:"spend"` 派生（`mcpAnnotationsFor`），审批闸按同一张名单 fail-closed。
//
// 两句话的判据是同一个函数（`isPaidBoundaryAlias`）。一个新的付费能力只要在契约上写
// `effect:"paid"`，两个面立刻同时生效——不需要任何人记得去改第二个地方。
import { CAPABILITY_CONTRACTS, capabilityAliasesFor, capabilityOperationAliasesFor } from "./registry";
import { mcpAnnotationsFor } from "./modelFacingTools";
import type { CapabilityContract, CapabilityProjectionSurface } from "./capabilityContract";

type AnyCapabilityContract = CapabilityContract<unknown, unknown>;

/** 花钱的契约。**唯一判据**：契约自己声明的 `effect:"paid"`。 */
export const PAID_CAPABILITY_CONTRACTS: readonly AnyCapabilityContract[] = Object.freeze(
  CAPABILITY_CONTRACTS.filter((contract) => contract.effect === "paid"),
);

function aliasesOf(contract: AnyCapabilityContract, surface: CapabilityProjectionSurface): readonly string[] {
  return [...capabilityAliasesFor(contract.id, surface), ...capabilityOperationAliasesFor(contract.id, surface)];
}

/**
 * 付费边界上的全部别名，按 surface 分。
 *
 * 名单是**算出来的**，不是抄的：契约声明了别名，这里只是把它们收齐。
 */
export function paidBoundaryAliases(surface: CapabilityProjectionSurface): readonly string[] {
  return Object.freeze(PAID_CAPABILITY_CONTRACTS.flatMap((contract) => aliasesOf(contract, surface)));
}

const PAID_ALIASES: ReadonlySet<string> = new Set(
  PAID_CAPABILITY_CONTRACTS.flatMap((contract) =>
    (["pi", "mcp", "ui", "method"] as const).flatMap((surface) => aliasesOf(contract, surface))),
);

/**
 * 这个工具名在付费边界上吗？
 *
 * 内部面用它决定「不投影」，外部面用它决定「永不自动放行」——**同一个问题问同一个函数**，
 * 这正是「边界只表达一次」在代码里的形状。
 */
export function isPaidBoundaryAlias(toolName: string): boolean {
  return PAID_ALIASES.has(toolName);
}

/**
 * 为什么这一个别名不能由模型自己发起 / 由策略自动放行。
 *
 * 语义与原来 `GENERATION_HOST_ONLY_TRANSITIONS` 手写的三行**逐字保留**（它们是对的），
 * 变的只是来源：名字从契约派生，理由按 surface 语义派生，两者都不再手抄。
 */
export function paidBoundaryReason(toolName: string): string | undefined {
  if (!isPaidBoundaryAlias(toolName)) return undefined;
  return "Spending the user's provider credit is never model-initiated: the Host builds the confirmation card, "
    + "and only a verified Host/UI receipt can settle it. No approval mode auto-approves this.";
}

/**
 * 内部（Agent lane）profile 投影它吗？付费能力一律不投影——模型面根本够不着。
 *
 * 阶段 5a 这条是**静默过滤**（审计 C12：一个漏标 `paid` 的花钱契约会静默进内部面）；从 PR A 起
 * 注册表把它当**断言**用（`modelFacingToolRegistry.ts`）：一条声明投影到内部 profile 却落在付费契约上，
 * 装配期当场抛，而不是安静地少一个工具。
 */
export function projectsToInternalProfile(contract: AnyCapabilityContract): boolean {
  return contract.effect !== "paid";
}

/** 宿主/UI 独占的转换。名字派生自契约，理由派生自边界，登记表不再是第二份名单。 */
export interface HostOnlyTransition {
  readonly name: string;
  readonly capabilityRefs: readonly string[];
  readonly reason: string;
}

export function hostOnlyTransitions(): readonly HostOnlyTransition[] {
  return Object.freeze(PAID_CAPABILITY_CONTRACTS.flatMap((contract) =>
    aliasesOf(contract, "method").map((name) => Object.freeze({
      name,
      capabilityRefs: Object.freeze([contract.id]),
      reason: paidBoundaryReason(name) ?? "",
    }))));
}

// ── 对外面：够得着，但永远批不动 ─────────────────────────────────────────────

/**
 * 付费工具在对外 `tools/list` 上的注解。**派生**自契约的 `effectClass:"spend"`
 * （`mcpAnnotationsFor`），与内部面用的是同一个判据。
 *
 * 阶段 5a 之前这两个工具**一个注解都没带**——不是标错，是漏标，而漏标没有任何东西会报错。
 * 后果具体：Codex 一类宿主用 `destructiveHint` 决定要不要停下来问用户，缺了它，一次
 * 花用户钱的调用在宿主眼里和一次读一样普通。
 */
export function paidBoundaryAnnotations(): { readonly destructiveHint: true } {
  const annotations = mcpAnnotationsFor(PAID_CAPABILITY_CONTRACTS[0]!);
  if (!annotations?.destructiveHint) {
    throw new Error("A paid capability must derive destructiveHint; check effectClass on the contract.");
  }
  return Object.freeze({ destructiveHint: true as const });
}

/** 一个对外工具声明它把哪些内部方法名路由出去。 */
export interface PaidBoundaryExternalTool {
  readonly name: string;
  /** 这个工具能路由到的全部内部方法名（含按 phase/action 分支的那些）。 */
  readonly routedMethods: readonly string[];
  readonly annotations?: { readonly readOnlyHint?: true; readonly destructiveHint?: true };
}

/**
 * 装配期不变量：**付费边界上的每个别名都必须被某个声明了 `destructiveHint` 的对外工具认领。**
 *
 * 这是本文件那句「漏掉任何一处都不会报错」的正面答案。今天加第二个 `effect:"paid"` 契约时：
 *   · 内部面自动挡住（`projectsToInternalProfile`，无需任何人记得）；
 *   · 对外面**没有**工具认领它的别名 → 这里当场抛 → App 起不来（R28：防线建在最早能拦住的那层）。
 *
 * 反过来也拦：一个路由到付费别名的对外工具如果没带 `destructiveHint`，同样当场抛——
 * 那正是阶段 5a 之前 `nomi_operation_gate` / `nomi_operation_execute` 的状态。
 */
export function assertPaidBoundaryExternalSurface(tools: readonly PaidBoundaryExternalTool[]): void {
  const claimed = new Set<string>();
  for (const tool of tools) {
    const paidMethods = tool.routedMethods.filter((method) => isPaidBoundaryAlias(method));
    if (paidMethods.length === 0) continue;
    if (!tool.annotations?.destructiveHint) {
      throw new Error(
        `MCP tool "${tool.name}" routes to the paid boundary (${paidMethods.join(", ")}) without destructiveHint. `
        + "Derive its annotations from paidBoundaryAnnotations() instead of writing them by hand.",
      );
    }
    for (const method of paidMethods) claimed.add(method);
  }
  const unclaimed = paidBoundaryAliases("method").filter((alias) => !claimed.has(alias));
  if (unclaimed.length > 0) {
    throw new Error(
      `The paid boundary has aliases no external tool claims: ${unclaimed.join(", ")}. `
      + "A capability declared effect:\"paid\" must either be claimed by an MCP tool that carries destructiveHint, "
      + "or lose its mcp aliases — silently unreachable spend is how a second paid capability ships half-wired.",
    );
  }
}
