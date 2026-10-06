import { insertAutoMentions, removeMention, type AutoMentionCandidate } from '../../../assets/promptMentions'
import { resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { ArchetypeMode, ModelArchetype } from '../../../../../electron/shared/modelArchetypes/types'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { stableShotId } from '../../../generationCanvas/agent/storyboardPlan'
import { appendBinding } from '../shotRow/shotReferenceSlots'

/**
 * 分镜这一侧的**自动引用调用方**（owner 是 `insertAutoMentions`，画布那一侧调同一个函数）。
 *
 * 参考卡出图 → 引用它的每一镜：在提示词里它名字后面补一枚 @，同一张图绑进这一镜的参考框。
 * 两件事一起成、一起不成——只有 @ 没有参考（发不出去）或只有参考没有 @（用户看不见）都不许出现。
 *
 * 「引用它的镜」的判据：提示词的文字里出现了它的名字（与画布同一把尺）。方案里的 `anchorIds`
 * 不单独触发插入——名字不在提示词里就没有「紧跟在名字后面」这个位置，而往末尾塞是用户明确否掉的。
 *
 * 只改**还没出结果、也不在跑**的镜（与画布侧只改未出图节点同一条线，2026-10-06 独立验收 V-1042）：
 * 已经有结果的镜改了提示词，图和词就对不上了。
 *
 * 这一镜当前模式收不了参考图时（如 Agent 默认的「文生视频」）：**同一个模型**里有能收参考图的模式就切过去
 * （设计卡 §B 方案 A，协调会话认可：只切一次、只在同一模型内、切之前「生成」上的报价照常显示）；否则这一镜不补。
 * 切过的模式写进账本同一条，用户切回去不会被再切一次。
 *
 * 判断「名字包含」时用方案里**全部**参考卡的名字（不只出了图的那几张），见 `insertAutoMentions` 的 `knownNames`。
 */

export type ReadyAnchorImage = { anchorId: string; name: string; url: string }

function shotArchetype(shot: PlanShot): ModelArchetype | null {
  if (!shot.modelKey) return null
  return resolveArchetypeForModel({ modelKey: shot.modelKey, vendorKey: shot.modelVendor ?? null })
}

function currentMode(archetype: ModelArchetype, shot: PlanShot): ArchetypeMode | undefined {
  return archetype.modes.find((mode) => mode.id === (shot.modeId ?? archetype.defaultModeId)) ?? archetype.modes[0]
}

function takesImageReference(mode: ArchetypeMode | undefined): boolean {
  return Boolean(mode?.slots.some((slot) => slot.kind === 'image_ref'))
}

/**
 * 这一镜放参考图的模式：当前模式收得了就是它；收不了 → 同模型里第一个收参考图、
 * 且除参考图之外没有别的必填槽的模式（切过去就能跑，不会把镜头切成「缺首帧」）。
 */
function referenceMode(archetype: ModelArchetype, shot: PlanShot): ArchetypeMode | null {
  const mode = currentMode(archetype, shot)
  if (takesImageReference(mode)) return mode ?? null
  return imageReferenceMode(archetype)
}

/**
 * 同一个模型里「能收参考图、切过去就能跑」的模式（除参考图外没有别的必填槽）。
 * 自动引用切模式、行上那枚「+」切模式，问的都是它——同一条规则，不各写一份。
 */
export function imageReferenceMode(archetype: ModelArchetype | null | undefined): ArchetypeMode | null {
  return archetype?.modes.find((candidate) => takesImageReference(candidate)
    && candidate.slots.every((slot) => slot.kind === 'image_ref' || slot.min === 0)) ?? null
}

/**
 * 一镜（调用方保证它还没出结果）：补 @ + 绑参考（+ 必要时切模式）。没有变化就原样返回同一个对象。
 * `knownNames` = 方案里全部参考卡的名字。
 */
export function autoReferenceShot(shot: PlanShot, ready: readonly ReadyAnchorImage[], knownNames: readonly string[] = []): PlanShot {
  if (!ready.length) return shot
  const archetype = shotArchetype(shot)
  if (!archetype) return shot
  const mode = referenceMode(archetype, shot)
  if (!mode) return shot
  const slot = mode.slots.find((candidate) => candidate.kind === 'image_ref')!
  const candidates: AutoMentionCandidate[] = ready.map((image) => ({ key: image.anchorId, name: image.name, url: image.url }))
  const result = insertAutoMentions(shot.prompt, candidates, shot.autoReferenced ?? [], knownNames)
  let prompt = result.prompt
  let bindings = shot.referenceBindings
  const applied = new Set(result.applied)
  for (const image of result.inserted) {
    const appended = appendBinding(bindings, slot, { url: image.url, name: image.name, anchorId: image.key }, 'image')
    if (appended.status === 'added') { bindings = appended.next; continue }
    if (appended.status === 'duplicate') continue
    // 参考框满了：@ 也不留（一起成、一起不成），账本也不记，下次有空位还能补。
    prompt = removeMention(prompt, image.url)
    applied.delete(image.key)
  }
  const nextApplied = [...applied]
  const changedApplied = nextApplied.length !== (shot.autoReferenced ?? []).length
  if (prompt === shot.prompt && bindings === shot.referenceBindings && !changedApplied) return shot
  const switched = bindings !== shot.referenceBindings && mode.id !== currentMode(archetype, shot)?.id
  return {
    ...shot,
    prompt,
    ...(bindings ? { referenceBindings: bindings } : {}),
    autoReferenced: nextApplied,
    ...(switched ? { modeId: mode.id } : {}),
  }
}

/**
 * 整份方案：参考卡出图（或方案打开）时跑一次。`settledShotIds` = 已经出过结果、在跑或可找回的镜（`stableShotId`）——
 * 这些镜**整镜不动**（提示词、参考、模式都不改）。没有变化就原样返回同一个方案对象（调用方据此不写盘）。
 */
export function autoReferencePlan(
  plan: StoryboardPlan,
  ready: readonly ReadyAnchorImage[],
  settledShotIds: ReadonlySet<string> = new Set(),
): StoryboardPlan {
  if (!ready.length) return plan
  const knownNames = plan.anchors.map((anchor) => anchor.name)
  let changed = false
  const shots = plan.shots.map((shot) => {
    if (settledShotIds.has(stableShotId(shot))) return shot
    const next = autoReferenceShot(shot, ready, knownNames)
    if (next !== shot) changed = true
    return next
  })
  return changed ? { ...plan, shots } : plan
}
