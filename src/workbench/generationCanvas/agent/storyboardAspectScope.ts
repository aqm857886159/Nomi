import type { PlanShot, StoryboardPlan } from './storyboardPlan'

/**
 * 画幅的**作用域单一 owner**（设计合同 v6 §2.4.1，2026-09-05 用户拍板）。
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
 */

/** 画幅预设（批量条与行级覆盖共用一份；档案声明了别的档时按并集出，不拦供应商的自定义值）。 */
export const ASPECT_OPTIONS: readonly string[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']

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

/** 整片默认画幅（批量条那枚胶囊显示的值；'' = 还没定，按模型默认走）。 */
export function planDefaultAspect(plan: StoryboardPlan): string {
  return plan.aspectRatio ?? commonShotAspect(plan)
}

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
