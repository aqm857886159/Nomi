import type { ZodType } from "zod";

export type CapabilityEffect = "read" | "reversible_write" | "destructive" | "paid";
/**
 * The Host approval boundary only needs the side-effect class.  Tool names and
 * operation strings are projections; this closed vocabulary is the authority
 * used to decide whether a user decision may be reused.
 */
export const CAPABILITY_EFFECT_CLASSES = ["reversible_local", "spend", "irreversible"] as const;
export type CapabilityEffectClass = (typeof CAPABILITY_EFFECT_CLASSES)[number];
export type CapabilityExposure = "internal_only" | "mcp_safe" | "legacy_unverified";
export type CapabilityPortKind = "document" | "canvas" | "timeline" | "production-run" | "asset" | "export" | "skills";
export type CapabilityAvailability = "main_only" | "renderer_required" | "main_or_renderer";
/**
 * 别名的四个 surface：
 *   · `pi`     模型可见的内部工具名——**必须**是一条已声明的动词（`verbDeclarations.ts`），门岗 `no-orphan-alias` 逐条核；
 *   · `mcp`    对外 `tools/list` 上的名字；
 *   · `ui`     渲染层自己的入口名；
 *   · `method` 宿主 / dispatcher 的方法名（生成家族的 `nomi_operation_create` 一族、付费边界三相）——模型永远看不见，
 *              付费边界从这一 surface 派生（`paidBoundary.ts`）。
 */
export type CapabilityProjectionSurface = "pi" | "mcp" | "ui" | "method";

export type CapabilityContract<Input, Output> = {
  readonly id: string;
  readonly version: number;
  readonly aliases: Readonly<Partial<Record<CapabilityProjectionSurface, string>>>;
  readonly additionalAliases?: Readonly<Partial<Record<CapabilityProjectionSurface, readonly string[]>>>;
  readonly inputSchema: ZodType<Input>;
  readonly outputSchema: ZodType<Output>;
  readonly effect: CapabilityEffect;
  readonly effectClass: CapabilityEffectClass;
  /** Undo support is independent of mandatory destructive approval. */
  readonly undoable?: boolean;
  readonly operationEffectClasses?: Readonly<Record<string, CapabilityEffectClass>>;
  /**
   * This capability's payload is a plan the user has to *read* before it runs,
   * so it never rides in on a policy default: the first call of an execution
   * always asks, and later ones are reused only after the user's own
   * "this session" / "always" answer. Reserved for reversible local writes
   * whose effect is not visible from the call itself — a timeline edit plan is
   * a multi-operation transaction against a compare-and-swap revision, and its
   * whole review surface (highlight, then approve) is pointless if the Host
   * commits it before the highlight is drawn.
   */
  readonly requiresPlanReview?: boolean;
  /** Operation-specific review. Its presence requires review; false forbids reusing any prior approval. */
  readonly operationPlanReview?: Readonly<Record<string, Readonly<{ allowReuse: boolean }>>>;
  readonly execution: {
    readonly port: CapabilityPortKind;
    readonly availability: CapabilityAvailability;
  };
  readonly exposure: CapabilityExposure;
  readonly requiredScope: string;
  readonly targetKind: string;
};
