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
export type CapabilityPortKind =
  | "document" | "canvas" | "timeline" | "production-run" | "asset" | "export" | "skills"
  /** 模型目录：接入、显示/隐藏、删除。它不属于任何一个项目——见 `CapabilityContract.scope`。 */
  | "model-catalog";
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
  /**
   * Operation-specific review. Its presence requires review; false forbids reusing any prior approval.
   * When the contract also sets `requiresPlanReview`, a recognised operation missing from this map is NOT
   * reviewed (timeline.write: the edit plan is, undo is not); an unrecognised one falls back to the contract flag.
   */
  readonly operationPlanReview?: Readonly<Record<string, Readonly<{ allowReuse: boolean }>>>;
  /**
   * 这个能力的**全部内容就是问用户一句话**，所以没有任何档位、任何会话级授权能替他答。
   *
   * 它和 `requiresPlanReview` 问的不是一个问题：那条说的是「这份载荷用户得先读一遍」，
   * 读完仍然可以由他说「这类以后别问」。这条说的是「不问就没有答案」——把它自动放行
   * 等于凭空造一句用户从没说过的话，然后拿去喂模型。
   *
   * 它也不能用 `effectClass` 表达：那张表只有 reversible_local / spend / irreversible 三格，
   * 而「问一句」哪一格都不是（它什么都不改，所以 `effect` 是 `read`）。写成 `irreversible`
   * 能凑出同样的闸，代价是从此每一份读这张表的代码都读到一句假话。
   */
  readonly alwaysAsksUser?: true;
  readonly execution: {
    readonly port: CapabilityPortKind;
    readonly availability: CapabilityAvailability;
  };
  readonly exposure: CapabilityExposure;
  readonly requiredScope: string;
  readonly targetKind: string;
  /**
   * 这个能力作用在**一个项目上**还是**整个 App 上**。缺省 `"project"`（今天全部如此）。
   *
   * 为什么要它：对外 MCP 投影一直把 `leaseHandle` 写死成每个工具的必填首字段——那对画布、
   * 文稿、时间轴都对（它们的对象就住在某个项目里），但对「把一家供应商接进 Nomi」不对：
   * 模型目录是 App 级的，接模型不该先要求用户开一个项目。硬要一个租约等于在「从零接一家」
   * 的路上多加一道闸，而这条路上的闸正是 09-15 真机四轮零产出的原因。
   *
   * `"app"` 只改**投影**（不发租约字段、不要求它），不改授权：能力自己的 requiredScope 照旧。
   */
  readonly scope?: "project" | "app";
};
