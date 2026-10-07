import type { DirectorCard } from './cardSchema'
import type {
  DirectorObject,
  DirectorScene,
} from '../../src/workbench/generationCanvas/nodes/director/model/directorTypes'

export type EntityBinding = {
  actorMap: Record<string, string | undefined>
  sceneMap: Record<string, string | undefined>
  actorRate: number
  sceneRate: number
  correspondenceRate: number
  missing: string[]
}

const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[“”‘’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
const genericActor = /^(subject|actor|person(?:[_ -]?[a-z])?|character|人物|演员)$/iu

function compatible(category: string, object: DirectorObject): boolean {
  if (category === 'person') return object.type === 'character'
  if (category === 'vehicle') return object.type === 'cube' || object.type === 'model' || object.type === 'group'
  if (category === 'product') return object.type !== 'character' && object.type !== 'plane' && object.type !== 'group'
  return true
}

function keywordsFor(actor: DirectorCard['actors'][number]): string[] {
  return [actor.id, ...actor.aliases, actor.desc ?? '', ...actor.props]
    .map(normalize)
    .filter((value) => value.length >= 2)
}

function textMatch(keywords: string[], object: DirectorObject): number {
  const text = normalize(object.name === object.id ? `${object.id} ${object.name}` : object.name)
  return keywords.reduce(
    (score, keyword) => score + (text === keyword ? 3 : text.includes(keyword) || keyword.includes(text) ? 2 : 0),
    0,
  )
}

function actorBinding(card: DirectorCard, scene: DirectorScene): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  const used = new Set<string>()
  const compatibleObjects = (actor: DirectorCard['actors'][number]) =>
    scene.objects.filter((object) => !used.has(object.id) && compatible(actor.category, object))
  for (let index = 0; index < card.actors.length; index += 1) {
    const actor = card.actors[index]
    const candidates = compatibleObjects(actor)
    const keywords = keywordsFor(actor)
    const scored = candidates
      .map((object) => {
        const keywordScore = textMatch(keywords, object)
        const orderScore = 1 - Math.abs(candidates.indexOf(object) - index) / Math.max(1, candidates.length)
        const genericFallback = genericActor.test(actor.id) && keywordScore === 0
        return {
          object,
          keywordScore,
          score: keywordScore * 10 + orderScore * 2 + (genericFallback ? 3 : 0),
          genericFallback,
        }
      })
      .filter((candidate) => candidate.keywordScore > 0 || candidate.genericFallback)
      .sort((a, b) => b.score - a.score)
    const winner = scored[0]
    if (winner && (winner.keywordScore > 0 || winner.genericFallback)) {
      out[actor.id] = winner.object.id
      used.add(winner.object.id)
    } else out[actor.id] = undefined
  }
  return out
}

function sceneBinding(
  card: DirectorCard,
  scene: DirectorScene,
  actorMap: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const used = new Set(Object.values(actorMap).filter((id): id is string => Boolean(id)))
  const out: Record<string, string | undefined> = {}
  for (const required of card.scene.required) {
    const actorMatch = actorMap[required]
    if (actorMatch) {
      out[required] = actorMatch
      continue
    }
    const aliases = [required, ...(card.scene.aliases[required] ?? [])].map(normalize).filter(Boolean)
    const candidates = scene.objects.filter((object) => !used.has(object.id))
    const winner = candidates
      .map((object) => ({ object, score: textMatch(aliases, object) }))
      .filter((candidate) => candidate.score > 0 || (required === 'ground' && candidate.object.type === 'plane'))
      .sort((a, b) => b.score - a.score)[0]
    if (winner) {
      out[required] = winner.object.id
      used.add(winner.object.id)
    } else out[required] = undefined
  }
  return out
}

export function bindCardEntities(card: DirectorCard, scene: DirectorScene): EntityBinding {
  const actorMap = actorBinding(card, scene)
  const sceneMap = sceneBinding(card, scene, actorMap)
  const actorHits = Object.values(actorMap).filter(Boolean).length
  const sceneHits = Object.values(sceneMap).filter(Boolean).length
  const actorRate = card.actors.length ? actorHits / card.actors.length : 1
  const sceneRate = card.scene.required.length ? sceneHits / card.scene.required.length : 1
  const total = card.actors.length + card.scene.required.length
  const correspondenceRate = total ? (actorHits + sceneHits) / total : 1
  const missing = [
    ...Object.entries(actorMap)
      .filter(([, value]) => !value)
      .map(([id]) => `缺少演员 ${id}`),
    ...Object.entries(sceneMap)
      .filter(([, value]) => !value)
      .map(([id]) => `场景缺少 ${id}`),
  ]
  return { actorMap, sceneMap, actorRate, sceneRate, correspondenceRate, missing }
}
