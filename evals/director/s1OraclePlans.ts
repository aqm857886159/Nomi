import type { DirectorPlan } from '../../electron/shared/director/directorPlanSchema'
import { isEnvironmentWord, type DirectorSceneTemplate } from '../../electron/shared/director/vocab'
import cards from './cards/all.json'
import { parseDirectorCard, type DirectorCard } from './cardSchema'

// 靶子由题卡派生：演员种类取自卡片 category（雕像 / 水壶是 prop、瓶子是 product），场景词取自卡片 scene.required；不再一律当 person
const CARDS = new Map<string, DirectorCard>((cards as unknown[]).map((raw) => parseDirectorCard(raw)).map((card) => [card.id, card]))
const ACTOR_KINDS = ['person', 'vehicle', 'product', 'prop'] as const
const kindOf = (category: string): (typeof ACTOR_KINDS)[number] => ((ACTOR_KINDS as readonly string[]).includes(category) ? (category as (typeof ACTOR_KINDS)[number]) : 'prop')

const shot = (id: string, window: [number, number], subject: string, size: DirectorPlan['shots'][number]['size'], angle: DirectorPlan['shots'][number]['angle'], kind: DirectorPlan['shots'][number]['move']['kind'], amount?: number): DirectorPlan['shots'][number] => ({ id, window, transitionIn: 'cut', subject, size, angle, height: 'eye', move: { kind, amount: amount ?? (kind === 'orbit_right' ? 90 : undefined), speed: 'medium', easing: 'linear' } })

export const S1_ORACLE_PLANS: Record<string, DirectorPlan> = {
  'courtyard-standoff': {
    version: 2, scene: { tags: ['courtyard'], environment: 'day', template: 'courtyard', setPieces: [] },
    actors: [{ id: 'woman', kind: 'person', desc: '青衣女子', anchors: { hand: { x: 0.3, y: 1, z: 0.2 } }, placement: { relation: 'at', ref: 's1-courtyard-ground' } }, { id: 'guard', kind: 'person', desc: '黑衣侍卫', placement: { relation: 'at', ref: 's1-courtyard-gate' } }],
    blocking: [{ actor: 'woman', verb: 'walk_to', target: 'gate', window: [0, 4] }, { actor: 'guard', verb: 'sidestep', target: 'woman', window: [4, 8] }, { actor: 'woman', verb: 'stop', window: [4, 8] }, { actor: 'woman', verb: 'hold_pose', window: [4, 8], action: 'hide_object_behind_back' }],
    shots: [shot('wide', [0, 4], 'woman', '全景', 'side_rear', 'follow'), { ...shot('medium', [4, 8], 'guard', '中景', 'three_quarter', 'static'), subjects: ['woman', 'guard'] }, shot('hand', [8, 10], 'woman.hand', '特写', 'front', 'static'), { ...shot('over-shoulder', [10, 12], 'woman', '中近景', { over_shoulder: 'guard' }, 'push_in') }],
  },
  'perfume-orbit': {
    version: 2, scene: { tags: ['product'], environment: 'studio', template: 'product_stage', setPieces: [] },
    actors: [{ id: 'bottle', kind: 'product', desc: 'bottle', anchors: { cap: { x: 0, y: 1.1, z: 0 } }, placement: { relation: 'on', ref: 's1-product-pedestal' } }], blocking: [],
    shots: [shot('orbit', [0, 8], 'bottle', '特写', 'front', 'orbit_right', 360), { ...shot('push', [8, 11], 'bottle.cap', '特写', 'front', 'push_in'), transitionIn: 'continuous' }],
  },
  'police-chase': {
    version: 2, scene: { tags: ['street', 'chase'], environment: 'night', template: 'street', setPieces: [] },
    actors: [{ id: 'police_car', kind: 'vehicle', desc: 'police', placement: { relation: 'at', ref: 's1-street-ground' } }, { id: 'suspect_car', kind: 'vehicle', desc: 'suspect', placement: { relation: 'in_front_of', ref: 'police_car' } }],
    blocking: [{ actor: 'suspect_car', verb: 'drive_along', target: 'police_car', window: [0, 4] }, { actor: 'police_car', verb: 'chase', target: 'suspect_car', window: [0, 4] }],
    shots: [shot('establish', [0, 4], 'suspect_car', '全景', 'back', 'follow'), { ...shot('follow', [4, 7], 'police_car', '中景', 'three_quarter', 'pan'), transitionIn: 'cut' }, { ...shot('close', [7, 9], 'police_car', '特写', 'front', 'push_in'), transitionIn: 'cut' }],
  },
}

type PlanMove = DirectorPlan['shots'][number]['move']['kind']
const TEMPLATE_FOR_REQUIRED: Record<string, { template: DirectorSceneTemplate; ref: string }> = {
  ground: { template: 'room', ref: 's1-room-floor' },
  room: { template: 'room', ref: 's1-room-floor' },
  interior: { template: 'room', ref: 's1-room-floor' },
  cafe_table: { template: 'room', ref: 's1-room-floor' },
  quiet_room: { template: 'room', ref: 's1-room-floor' },
  shop_counter: { template: 'room', ref: 's1-room-floor' },
  quiet_street: { template: 'street', ref: 's1-street-ground' },
  storm_ground: { template: 'street', ref: 's1-street-ground' },
  market_street: { template: 'street', ref: 's1-street-ground' },
  courtyard: { template: 'courtyard', ref: 's1-courtyard-ground' },
  gallery: { template: 'room', ref: 's1-room-floor' },
}

function requiredPlan(id: string, shots: Array<{ id: string; window: [number, number]; size: DirectorPlan['shots'][number]['size']; subject?: string; kind: PlanMove; angle?: DirectorPlan['shots'][number]['angle']; amount?: number; direction?: DirectorPlan['shots'][number]['move']['direction'] }>): DirectorPlan {
  const card = CARDS.get(id)
  if (!card) throw new Error(`oracle plan ${id} has no card`)
  const required = card.scene.required[0]
  const actorIds = card.actors.map((actor) => actor.id)
  const placement = TEMPLATE_FOR_REQUIRED[required] ?? { template: 'street' as const, ref: 's1-street-ground' }
  const actors = card.actors.map((actor, index) => ({ id: actor.id, kind: kindOf(actor.category), desc: actor.id, placement: index === 0 ? (kindOf(actor.category) === 'product' && !isEnvironmentWord(required) ? { relation: 'on' as const, ref: required } : { relation: 'at' as const, ref: placement.ref }) : { relation: 'right_of' as const, ref: actorIds[0] } }))
  return {
    version: 2,
    scene: { tags: [id, required], environment: placement.template === 'street' ? 'night' : 'day', template: placement.template, setPieces: [{ id: required, kind: required, relation: { type: 'at', ref: placement.ref } }] },
    actors,
    blocking: [],
    shots: shots.map((item) => ({ id: item.id, window: item.window, transitionIn: 'cut' as const, subject: item.subject ?? actorIds[0], size: item.size, angle: item.angle ?? 'front', height: 'eye' as const, move: { kind: item.kind, ...(item.direction ? { direction: item.direction } : {}), ...(item.amount ? { amount: item.amount } : {}), speed: 'slow' as const, easing: 'linear' as const } })),
  }
}

const singleMotion: Record<string, { kind: PlanMove; direction?: DirectorPlan['shots'][number]['move']['direction']; angle?: DirectorPlan['shots'][number]['angle']; amount?: number }> = {
  't1-01-push': { kind: 'push_in' }, 't1-02-pull': { kind: 'pull_out' }, 't1-03-pan': { kind: 'pan', direction: 'right' },
  't1-04-tilt': { kind: 'tilt', direction: 'up' }, 't1-05-orbit': { kind: 'orbit_right', direction: 'right', amount: 360 }, 't1-06-follow': { kind: 'follow', direction: 'right' },
  't1-07-truck': { kind: 'track_right', direction: 'right' }, 't1-08-crane': { kind: 'crane_up', direction: 'up' }, 't1-09-over_shoulder': { kind: 'static', angle: { over_shoulder: 'subject' } },
  't1-10-pov': { kind: 'static', angle: { pov: 'subject' } }, 't1-11-zoom': { kind: 'zoom_in' }, 't1-12-arc': { kind: 'arc_left', direction: 'left', amount: 90 },
  't1-13-static': { kind: 'static' }, 't1-14-dolly': { kind: 'push_in' }, 't1-15-whip': { kind: 'pan', direction: 'right' }, 't1-16-rack_focus': { kind: 'static' },
}
for (const [id, move] of Object.entries(singleMotion)) S1_ORACLE_PLANS[id] = requiredPlan(id, [{ id: 'shot', window: [0, 4], size: '中景', kind: move.kind, direction: move.direction, amount: move.amount, angle: move.angle }])

const t2Shots: Record<string, Array<{ id: string; kind: PlanMove; size: DirectorPlan['shots'][number]['size']; direction?: DirectorPlan['shots'][number]['move']['direction'] }>> = {
  't2-courtyard': [{ id: 'wide', kind: 'follow', size: '全景' }, { id: 'medium', kind: 'static', size: '中景' }, { id: 'close', kind: 'push_in', size: '特写' }],
  't2-kitchen': [{ id: 'wide', kind: 'track_right', size: '全景', direction: 'right' }, { id: 'medium', kind: 'static', size: '中景' }, { id: 'close', kind: 'push_in', size: '特写' }],
  't2-train': [{ id: 'wide', kind: 'pan', size: '远景', direction: 'right' }, { id: 'medium', kind: 'follow', size: '中景' }, { id: 'close', kind: 'pull_out', size: '特写' }],
  't2-gallery': [{ id: 'wide', kind: 'orbit_right', size: '全景', direction: 'right' }, { id: 'medium', kind: 'static', size: '中景' }, { id: 'close', kind: 'push_in', size: '特写' }],
  't2-rooftop': [{ id: 'wide', kind: 'crane_up', size: '全景', direction: 'up' }, { id: 'medium', kind: 'track_right', size: '中景', direction: 'right' }, { id: 'close', kind: 'tilt', size: '近景', direction: 'down' }],
}
for (const [id, rows] of Object.entries(t2Shots)) S1_ORACLE_PLANS[id] = requiredPlan(id, rows.map((row, index) => ({ id: row.id, window: [index * 4, (index + 1) * 4] as [number, number], size: row.size, kind: row.kind, direction: row.direction })))

const t3Specs: Record<string, { moves: [PlanMove, PlanMove, PlanMove] }> = {
  't3-storm': { moves: ['crane_up', 'follow', 'push_in'] },
  't3-cafe': { moves: ['track_right', 'static', 'push_in'] },
  't3-space': { moves: ['orbit_right', 'crane_up', 'pull_out'] },
  't3-market': { moves: ['follow', 'track_right', 'push_in'] },
}
for (const [id, spec] of Object.entries(t3Specs)) S1_ORACLE_PLANS[id] = requiredPlan(id, spec.moves.map((kind, index) => ({ id: `coverage-${index}`, window: [index * 4, (index + 1) * 4] as [number, number], size: (['全景', '中景', '特写'] as const)[index], kind })))
