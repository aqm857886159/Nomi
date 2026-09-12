import type { PlanShot, StoryboardPlan } from './storyboardPlan'
import { storyboardProfileForKey } from './storyboardProfiles'

/**
 * 「整片默认 → 逐镜生成参数」的**单一 owner**（设计合同 v6 §2.4.1，2026-09-05 用户拍板；
 * 2026-09-12 从「画幅作用域」推广成「整片级设置作用域」）。
 *
 * 为什么单独一层：v5 把画幅当逐镜参数——只有 `PlanShot.params.aspect_ratio` 一处在写，
 * 批量条的「整片画幅」其实是「把同一个值抄进每一行」。于是"这一镜真的不一样"和
 * "这一镜只是继承了整片默认"在数据上长得一模一样，UI 分不出来，只能每行常驻一枚
 * 永远显示同一个值的胶囊（95% 的行里零信息量）。
 *
 * v6 把它拆成两段：**整片默认住 plan（`StoryboardPlan.aspectRatio`）、行级覆盖住 shot**。
 * 这一层是这两段的唯一读写口——UI 不许自己写 `shot.params.aspect_ratio`，也不许自己判
 * "读哪一个"（那正是 R14.1 说的第二份定义）。
 *
 * 旧 plan 怎么办（读时迁移，不写迁移脚本）：`plan.aspectRatio` 缺省时，整片默认**从全镜共同值
 * derive**——旧 plan 全镜都写着 9:16，于是默认就是 9:16、没有一行算覆盖，行为与今天一致。
 * 第一次改整片默认时（`setPlanDefaultAspect`）才把"当时在继承的那些行"的冗余值清掉。
 *
 * ## 2026-09-12：为什么这一层现在还负责**落画布**
 *
 * v6 只做对了一半：`plan.aspectRatio` 是真相源没错，但**只有分镜表 UI 在读它**。落画布那两条路
 * （`storyboardPlan.buildShotRowNodes` 建节点、`storyboardProjection.projectShotNode` 写回节点）
 * 各自直接铺 `shot.params`，于是"继承整片默认"的行——也就是 95% 的行——落到画布上**不带
 * `aspect_ratio`**，静默回落成模型档案默认（`auto` / `16:9`）。用户在批量条上设成 9:16、
 * 表里每一格也画成竖的，出片仍是横的：**界面显示的和请求体携带的是两份真相**。
 *
 * 根因不是"少合并了一个键"，而是**这一层只导出了给 UI 看的 getter，没导出给请求体用的 resolver**。
 * 所以修法不是在落画布那两处各补一句 `aspect_ratio`（那是把第三、第四份定义再造出来），而是
 * 让这一层给出**唯一的** `resolveShotParams` / `resolveKeyframeParams`，两条路都只准调它。
 *
 * ## 加一条整片级设置要动哪里
 *
 * 只动 `FILM_DEFAULTS` 一张表：登记「plan 上住在哪 / 落到哪个参数键 / 行级覆盖写在哪」。
 * 落画布、写回节点、表格显示三条路都从这张表 derive，不需要各自再记得一次。
 * `check:storyboard-owner` 会核验：表里每个键都在 `storyboardPlanSchema` 里有落脚点，
 * 且两条落地路径都没有绕过 resolver 直接铺 `shot.params`。
 */

/** 画幅预设（批量条与行级覆盖共用一份；档案声明了别的档时按并集出，不拦供应商的自定义值）。 */
export const ASPECT_OPTIONS: readonly string[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']

/**
 * 一条整片级设置的登记。
 *
 * `planValue` 读 plan 那一段（`''` = 还没定，交给模型档案默认——**不编一个值**）；
 * `shotOverride` 读行那一段（`null` = 这一行没写，跟随整片默认）。
 * 两段的"生效值"永远是 `shotOverride ?? planValue`，不许有第三种读法。
 */
type FilmDefaultSpec = {
  /** 落进节点 params / 请求体的参数键——与模型档案 `control.key` 同名，供应商没有这个控件时由
   *  `buildPlannedNodeMeta` 按档案丢弃（诚实缺席，不硬塞）。 */
  readonly paramKey: string
  /** 它在 `StoryboardPlan` 上住的字段名。门岗据此核验方案 schema 与工具 envelope 都有这个键——
   *  少一个 = 规划师写的整片值在解析那一刻被静默丢弃（这一族 bug 的第二个出口）。 */
  readonly planKey: keyof StoryboardPlan & string
  /** 整片默认值（`''` = 未定）。 */
  readonly planValue: (plan: StoryboardPlan) => string
  /** 这一行自己写着的值（`null` = 没写）。 */
  readonly shotOverride: (shot: PlanShot) => string | null
}

/** 这一行**自己写着的**画幅（没写 → null）。注意「写着」不等于「覆盖」——见 isAspectOverridden。 */
export function shotAspectOverride(shot: PlanShot): string | null {
  const raw = shot.params?.aspect_ratio
  return typeof raw === 'string' && raw ? raw : null
}

/** 全镜共同的画幅（不一致或空 → ''）——只作为旧 plan 缺省 `plan.aspectRatio` 时的读时回退。 */
function commonShotAspect(plan: StoryboardPlan): string {
  if (plan.shots.length === 0) return ''
  const first = shotAspectOverride(plan.shots[0]) ?? ''
  return plan.shots.every((shot) => (shotAspectOverride(shot) ?? '') === first) ? first : ''
}

/**
 * 片种模板声明的画幅（短剧 9:16 / 自由格式 16:9）。
 *
 * 只在方案**显式选了片种**时才算数：`storyboardProfileForKey(undefined)` 会回落 free-form 的
 * 16:9，拿它当兜底等于替每一份没选片种的方案硬定横屏——那是"编一个值"，正是这一族 bug 的成因。
 */
function profileDefaultAspect(plan: StoryboardPlan): string {
  if (plan.storyboardProfile) return plan.storyboardProfile.aspect || ''
  if (plan.profileKey) return storyboardProfileForKey(plan.profileKey).aspect || ''
  return ''
}

/** 整片默认画幅（批量条那枚胶囊显示的值；'' = 还没定，按模型默认走）。 */
export function planDefaultAspect(plan: StoryboardPlan): string {
  // 显式设过 → 就是它（含显式设成 '' = 交回模型默认）。没设过才按「全镜共同值 → 片种声明」derive。
  return plan.aspectRatio ?? (commonShotAspect(plan) || profileDefaultAspect(plan))
}

/**
 * 登记表：加一条整片级设置就在这里加一行。
 *
 * 今天只有画幅一条真的住在 plan 上。类型 / 模型 / 时长的"整片"入口是**批量编辑**
 * （`storyboardPlanEdits.apply*ToAll` 把值写进每一行），它们在数据上就是逐镜值、没有第二段作用域，
 * 因此不属于这张表——落画布时本来就随 `shot.*` 一起走。把它们塞进来等于再造一遍 v5 那个
 * "抄进每一行"的老问题。见 `docs/plan/2026-09-12-storyboard-plan-defaults-passthrough.md` 的普查表。
 */
const FILM_DEFAULTS: readonly FilmDefaultSpec[] = [
  { paramKey: 'aspect_ratio', planKey: 'aspectRatio', planValue: planDefaultAspect, shotOverride: shotAspectOverride },
]

/** 登记在案的整片级参数键（门岗与 UI 说明共用；不要在别处手抄这份清单）。 */
export const FILM_DEFAULT_PARAM_KEYS: readonly string[] = FILM_DEFAULTS.map((spec) => spec.paramKey)

/** 登记在案的整片级 plan 字段名（`check:storyboard-owner` 拿它去核验两处 schema）。 */
export const FILM_DEFAULT_PLAN_KEYS: readonly string[] = FILM_DEFAULTS.map((spec) => spec.planKey)

/** 这一行**真的**覆盖了整片默认吗（写了、且与默认不同）。底栏那枚胶囊出不出现只看这一条。 */
export function isAspectOverridden(plan: StoryboardPlan, shot: PlanShot): boolean {
  const override = shotAspectOverride(shot)
  return override !== null && override !== planDefaultAspect(plan)
}

/** 这一行**生效**的画幅（覆盖优先，否则整片默认）——画面格几何、请求体都读这一个。 */
export function effectiveShotAspect(plan: StoryboardPlan, shot: PlanShot): string {
  return shotAspectOverride(shot) ?? planDefaultAspect(plan)
}

/** 覆盖了画幅的行数（批量条右侧那句"已覆盖画幅的 N 镜不跟着变"读它）。 */
export function overriddenAspectCount(plan: StoryboardPlan): number {
  return plan.shots.filter((shot) => isAspectOverridden(plan, shot)).length
}

/**
 * 这一镜**发出去时真正携带**的生成参数（落画布建节点、写回节点、以及任何要展示"会发什么"的地方
 * 都只准调这一个）。
 *
 * 语义就一条：`行写了的 ?? 整片默认 ?? 什么都不带`。第三段是关键——整片默认为空时**不编一个值**，
 * 参数键干脆缺席，由模型档案自己的默认接管（`buildPlannedNodeMeta` 先铺 mode 默认再盖合法覆盖）。
 * 供应商没有这个控件（如 MiniMax H3 首帧路没有画幅控件）时，这个键同样会在那一层被丢掉——
 * 那是诚实缺席，UI 侧用 `unsupportedFilmDefaultKeys` 如实说明，而不是显示一个发不出去的值。
 */
export function resolveShotParams(plan: StoryboardPlan, shot: PlanShot): Record<string, unknown> {
  return withFilmDefaults(plan, shot, shot.params)
}

/**
 * 图片+视频镜的**首帧图节点**携带的生成参数。首帧图必须和它喂的那条视频同画幅——否则首帧被裁/被拉，
 * 运动落点从第一帧就偏了。所以整片默认同样要落到这张图上（首帧模型没有该控件时照样诚实缺席）。
 */
export function resolveKeyframeParams(plan: StoryboardPlan, shot: PlanShot): Record<string, unknown> {
  return withFilmDefaults(plan, shot, shot.keyframe?.params)
}

function withFilmDefaults(
  plan: StoryboardPlan,
  shot: PlanShot,
  base: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...(base ?? {}) }
  for (const spec of FILM_DEFAULTS) {
    // 这一行自己写了就用它自己的（`shot.params` 已经在 base 里，不必再写一次）。
    if (spec.shotOverride(shot) !== null) continue
    const planValue = spec.planValue(plan)
    if (planValue) params[spec.paramKey] = planValue
  }
  return params
}

/**
 * 这一行的模型**吃不下**的整片默认键（该 mode 的参数表里没有这个控件）。
 *
 * 存在的理由：显示必须等于请求。整片画幅设成 9:16 而这一镜跑的是没有画幅控件的模式时，
 * 那个 9:16 在 `buildPlannedNodeMeta` 会被丢掉——界面上就不能继续把它画成竖的、当没事发生。
 * 参数只要 `{ key }` 这个结构（不绑具体档案类型），调用方把 `mode.params` 递进来即可。
 */
export function unsupportedFilmDefaultKeys(
  plan: StoryboardPlan,
  shot: PlanShot,
  controls: readonly { key: string }[] | null | undefined,
): string[] {
  if (!controls) return [] // 无模型/无档案 → 无契约可判，不瞎报。
  const supported = new Set(controls.map((control) => control.key))
  return FILM_DEFAULTS
    .filter((spec) => !supported.has(spec.paramKey))
    .filter((spec) => Boolean(spec.shotOverride(shot) ?? spec.planValue(plan)))
    .map((spec) => spec.paramKey)
}

function withShotAspect(shot: PlanShot, aspect: string | null): PlanShot {
  if (aspect === null) {
    const { aspect_ratio: _dropped, ...rest } = shot.params ?? {}
    if (Object.keys(rest).length === 0) {
      const { params: _params, ...shotRest } = shot
      return shotRest
    }
    return { ...shot, params: rest }
  }
  return { ...shot, params: { ...(shot.params ?? {}), aspect_ratio: aspect } }
}

/**
 * 改整片默认画幅：**继承的行跟着变，已覆盖的行原样不动**（合同 §2.4.1 的那句承诺）。
 * 实现上"跟着变"不是把新值抄进每一行，而是把那些行残留的旧默认值**清掉**——继承是
 * 读时算出来的，抄一遍就又造回了第二份真相。
 */
export function setPlanDefaultAspect(plan: StoryboardPlan, aspect: string): StoryboardPlan {
  const previousDefault = planDefaultAspect(plan)
  return {
    ...plan,
    aspectRatio: aspect,
    shots: plan.shots.map((shot) => {
      const override = shotAspectOverride(shot)
      if (override === null) return shot
      // 旧值 = 当时的默认 → 它本来就是"继承"，清掉让它跟着新默认走。
      return override === previousDefault ? withShotAspect(shot, null) : shot
    }),
  }
}

/** 行级覆盖：传画幅 = 覆盖；传 null = 收回覆盖（跟随整片默认，底栏那枚胶囊随之消失）。 */
export function setShotAspectOverride(plan: StoryboardPlan, position: number, aspect: string | null): StoryboardPlan {
  if (position < 0 || position >= plan.shots.length) return plan
  const normalized = aspect && aspect !== planDefaultAspect(plan) ? aspect : null
  return {
    ...plan,
    shots: plan.shots.map((shot, index) => (index === position ? withShotAspect(shot, normalized) : shot)),
  }
}
